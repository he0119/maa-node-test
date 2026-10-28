import {strict as assert} from "node:assert";
import {test} from "node:test";

import {caseKeyOf, planFileMarking} from "../core/testMarks";
import {fileNodeId, caseNodeId} from "../core/testTree";
import {buildRunSummary} from "../core/runSummary";
import {fixtureResult} from "./result-builders.test-helper";
import {displayPath, pathKey, resolveFromWorkspace} from "../core/paths";
import {RunProgress} from "./progress";
import {validateListDocument, validateResultDocument, type ResultDocument, type TestRunEvent} from "./protocol";
import {adaptResultFiles, overallVerdict} from "./resultAdapter";
import {renderFileResults} from "./output";

function onPlatform<T>(platform: NodeJS.Platform, action: () => T): T {
    const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", {...descriptor, value: platform});
    try {
        return action();
    } finally {
        Object.defineProperty(process, "platform", descriptor);
    }
}

function emptyResult(file = "/repo/tests/test_b.json"): ResultDocument {
    const result = fixtureResult();
    result.status = "empty";
    result.errorCode = "no-tests-matched";
    result.groups = [];
    result.files = [
        {...result.files[0], file, verdict: "skipped", reason: "no-cases-selected", selectedCases: [], cases: []},
    ];
    return result;
}

function mixed(failed = false): ResultDocument {
    const result = fixtureResult("/repo", [1]);
    result.files.push(emptyResult().files[0]);
    if (failed) {
        result.status = "failed";
        result.files[0].verdict = "fail";
        result.files[0].cases[0].verdict = "fail";
        result.groups[0].verdict = "fail";
        result.groups[0].cases[0].verdict = "fail";
        result.groups[0].cases[0].checks[0].ok = false;
    }
    return result;
}

const selection = {
    workspaceRoot: "/repo",
    testFiles: [
        "tests/test_a.json",
        "tests/test_b.json",
    ],
};
const emptySelection = {workspaceRoot: "/repo", testFiles: ["tests/test_b.json"]};

test("空选择文件可与实际pass/fail混合；全空仍empty，不能冒充passed", () => {
    for (const failed of [
        false,
        true,
    ])
        assert.equal(validateResultDocument(mixed(failed), selection).status, failed ? "failed" : "passed");
    assert.equal(validateResultDocument(emptyResult(), emptySelection).status, "empty");
    const passed = emptyResult();
    passed.status = "passed";
    assert.throws(() => validateResultDocument(passed, emptySelection), /没有实际验证通过/);
    const bad = emptyResult();
    bad.files[0].verdict = "error";
    bad.files[0].error = "bad-file";
    bad.files[0].reason = "test-file-error";
    assert.equal(validateResultDocument(bad, emptySelection).status, "empty");
    const withError = mixed();
    withError.status = "error";
    withError.files[1] = bad.files[0];
    assert.equal(validateResultDocument(withError, selection).status, "error");
});

test("文件跳过必须空选择且无文件错误，不能隐藏单case或收集清单缺项", () => {
    for (const mutation of [
        "error",
        "reason",
        "cases",
        "selected",
        "pass",
    ] as const) {
        const result = emptyResult();
        if (mutation === "error") result.files[0].error = "broken";
        if (mutation === "reason") result.files[0].reason = "missing-image";
        if (mutation === "cases") {
            result.files[0].cases = fixtureResult().files[0].cases;
            result.files[0].selectedCases = [
                1,
                3,
            ];
        }
        if (mutation === "selected") result.files[0].selectedCases = [1];
        if (mutation === "pass") result.files[0].verdict = "pass";
        assert.throws(() => validateResultDocument(result, emptySelection), Error, mutation);
    }
    assert.throws(() => validateResultDocument(emptyResult(), {...emptySelection, caseIndex: 1}), /下标不完整/);
    assert.throws(
        () =>
            validateResultDocument(emptyResult(), {
                ...emptySelection,
                expectedCases: new Map([
                    [
                        "tests/test_b.json",
                        [1],
                    ],
                ]),
            }),
        /下标不完整/,
    );
    validateResultDocument(emptyResult(), {
        ...emptySelection,
        expectedCases: new Map([
            [
                "tests/test_b.json",
                [],
            ],
        ]),
    });
});

