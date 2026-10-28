import {strict as assert} from "node:assert";
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test, type TestContext} from "node:test";

import {startMaaToolsRun} from "./run";
import {runChild} from "./process";
import {fixtureResult} from "./result-builders.test-helper";
import {collectTests} from "./collect";
import {upstreamReports} from "./upstream-reports.test-helper";
import type {TestRunEvent} from "./protocol";

function fakeWorkspace(
    t: TestContext,
    output: unknown,
    options: {
        exitCode?: number;
        hang?: boolean;
        events?: (workspace: string) => unknown[];
        rawStream?: (workspace: string) => string;
        chunkSize?: number;
        crlf?: boolean;
        waitForRelease?: boolean;
        terminate?: boolean;
    } = {},
) {
    const root = mkdtempSync(path.join(tmpdir(), "maa-node-jsonl-flow-task25-"));
    t.after(() => rmSync(root, {recursive: true, force: true}));
    const cli = path.join(root, "node_modules", "@nekosu", "maa-tools", "bin", "maa-tools");
    mkdirSync(path.dirname(cli), {recursive: true});
    const result = typeof output === "function" ? output(root) : output;
    const argsFile = path.join(root, "received-args.json");
    const eol = options.crlf ? "\r\n" : "\n";
    const prefix =
        options.rawStream?.(root) ??
        (options.events?.(root) ?? []).map((event) => JSON.stringify(event) + eol).join("");
    const final = options.rawStream ? "" : JSON.stringify({schemaVersion: 1, type: "run-result", result}) + eol;
    writeFileSync(
        cli,
        [
            "async function main() {",
            `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));`,
            `fs.writeFileSync(${JSON.stringify(path.join(root, "transport.json"))}, JSON.stringify({send:typeof process.send, channel:!!process.channel}));`,
            `async function write(text) { const bytes = Buffer.from(text); const size = ${options.chunkSize ?? 0} || Math.max(bytes.length, 1); for (let i = 0; i < bytes.length; i += size) { await new Promise(resolve => process.stdout.write(bytes.subarray(i, i + size), resolve)); ${options.chunkSize ? "await new Promise(resolve => setImmediate(resolve));" : ""} } }`,
            "process.stderr.write('上游原始日志\\n');",
            `if (process.argv.includes('--list')) { await write(process.argv.includes('--json') ? ${JSON.stringify(JSON.stringify(result))} : '测试文件列表（供终端阅读）\\n'); return; }`,
            `await write(${JSON.stringify(prefix)});`,
            options.waitForRelease
                ? `await new Promise((resolve, reject) => { const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(path.join(root, "release-final"))})) { clearInterval(timer); clearTimeout(deadline); resolve(); } }, 10); const deadline = setTimeout(() => { clearInterval(timer); reject(new Error('no live callback before final')); }, 2000); });`
                : "",
            options.terminate ? "process.kill(process.pid, 'SIGTERM'); return;" : "",
            options.hang
                ? "setInterval(() => {}, 1000);"
                : `await write(${JSON.stringify(final)}); process.exitCode = ${options.exitCode ?? 0};`,
            "}",
            "main().catch(error => { console.error(error); process.exitCode = 1; });",
        ].join("\n"),
    );
    return {root, argsFile};
}

function inWorkspace<T>(fixture: T, workspace: string): T {
    return JSON.parse(JSON.stringify(fixture).replaceAll("/repo", workspace)) as T;
}

test("单次JSON运行不读取配置或本地测试文件；传同一份文件选择与配置", async (t) => {
    const {root, argsFile} = fakeWorkspace(t, (workspace: string) => fixtureResult(workspace, [1]));
    let log = "";
    const outcome = await startMaaToolsRun(
        {
            workspaceRoot: root,
            nodePath: process.execPath,
            configPath: "custom/config.mts",
            testFiles: ["tests/test_a.json"],
            caseIndex: 1,
        },
        {onOutput: (chunk) => (log += chunk)},
    ).done;
    assert.equal(outcome.error, undefined);
    assert.equal(outcome.fileResults.get("tests/test_a.json"), "pass");
    assert.equal(outcome.caseResults.get("tests/test_a.json#1")?.verdict, "pass");
    assert.deepEqual(JSON.parse(readFileSync(argsFile, "utf8")), [
        "test",
        "--jsonl",
        "--file",
        "tests/test_a.json",
        "--case",
        "1",
        "custom/config.mts",
    ]);
    assert.match(log, /上游原始日志/);
});

