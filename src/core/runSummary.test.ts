import {strict as assert} from "node:assert";
import {test} from "node:test";
import {buildBatchRunTitle, buildRunSummary, buildRunTitle, formatDuration} from "./runSummary";
import type {SummaryCase, SummaryFile} from "./runSummary";

const pass = (caseIndex: number): SummaryCase => ({caseIndex, verdict: "pass", title: "通过"});
function file(overrides: Partial<SummaryFile> = {}): SummaryFile {
    return {
        relativePath: "tests/A/test_a.json",
        verdict: "pass",
        caseCount: 3,
        cases: [
            pass(0),
            pass(1),
            pass(2),
        ],
        ...overrides,
    };
}

test("标题用相对路径，跑单例时补「第 N 个用例」", () => {
    assert.equal(buildRunTitle("tests/a/test_a.json"), "tests/a/test_a.json");
    assert.equal(buildRunTitle("tests/a/test_a.json", 2), "tests/a/test_a.json 第 3 个用例");
});

test("批量标题：一个文件用单文件标题，多个写数量和第一个文件", () => {
    assert.equal(buildBatchRunTitle([]), "0 个测试文件");
    assert.equal(buildBatchRunTitle(["tests/a/test_a.json"]), "tests/a/test_a.json");
    assert.equal(
        buildBatchRunTitle([
            "tests/a/test_a.json",
            "tests/b/test_b.json",
        ]),
        "2 个测试文件（批量，含 tests/a/test_a.json 等）",
    );
});

test("全部通过：只统计明确返回的通过结果，不逐条刷屏", () => {
    assert.deepEqual(
        buildRunSummary({
            files: [
                file(),
                file({relativePath: "tests/B/test_b.json"}),
            ],
            durationMs: 18_400,
        }),
        [
            "━━━━ 结果 ━━━━",
            "结论：通过",
            "文件 2 个：通过 2",
            "用例 6 条：通过 6",
            "耗时 18 秒",
            "━━━━ 结果 ━━━━",
        ],
    );
});

test("有失败：失败用例逐条列出，通过只计入数字", () => {
    const lines = buildRunSummary({
        files: [
            file(),
            file({
                relativePath: "tests/B/test_b.json",
                verdict: "fail",
                cases: [
                    pass(0),
                    {caseIndex: 1, verdict: "fail", title: "ADB-官服 失败"},
                    pass(2),
                ],
            }),
        ],
        durationMs: 34_200,
    });
    assert.ok(lines.includes("结论：没通过 —— 1 个文件失败"));
    assert.ok(lines.includes("用例 6 条：通过 5 · 失败 1"));
    assert.ok(lines.includes("  tests/B/test_b.json · 第 2 条 ADB-官服 失败"));
    assert.ok(!lines.some((line) => line.includes("· 第 1 条 通过")));
});

test("部分平台缺图：文件通过，用例计跳过并说明平台验证不完整", () => {
    const lines = buildRunSummary({
        files: [
            file({
                cases: [
                    {caseIndex: 0, verdict: "skipped", title: "CloudADB-官服 缺图跳过"},
                    pass(1),
                    pass(2),
                ],
            }),
        ],
        durationMs: 4_000,
    });
    assert.ok(lines.includes("结论：通过（其中 1 条用例未在全部平台完成验证）"));
    assert.ok(lines.includes("用例 3 条：通过 2 · 缺图跳过 1"));
    assert.ok(lines.includes("缺图跳过（1 条，不算失败）："));
});

test("唯一聚合用例 skipped 但部分平台已验证时，采用上游文件 pass", () => {
    const lines = buildRunSummary({
        files: [
            file({
                caseCount: 1,
                cases: [
                    {caseIndex: 2, verdict: "skipped", title: "B 平台缺图，A 平台已通过"},
                ],
            }),
        ],
        durationMs: 2_100,
    });
    assert.ok(lines.includes("结论：通过（其中 1 条用例未在全部平台完成验证）"));
    assert.ok(lines.includes("用例 1 条：通过 0 · 缺图跳过 1"));
    assert.ok(!lines.some((line) => line.includes("没有验证到")));
});

test("全缺图：采用上游文件 error，用例保持 skipped", () => {
    const lines = buildRunSummary({
        files: [
            file({
                verdict: "error",
                caseCount: 1,
                reason: "全部平台缺图",
                cases: [
                    {caseIndex: 2, verdict: "skipped", title: "全部平台缺图"},
                ],
            }),
        ],
        durationMs: 2_100,
    });
    assert.ok(lines.includes("结论：没通过 —— 1 个文件没有完成验证；另有 1 条缺图跳过"));
    assert.ok(lines.includes("用例 1 条：通过 0 · 缺图跳过 1"));
    assert.ok(lines.includes("  tests/A/test_a.json · 全部平台缺图"));
});

test("前置错误且没有用例结果：通过数是0，缺项独立列出", () => {
    const lines = buildRunSummary({
        files: [file({verdict: "error", cases: [], reason: "配置加载失败"})],
        durationMs: 100,
    });
    assert.ok(lines.includes("用例 3 条：通过 0 · 未返回结果 3"));
    assert.ok(lines.includes("未返回结果（3 条）："));
    assert.ok(lines.includes("  tests/A/test_a.json · 配置加载失败"));
});