test("空文件完成快照可去重、最终核对并保留取消事实，但不能吞掉已开始用例", () => {
    const progress = new RunProgress({
        ...selection,
        expectedCases: new Map([
            [
                "tests/test_a.json",
                [1],
            ],
            [
                "tests/test_b.json",
                [],
            ],
        ]),
    });
    const event: TestRunEvent = {
        type: "file-result",
        file: "/repo/tests/test_b.json",
        result: emptyResult(),
    };
    assert.ok(progress.accept(event));
    assert.equal(progress.accept(event), null);
    progress.checkFinal(validateResultDocument(mixed(), selection));
    const partial = progress.partial();
    assert.equal(partial.fileResults.get("tests/test_b.json"), "skipped");
    assert.equal(partial.counts.get("tests/test_b.json"), 0);
    assert.equal(partial.caseResults.size, 0);
    const started = new RunProgress(emptySelection);
    started.accept({type: "case-started", origin: {file: "/repo/tests/test_b.json", case: 1}});
    assert.throws(() => started.accept(event), /遗漏已经开始/);
});

test("筛选跳过文件单独计数和显示，不能算绿或混成缺图跳过", () => {
    const adapted = adaptResultFiles(mixed(), "/repo");
    assert.equal(overallVerdict(adapted.fileResults), "pass");
    assert.equal(overallVerdict(adaptResultFiles(emptyResult(), "/repo").fileResults), "empty");
    assert.equal(overallVerdict(adaptResultFiles(mixed(true), "/repo").fileResults), "fail");
    assert.equal(planFileMarking("tests/test_b.json", "skipped", []).file.verdict, "skipped");
    assert.match(
        renderFileResults(adapted.entries, adapted.fileResults).join("\n"),
        /↷ tests\/test_b.json：本次筛选未选择用例/,
    );
    const summary = buildRunSummary({
        durationMs: 1,
        files: [
            {
                relativePath: "tests/test_a.json",
                verdict: "pass",
                caseCount: 1,
                cases: [{caseIndex: 1, verdict: "skipped", title: "缺图"}],
            },
            {relativePath: "tests/test_b.json", verdict: "skipped", caseCount: 0, cases: []},
        ],
    }).join("\n");
    assert.match(summary, /文件 2 个：通过 1 · 筛选跳过 1/);
    assert.match(summary, /筛选跳过（1 个文件）/);
    assert.match(summary, /缺图跳过（1 条/);
    const empty = buildRunSummary({
        durationMs: 0,
        files: [{relativePath: "empty", verdict: "skipped", caseCount: 0, cases: []}],
    }).join("\n");
    assert.match(empty, /本次筛选未选择可运行用例/);
    assert.doesNotMatch(empty, /结论：通过/);
});

function source(result: ResultDocument, file: string): ResultDocument {
    for (const entry of result.files) {
        entry.file = file;
        for (const testCase of entry.cases)
            for (const platform of testCase.platforms) platform.result.origin!.file = file;
    }
    for (const group of result.groups) for (const testCase of group.cases) testCase.origin!.file = file;
    return result;
}