test("顶层失败与文件通过矛盾时清空所有可通过Map", async (t) => {
    const {root} = fakeWorkspace(t, (workspace: string) => ({...fixtureResult(workspace), status: "failed"}));
    const outcome = await startMaaToolsRun({
        workspaceRoot: root,
        nodePath: process.execPath,
        testFiles: ["tests/test_a.json"],
    }).done;
    assert.equal(outcome.errorCode, "invalid-result");
    assert.match(outcome.error!, /failed/);
    assert.equal(outcome.fileResults.size, 0);
    assert.equal(outcome.caseResults.size, 0);
});

test("遗漏所选用例或未知schema不返回部分通过", async (t) => {
    for (const mode of [
        "omitted",
        "version",
    ] as const) {
        const {root} = fakeWorkspace(t, (workspace: string) => {
            const doc = fixtureResult(workspace);
            return mode === "version" ? {...doc, schemaVersion: 2} : doc;
        });
        const outcome = await startMaaToolsRun({
            workspaceRoot: root,
            nodePath: process.execPath,
            testFiles: ["tests/test_a.json"],
            expectedCases: new Map([
                [
                    "tests/test_a.json",
                    [
                        1,
                        2,
                        3,
                    ],
                ],
            ]),
        }).done;
        assert.equal(outcome.errorCode, "invalid-result");
        assert.equal(outcome.fileResults.size, 0);
    }
});

test("按错误代码区别配置启动失败与无匹配，不猜英文reason", async (t) => {
    const {root} = fakeWorkspace(t, {
        schemaVersion: 1,
        status: "error",
        errorCode: "config-load-failed",
        reason: "no tests matched arbitrary text",
        groups: [],
        files: [],
        durationMs: 0,
    });
    const failed = await startMaaToolsRun({
        workspaceRoot: root,
        nodePath: process.execPath,
        testFiles: ["tests/test_a.json"],
    }).done;
    assert.match(failed.error!, /配置加载失败/);
    assert.equal(failed.empty, undefined);
    assert.doesNotMatch(failed.error!, /MaaFW/);
    const empty = fakeWorkspace(t, (workspace: string) => inWorkspace(upstreamReports.empty, workspace));
    const outcome = await startMaaToolsRun({
        workspaceRoot: empty.root,
        nodePath: process.execPath,
        testFiles: ["tests/test_a.json"],
    }).done;
    assert.match(outcome.empty!, /没有匹配到/);
    assert.equal(outcome.error, undefined);
});

test("实际report的全局error保留正常文件和未执行平台的逐用例结果", async (t) => {
    const {root} = fakeWorkspace(t, (workspace: string) => inWorkspace(upstreamReports.partialError, workspace));
    const outcome = await startMaaToolsRun({
        workspaceRoot: root,
        nodePath: process.execPath,
        testFiles: [
            "tests/test_a.json",
            "tests/test_b.json",
        ],
    }).done;
    assert.notEqual(outcome.errorCode, "invalid-result");
    assert.ok(outcome.error);
    assert.equal(outcome.fileResults.get("tests/test_b.json"), "pass");
    assert.equal(outcome.caseResults.get("tests/test_a.json#1")?.verdict, "error");
    assert.equal(outcome.fileResults.size, 2);
});

test("部分平台缺图不能输出全部平台都未验证的说明", async (t) => {
    const {root} = fakeWorkspace(t, (workspace: string) => inWorkspace(upstreamReports.partialMissing, workspace));
    let log = "";
    const outcome = await startMaaToolsRun(
        {workspaceRoot: root, nodePath: process.execPath, testFiles: ["tests/test_a.json"]},
        {onOutput: (chunk) => (log += chunk)},
    ).done;
    assert.equal(outcome.error, undefined);
    assert.equal(outcome.fileResults.get("tests/test_a.json"), "pass");
    assert.equal(outcome.caseResults.get("tests/test_a.json#1")?.verdict, "skipped");
    assert.doesNotMatch(log, /本次所有平台都因缺图跳过/);
});

test("取消丢弃半截结果；进程无法启动有明确错误代码", async (t) => {
    const {root} = fakeWorkspace(t, null, {hang: true});
    const flow = startMaaToolsRun({workspaceRoot: root, nodePath: process.execPath, testFiles: ["tests/test_a.json"]});
    flow.cancel();
    const cancelled = await flow.done;
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.error, undefined);
    const failed = await startMaaToolsRun({
        workspaceRoot: root,
        nodePath: path.join(root, "missing-node"),
        testFiles: ["tests/test_a.json"],
    }).done;
    assert.equal(failed.errorCode, "process-start-failed");
});