test("已明确标成前置错误的用例不计入通过", () => {
    const lines = buildRunSummary({
        files: [
            file({
                verdict: "error",
                caseCount: 2,
                cases: [
                    {caseIndex: 0, verdict: "error", title: "配置加载失败"},
                    {caseIndex: 1, verdict: "error", title: "配置加载失败"},
                ],
            }),
        ],
        durationMs: 1_200,
    });
    assert.ok(lines.includes("用例 2 条：通过 0 · 没有完成验证 2"));
});

test("只有部分用例结果时，不用总数减问题数编造通过", () => {
    const lines = buildRunSummary({files: [file({verdict: "error", cases: [pass(0)]})], durationMs: 1_200});
    assert.ok(lines.includes("用例 3 条：通过 1 · 未返回结果 2"));
    assert.ok(!lines.some((line) => line.includes("用例 3 条：通过 3")));
});

test("有文件级错误和另一文件用例级错误时，两份原因都展示", () => {
    const lines = buildRunSummary({
        files: [
            file({
                relativePath: "tests/A/test_bad.json",
                verdict: "error",
                caseCount: 0,
                cases: [],
                reason: "JSON 解析失败",
            }),
            file({verdict: "error", caseCount: 1, cases: [{caseIndex: 0, verdict: "error", title: "执行中断"}]}),
        ],
        durationMs: 100,
    });
    assert.ok(lines.includes("  tests/A/test_bad.json · JSON 解析失败"));
    assert.ok(lines.includes("  tests/A/test_a.json · 第 1 条 执行中断"));
});

test("坏文件不影响其它文件的明确通过计数", () => {
    const lines = buildRunSummary({
        files: [
            file(),
            file({
                relativePath: "tests/B/test_bad.json",
                verdict: "error",
                caseCount: 0,
                cases: [],
                reason: "JSON 解析失败",
            }),
        ],
        durationMs: 100,
    });
    assert.ok(lines.includes("文件 2 个：通过 1 · 没有完成验证 1"));
    assert.ok(lines.includes("用例 3 条：通过 3"));
    assert.ok(lines.includes("结论：没通过 —— 1 个文件没有完成验证"));
});

test("文件失败却没有用例结果时，点名文件且不计用例通过", () => {
    const lines = buildRunSummary({files: [file({verdict: "fail", cases: []})], durationMs: 3_000});
    assert.ok(lines.includes("失败（1 个文件，没拿到逐用例原因）："));
    assert.ok(lines.includes("  tests/A/test_a.json · 展开这个节点看原因"));
    assert.ok(lines.includes("用例 3 条：通过 0 · 未返回结果 3"));
});

test("顶层运行错误不覆盖有效文件计数，但整批不能显示通过", () => {
    const lines = buildRunSummary({files: [file()], durationMs: 10, error: "配置展开时发生全局错误"});
    assert.ok(lines.includes("结论：没通过 —— 运行报告错误"));
    assert.ok(lines.includes("文件 1 个：通过 1"));
    assert.ok(lines.includes("用例 3 条：通过 3"));
    assert.ok(lines.includes("运行错误："));
    assert.ok(lines.includes("  配置展开时发生全局错误"));
});

test("全局错误和部分文件错误都展示，正常文件仍保留通过", () => {
    const lines = buildRunSummary({
        files: [
            file(),
            file({verdict: "error", relativePath: "tests/B/bad.json", caseCount: 0, cases: [], reason: "文件读不了"}),
        ],
        durationMs: 10,
        error: "收集发生错误",
    });
    assert.ok(lines.includes("结论：没通过 —— 1 个文件没有完成验证"));
    assert.ok(lines.includes("文件 2 个：通过 1 · 没有完成验证 1"));
    assert.ok(lines.includes("  收集发生错误"));
    assert.ok(lines.includes("  tests/B/bad.json · 文件读不了"));
});

test("空结果不能说通过", () => {
    const lines = buildRunSummary({files: [], durationMs: 0});
    assert.ok(lines.includes("结论：没有验证到任何用例"));
});

test("取消：只报状态和耗时，不给通过判断和计数", () => {
    assert.deepEqual(buildRunSummary({files: [file()], durationMs: 900, cancelled: true}), [
        "━━━━ 结果 ━━━━",
        "结论：已取消（运行被中断，结果不完整）",
        "耗时 0.9 秒",
        "━━━━ 结果 ━━━━",
    ]);
});

test("耗时格式保留秒与分秒", () => {
    assert.equal(formatDuration(0), "0.0 秒");
    assert.equal(formatDuration(420), "0.4 秒");
    assert.equal(formatDuration(18_400), "18 秒");
    assert.equal(formatDuration(60_000), "1 分");
    assert.equal(formatDuration(125_000), "2 分 5 秒");
    assert.equal(formatDuration(Number.NaN), "0.0 秒");
});