test("Windows请求/来源/expectedCases、事件去重和最终核对共享身份，内容仍严格", () =>
    onPlatform("win32", () => {
        const requested = {
            workspaceRoot: "C:/Repo",
            testFiles: ["Tests/TEST_A.json"],
            expectedCases: new Map([
                [
                    "tests/test_A.JSON",
                    [1],
                ],
            ]),
        };
        const first = source(fixtureResult("C:/Repo", [1]), "c:\\REPO\\Tests\\Test_A.json");
        first.files[0].cases[0].name = "Case One";
        first.groups = structuredClone(first.groups);
        first.groups[0].cases[0].origin!.file = "C:/repo/TESTS/test_a.JSON";
        validateResultDocument(first, requested);
        const progress = new RunProgress(requested);
        const event: TestRunEvent = {
            type: "case-result",
            origin: {file: "C:/REPO/tests/TEST_a.JSON", case: 1},
            result: first,
        };
        assert.ok(progress.accept(event));
        const upper = source(structuredClone(first), "C:/REPO/TESTS/TEST_A.JSON");
        for (const group of upper.groups) for (const item of group.cases) item.imagePath = item.imagePath.toUpperCase();
        for (const item of upper.files[0].cases)
            for (const platform of item.platforms) platform.result.imagePath = platform.result.imagePath.toUpperCase();
        assert.equal(progress.accept({...event, origin: {file: upper.files[0].file, case: 1}, result: upper}), null);
        progress.checkFinal(validateResultDocument(upper, requested));
        const changed = structuredClone(upper);
        changed.files[0].cases[0].name = "CASE ONE";
        assert.throws(() => progress.accept({...event, result: changed}), /矛盾/);
        progress.accept({type: "file-result", file: upper.files[0].file, result: upper});
        const partial = progress.partial();
        assert.equal(partial.fileResults.get(pathKey("Tests/Test_A.json")), "pass");
        assert.equal(partial.caseResults.get(caseKeyOf("TESTS/test_A.JSON", 1))?.verdict, "pass");
        assert.equal(displayPath("C:/repo", "C:/REPO/Tests/Test_A.json"), "Tests/Test_A.json");
        const mapped = adaptResultFiles(first, "C:/repo");
        assert.equal(mapped.entries[0].key, "Tests/Test_A.json");
        assert.equal(mapped.caseResults.get(caseKeyOf("tests/TEST_A.JSON", 1))?.verdict, "pass");
        assert.equal(fileNodeId("c:/Repo/TESTS/test_a.json"), fileNodeId("C:\\REPO\\tests\\TEST_A.JSON"));
        assert.equal(caseNodeId("c:/Repo/TESTS/test_a.json", 1), caseNodeId("C:\\REPO\\tests\\TEST_A.JSON", 1));
        const duplicate = structuredClone(first.files[0]);
        duplicate.file = upper.files[0].file;
        assert.throws(
            () =>
                validateListDocument({
                    files: [
                        first.files[0],
                        duplicate,
                    ],
                }),
            /重复返回测试文件/,
        );
        const skip = emptyResult(first.files[0].file);
        assert.throws(() => validateResultDocument(skip, requested), /下标不完整/);
    }));

test("非Windows保留大小写及合法反斜杠文件名，结果和用例键不能合并", () =>
    onPlatform("linux", () => {
        assert.notEqual(pathKey("/repo/A.json"), pathKey("/repo/a.json"));
        assert.notEqual(pathKey("/repo/a\\b.json"), pathKey("/repo/a/b.json"));
        const result = fixtureResult("/repo", [1]);
        const other = source(structuredClone(result), "/repo/tests\\test_a.json");
        result.files.push(other.files[0]);
        result.groups.push(...other.groups);
        validateResultDocument(result, {
            workspaceRoot: "/repo",
            testFiles: [
                "tests/test_a.json",
                "tests\\test_a.json",
            ],
        });
        const mapped = adaptResultFiles(result, "/repo");
        assert.equal(mapped.fileResults.size, 2);
        assert.equal(mapped.caseResults.size, 2);
        assert.equal(displayPath("/repo", "/repo/tests\\test_a.json"), "tests\\test_a.json");
        assert.equal(resolveFromWorkspace("/repo", "tests\\test_a.json"), "/repo/tests\\test_a.json");
        assert.notEqual(caseKeyOf("tests\\test_a.json", 1), caseKeyOf("tests/test_a.json", 1));
        assert.notEqual(fileNodeId("/repo/A.json"), fileNodeId("/repo/a.json"));
    }));

test("pathKey显式Windows规则同时接受分隔符与大小写变化", () => {
    assert.equal(pathKey("C:\\Repo\\tests\\..\\Tests\\A.json", "win32"), pathKey("c:/REPO/Tests/a.JSON", "win32"));
});