test("实际发现传--list --json、文件过滤与自定义配置，并转换绝对file", async (t) => {
    const {root, argsFile} = fakeWorkspace(t, (workspace: string) => ({
        schemaVersion: 1,
        files: fixtureResult(workspace).files,
    }));
    const listed = await collectTests({
        workspaceRoot: root,
        nodePath: process.execPath,
        configPath: "custom.mts",
        files: ["tests/test_a.json"],
    });
    assert.equal(listed.doc?.files[0].file, "tests/test_a.json");
    assert.deepEqual(JSON.parse(readFileSync(argsFile, "utf8")), [
        "test",
        "--list",
        "--json",
        "--file",
        "tests/test_a.json",
        "custom.mts",
    ]);
    const error = fakeWorkspace(t, {
        schemaVersion: 1,
        status: "error",
        files: [],
        groups: [],
        durationMs: 0,
        errorCode: "collection-source-missing",
        reason: "loader discarded origin",
    });
    const rejected = await collectTests({workspaceRoot: error.root, nodePath: process.execPath});
    assert.equal(rejected.doc, null);
    assert.match(rejected.stderr, /collection-source-missing/);
});

test("发现收到可读列表时明确失败，不把终端文案当成结构化清单", async (t) => {
    const {root} = fakeWorkspace(t, null);
    const cli = path.join(root, "node_modules/@nekosu/maa-tools/bin/maa-tools");
    writeFileSync(cli, 'process.stdout.write("测试文件：tests/test_a.json\\n  用例 1\\n");');
    const listed = await collectTests({workspaceRoot: root, nodePath: process.execPath});
    assert.equal(listed.doc, null);
    assert.match(listed.stderr, /收集结果不符合约定/);
    assert.match(listed.stderr, /测试文件：tests\/test_a.json/);
});

test("进程非零退出不得接受passed结果", async (t) => {
    const {root} = fakeWorkspace(t, (workspace: string) => fixtureResult(workspace), {exitCode: 1});
    const outcome = await startMaaToolsRun({
        workspaceRoot: root,
        nodePath: process.execPath,
        testFiles: ["tests/test_a.json"],
    }).done;
    assert.equal(outcome.errorCode, "invalid-result");
    assert.match(outcome.error!, /退出码/);
});

function liveCase(workspace: string, index: number): TestRunEvent {
    return {
        schemaVersion: 1,
        type: "case-result",
        origin: {file: `${workspace}/tests/test_a.json`, case: index},
        result: fixtureResult(workspace, [index]),
    };
}

function liveFile(workspace: string): TestRunEvent {
    return {
        schemaVersion: 1,
        type: "file-result",
        file: `${workspace}/tests/test_a.json`,
        result: fixtureResult(workspace),
    };
}

test("无UI回调也消费JSONL进度，子进程只有标准管道", async (t) => {
    const {root} = fakeWorkspace(t, (workspace: string) => fixtureResult(workspace), {
        events: (workspace) => [liveCase(workspace, 1)],
    });
    const outcome = await startMaaToolsRun({
        workspaceRoot: root,
        nodePath: process.execPath,
        testFiles: ["tests/test_a.json"],
    }).done;
    assert.equal(outcome.error, undefined);
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, "transport.json"), "utf8")), {
        send: "undefined",
        channel: false,
    });
});

test("即时结果在最终JSON产生前交付，缺少的事件由最终结果补全", async (t) => {
    const {root} = fakeWorkspace(t, (workspace: string) => fixtureResult(workspace), {
        events: (workspace) => [liveCase(workspace, 1)],
        waitForRelease: true,
    });
    const received: TestRunEvent[] = [];
    const outcome = await startMaaToolsRun(
        {workspaceRoot: root, nodePath: process.execPath, testFiles: ["tests/test_a.json"]},
        {
            onProgress: (event) => {
                received.push(event);
                writeFileSync(path.join(root, "release-final"), "ready");
            },
        },
    ).done;
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, "transport.json"), "utf8")), {
        send: "undefined",
        channel: false,
    });
    assert.equal(received.length, 1);
    assert.equal(outcome.error, undefined);
    assert.equal(outcome.caseResults.size, 2);
});

test("用户取消保留已完成case，尚无file-result时文件不算完成", async (t) => {
    const {root} = fakeWorkspace(t, null, {events: (workspace) => [liveCase(workspace, 1)], hang: true});
    let flow: ReturnType<typeof startMaaToolsRun>;
    flow = startMaaToolsRun(
        {workspaceRoot: root, nodePath: process.execPath, testFiles: ["tests/test_a.json"]},
        {onProgress: () => flow.cancel()},
    );
    const outcome = await flow.done;
    assert.equal(outcome.cancelled, true);
    assert.equal(outcome.error, undefined);
    assert.equal(outcome.caseResults.get("tests/test_a.json#1")?.verdict, "pass");
    assert.equal(outcome.fileResults.size, 0);
});

test("取消保留file-result已经完成的文件与全部用例", async (t) => {
    const {root} = fakeWorkspace(t, null, {events: (workspace) => [liveFile(workspace)], hang: true});
    let flow: ReturnType<typeof startMaaToolsRun>;
    flow = startMaaToolsRun(
        {workspaceRoot: root, nodePath: process.execPath, testFiles: ["tests/test_a.json"]},
        {onProgress: () => flow.cancel()},
    );
    const outcome = await flow.done;
    assert.equal(outcome.cancelled, true);
    assert.equal(outcome.fileResults.get("tests/test_a.json"), "pass");
    assert.equal(outcome.caseResults.size, 2);
});

test("非法完整记录终止进程并清除此前已发布的通过，不抛出未捕获异常", async (t) => {
    const {root} = fakeWorkspace(t, fixtureResult(), {
        events: (workspace) => [
            liveCase(workspace, 1),
            {schemaVersion: 2, type: "case-started", origin: {file: `${workspace}/tests/test_a.json`, case: 3}},
        ],
        hang: true,
    });
    let published = 0;
    const outcome = await startMaaToolsRun(
        {workspaceRoot: root, nodePath: process.execPath, testFiles: ["tests/test_a.json"]},
        {onProgress: () => published++},
    ).done;
    assert.equal(published, 1);
    assert.equal(outcome.errorCode, "invalid-result");
    assert.equal(outcome.cancelled, false);
    assert.equal(outcome.caseResults.size, 0);
});

test("实时消息处理出错优先于同时发生的用户取消", async (t) => {
    const {root} = fakeWorkspace(t, null, {events: (workspace) => [liveCase(workspace, 1)], hang: true});
    let flow: ReturnType<typeof startMaaToolsRun>;
    flow = startMaaToolsRun(
        {workspaceRoot: root, nodePath: process.execPath, testFiles: ["tests/test_a.json"]},
        {
            onProgress: () => {
                flow.cancel();
                throw new Error("回调无法处理结果");
            },
        },
    );
    const outcome = await flow.done;
    assert.equal(outcome.cancelled, true);
    assert.equal(outcome.errorCode, "invalid-result");
    assert.equal(outcome.caseResults.size, 0);
});

test("合法进程异常保留已验证完成事实，仍报告运行错误", async (t) => {
    const {root} = fakeWorkspace(t, null, {events: (workspace) => [liveCase(workspace, 1)], terminate: true});
    const outcome = await startMaaToolsRun(
        {workspaceRoot: root, nodePath: process.execPath, testFiles: ["tests/test_a.json"]},
        {onProgress: () => {}},
    ).done;
    assert.equal(outcome.errorCode, "process-terminated");
    assert.equal(outcome.caseResults.get("tests/test_a.json#1")?.verdict, "pass");
    assert.equal(outcome.fileResults.size, 0);
});

test("最终报告与完成事件矛盾时报告协议错误而不保留通过", async (t) => {
    const {root} = fakeWorkspace(
        t,
        (workspace: string) => {
            const result = fixtureResult(workspace);
            result.files[0].cases[0].reason = "changed after progress";
            return result;
        },
        {events: (workspace) => [liveCase(workspace, 1)]},
    );
    const outcome = await startMaaToolsRun(
        {workspaceRoot: root, nodePath: process.execPath, testFiles: ["tests/test_a.json"]},
        {onProgress: () => {}},
    ).done;
    assert.equal(outcome.errorCode, "invalid-result");
    assert.match(outcome.error!, /已完成用例结果不一致/);
    assert.equal(outcome.caseResults.size, 0);
});

test("相同重复事件只交付一次，缺失事件不阻止接受完整最终结果", async (t) => {
    const {root} = fakeWorkspace(t, (workspace: string) => fixtureResult(workspace), {
        events: (workspace) => [
            liveCase(workspace, 1),
            liveCase(workspace, 1),
            liveFile(workspace),
        ],
    });
    const types: string[] = [];
    const outcome = await startMaaToolsRun(
        {workspaceRoot: root, nodePath: process.execPath, testFiles: ["tests/test_a.json"]},
        {onProgress: (event) => types.push(event.type)},
    ).done;
    assert.equal(outcome.error, undefined);
    assert.deepEqual(types, [
        "case-result",
        "file-result",
    ]);
});

function finalLine(workspace: string): string {
    return JSON.stringify({schemaVersion: 1, type: "run-result", result: fixtureResult(workspace)}) + "\n";
}

test("JSONL处理中文UTF8拆字节、CRLF及一块多行", async (t) => {
    for (const chunkSize of [
        1,
        undefined,
    ]) {
        const {root} = fakeWorkspace(t, (workspace: string) => fixtureResult(workspace), {
            chunkSize,
            crlf: true,
            events: (workspace) => [
                liveCase(workspace, 1),
                liveCase(workspace, 3),
                liveFile(workspace),
            ],
        });
        const types: string[] = [];
        const outcome = await startMaaToolsRun(
            {workspaceRoot: root, nodePath: process.execPath, testFiles: ["tests/test_a.json"]},
            {onProgress: (event) => types.push(event.type)},
        ).done;
        assert.equal(outcome.error, undefined);
        assert.equal(outcome.entries[0].cases[0].name, "用例 1");
        assert.deepEqual(types, [
            "case-result",
            "case-result",
            "file-result",
        ]);
    }
});

test("JSONL单行超过64KB且跨多个块仍读取完整报告", async (t) => {
    const reason = "完整中文报告".repeat(20000);
    const {root} = fakeWorkspace(t, (workspace: string) => ({...fixtureResult(workspace), reason}), {chunkSize: 8192});
    const outcome = await startMaaToolsRun({
        workspaceRoot: root,
        nodePath: process.execPath,
        testFiles: ["tests/test_a.json"],
    }).done;
    assert.equal(outcome.error, undefined);
    assert.equal(outcome.result?.reason, reason);
});

test("未知header、完整坏行、重复终条或终条后记录均清除已发布通过", async (t) => {
    for (const kind of [
        "bad-json",
        "schema",
        "type",
        "duplicate-final",
        "after-final",
        "blank",
    ] as const) {
        const {root} = fakeWorkspace(t, null, {
            rawStream: (workspace) => {
                const first = JSON.stringify(liveCase(workspace, 1)) + "\n";
                const invalid =
                    kind === "bad-json"
                        ? "{broken}\n"
                        : kind === "schema"
                          ? JSON.stringify({schemaVersion: 2, type: "run-result", result: fixtureResult(workspace)}) +
                            "\n"
                          : kind === "type"
                            ? '{"schemaVersion":1,"type":"unknown"}\n'
                            : kind === "duplicate-final"
                              ? finalLine(workspace) + finalLine(workspace)
                              : kind === "after-final"
                                ? finalLine(workspace) + first
                                : "\n";
                return first + invalid;
            },
        });
        let published = 0;
        const outcome = await startMaaToolsRun(
            {workspaceRoot: root, nodePath: process.execPath, testFiles: ["tests/test_a.json"]},
            {onProgress: () => published++},
        ).done;
        assert.equal(outcome.errorCode, "invalid-result", kind);
        assert.equal(outcome.caseResults.size, 0, kind);
        assert.equal(published, 1, kind);
    }
});

test("正常退出缺少run-result、终条无换行或尾部截断均报错", async (t) => {
    for (const kind of [
        "no-final",
        "no-newline",
        "truncated",
        "tail-after-final",
    ] as const) {
        const {root} = fakeWorkspace(t, null, {
            rawStream: (workspace) =>
                JSON.stringify(liveCase(workspace, 1)) +
                "\n" +
                (kind === "no-final"
                    ? ""
                    : kind === "no-newline"
                      ? finalLine(workspace).trimEnd()
                      : kind === "truncated"
                        ? '{"schemaVersion":1,'
                        : finalLine(workspace) + "{"),
        });
        const outcome = await startMaaToolsRun({
            workspaceRoot: root,
            nodePath: process.execPath,
            testFiles: ["tests/test_a.json"],
        }).done;
        assert.equal(outcome.errorCode, "invalid-result", kind);
        assert.equal(outcome.caseResults.size, 0, kind);
    }
});

test("无UI回调也拒绝进度与最终报告矛盾", async (t) => {
    const {root} = fakeWorkspace(
        t,
        (workspace: string) => {
            const result = fixtureResult(workspace);
            result.files[0].cases[0].reason = "changed";
            return result;
        },
        {events: (workspace) => [liveCase(workspace, 1)]},
    );
    const outcome = await startMaaToolsRun({
        workspaceRoot: root,
        nodePath: process.execPath,
        testFiles: ["tests/test_a.json"],
    }).done;
    assert.equal(outcome.errorCode, "invalid-result");
    assert.equal(outcome.caseResults.size, 0);
});

test("用户取消留下的半行不抹掉完成事实，完整坏行仍优先于取消", async (t) => {
    for (const completeBadLine of [
        false,
        true,
    ]) {
        const {root} = fakeWorkspace(t, null, {
            hang: true,
            rawStream: (workspace) =>
                JSON.stringify(liveCase(workspace, 1)) +
                "\n" +
                (completeBadLine ? "{broken}\n" : '{"schemaVersion":1,'),
        });
        let flow: ReturnType<typeof startMaaToolsRun>;
        flow = startMaaToolsRun(
            {workspaceRoot: root, nodePath: process.execPath, testFiles: ["tests/test_a.json"]},
            {onProgress: () => flow.cancel()},
        );
        const outcome = await flow.done;
        assert.equal(outcome.cancelled, true);
        assert.equal(outcome.errorCode, completeBadLine ? "invalid-result" : undefined);
        assert.equal(outcome.caseResults.size, completeBadLine ? 0 : 1);
    }
});

test("信号终止且末尾半行时保留已完成事实", async (t) => {
    const {root} = fakeWorkspace(t, null, {
        terminate: true,
        rawStream: (workspace) => JSON.stringify(liveCase(workspace, 1)) + '\n{"schemaVersion":1,',
    });
    const outcome = await startMaaToolsRun({
        workspaceRoot: root,
        nodePath: process.execPath,
        testFiles: ["tests/test_a.json"],
    }).done;
    assert.equal(outcome.errorCode, "process-terminated");
    assert.equal(outcome.caseResults.get("tests/test_a.json#1")?.verdict, "pass");
});

test("标准close等待主进程退出后仍未排空的管道", {timeout: 5000}, async (t) => {
    const {root} = fakeWorkspace(t, null);
    const cli = path.join(root, "node_modules/@nekosu/maa-tools/bin/maa-tools");
    writeFileSync(
        cli,
        [
            "process.stdout.write('{\"value\":');",
            `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify("setTimeout(() => { process.stdout.write('\"ready\"}'); process.stderr.write('late-stderr'); }, 100);")}], {stdio:['ignore',1,2]}).unref();`,
        ].join("\n"),
    );
    let exited = false;
    let lateAfterExit = false;
    const result = await runChild(
        root,
        process.execPath,
        [cli],
        (chunk) => {
            if (chunk.includes("late-stderr")) lateAfterExit = exited;
        },
        (child) => {
            child.once("exit", () => {
                exited = true;
            });
            t.after(() => child.kill());
        },
    );
    assert.equal(lateAfterExit, true);
    assert.deepEqual(result.parsed, {value: "ready"});
    assert.equal(result.stderr, "late-stderr");
});

test("取消保留已经收到file-result的空选择跳过，不误报协议错误", async (t) => {
    const {root} = fakeWorkspace(t, null, {
        hang: true,
        events: (workspace) => {
            const result = fixtureResult(workspace, []);
            result.status = "empty";
            result.errorCode = "no-tests-matched";
            result.groups = [];
            result.files[0].verdict = "skipped";
            result.files[0].reason = "no-cases-selected";
            return [{schemaVersion: 1, type: "file-result", file: result.files[0].file, result}];
        },
    });
    let flow: ReturnType<typeof startMaaToolsRun>;
    flow = startMaaToolsRun(
        {
            workspaceRoot: root,
            nodePath: process.execPath,
            testFiles: ["tests/test_a.json"],
            expectedCases: new Map([
                [
                    "tests/test_a.json",
                    [],
                ],
            ]),
        },
        {onProgress: () => flow.cancel()},
    );
    const outcome = await flow.done;
    assert.equal(outcome.cancelled, true);
    assert.equal(outcome.errorCode, undefined);
    assert.equal(outcome.fileResults.get("tests/test_a.json"), "skipped");
    assert.equal(outcome.counts.get("tests/test_a.json"), 0);
    assert.equal(outcome.caseResults.size, 0);
});
