import {strict as assert} from "node:assert";
import {test} from "node:test";
import {buildRunSummary, formatDuration} from "./runSummary";
import type {SummaryFile} from "./runSummary";

function file(overrides: Partial<SummaryFile> = {}): SummaryFile {
    return {relativePath: "tests/A/test_a.json", verdict: "pass", caseCount: 3, cases: [], ...overrides};
}

test("全部通过：只有结论、计数和耗时，不逐条列用例", () => {
    const lines = buildRunSummary({
        files: [
            file(),
            file({relativePath: "tests/B/test_b.json"}),
        ],
        durationMs: 18_400,
    });

    assert.deepEqual(lines, [
        "━━━━ 结果 ━━━━",
        "结论：通过",
        "文件 2 个：通过 2",
        "用例 6 条：通过 6",
        "耗时 18 秒",
        "━━━━ 结果 ━━━━",
    ]);
});

test("有失败：结论点名几个文件失败，失败用例逐条列出，通过的只进数字", () => {
    const lines = buildRunSummary({
        files: [
            file(),
            file({
                relativePath: "tests/B/test_b.json",
                verdict: "fail",
                cases: [
                    {caseIndex: 1, verdict: "fail", title: "ADB-官服 失败"},
                    {caseIndex: 2, verdict: "pass", title: "通过"},
                ],
            }),
        ],
        durationMs: 34_200,
    });

    assert.ok(lines.includes("结论：没通过 —— 1 个文件失败"));
    assert.ok(lines.includes("文件 2 个：通过 1 · 失败 1"));
    assert.ok(lines.includes("用例 6 条：通过 5 · 失败 1"));
    assert.ok(lines.includes("失败（1 条）："));
    assert.ok(lines.includes("  tests/B/test_b.json · 第 2 条 ADB-官服 失败"));
    // 通过的用例不进结果块
    assert.ok(!lines.some((line) => line.includes("通过：")));
});

test("缺图跳过：结论仍算通过，但要说明有几条没真正验证到", () => {
    const lines = buildRunSummary({
        files: [
            file({
                cases: [
                    {caseIndex: 0, verdict: "skipped", title: "CloudADB-官服 没验证到"},
                    {caseIndex: 1, verdict: "pass", title: "通过"},
                ],
            }),
        ],
        durationMs: 4_000,
    });

    assert.ok(lines.includes("结论：通过（其中 1 条用例缺图跳过，没有真正验证到）"));
    assert.ok(lines.includes("用例 3 条：通过 2 · 缺图跳过 1"));
    assert.ok(lines.includes("缺图跳过（1 条，不算失败）："));
    assert.ok(lines.includes("  tests/A/test_a.json · 第 1 条 CloudADB-官服 没验证到"));
});

test("没跑起来：不编造用例原因，指向上面的原始日志", () => {
    const lines = buildRunSummary({
        files: [file({relativePath: "tests/C/test_c.json", verdict: "error", caseCount: 0})],
        durationMs: 1_200,
    });

    assert.ok(lines.includes("结论：没通过 —— 1 个文件没跑起来"));
    assert.ok(lines.includes("文件 1 个：通过 0 · 没跑起来 1"));
    assert.ok(lines.includes("没跑起来（1 个文件）："));
    assert.ok(lines.includes("  tests/C/test_c.json · 原因见上面的原始日志"));
});

test("失败和没跑起来同时出现：两种原因都点名，顺序是失败在前", () => {
    const lines = buildRunSummary({
        files: [
            file({
                relativePath: "tests/B/test_b.json",
                verdict: "fail",
                cases: [{caseIndex: 0, verdict: "fail", title: "Win32-官服 失败"}],
            }),
            file({relativePath: "tests/C/test_c.json", verdict: "error", caseCount: 0}),
        ],
        durationMs: 61_000,
    });

    assert.ok(lines.includes("结论：没通过 —— 1 个文件失败、1 个文件没跑起来"));
    assert.ok(lines.indexOf("失败（1 条）：") < lines.indexOf("没跑起来（1 个文件）："));
    assert.ok(lines.includes("耗时 1 分 1 秒"));
});

test("整次运行一条都没真正跑过：不说通过，说没有验证到", () => {
    const lines = buildRunSummary({
        files: [file({caseCount: 1, cases: [{caseIndex: 2, verdict: "skipped", title: "ADB-官服 没验证到"}]})],
        durationMs: 2_100,
    });

    assert.ok(lines.includes("结论：没有验证到（1 条用例缺图跳过，不算失败）"));
    assert.ok(!lines.includes("结论：通过"));
    assert.ok(lines.includes("用例 1 条：通过 0 · 缺图跳过 1"));
});

test("取消：只报状态和耗时，不给通过/没通过，也不给计数", () => {
    const lines = buildRunSummary({files: [file()], durationMs: 900, cancelled: true});

    assert.deepEqual(lines, [
        "━━━━ 结果 ━━━━",
        "结论：已取消（运行被中断，结果不完整）",
        "耗时 0.9 秒",
        "━━━━ 结果 ━━━━",
    ]);
});

test("没拿到逐用例原因的文件级失败：点名文件而不是编造用例", () => {
    const lines = buildRunSummary({
        files: [file({verdict: "fail", cases: []})],
        durationMs: 3_000,
    });

    assert.ok(lines.includes("失败（1 个文件，没拿到逐用例原因）："));
    assert.ok(lines.includes("  tests/A/test_a.json · 展开这个节点看原因"));
});

test("耗时格式：不足 1 秒留一位小数，超过 1 分钟拆成分秒", () => {
    assert.equal(formatDuration(0), "0.0 秒");
    assert.equal(formatDuration(420), "0.4 秒");
    assert.equal(formatDuration(18_400), "18 秒");
    assert.equal(formatDuration(60_000), "1 分");
    assert.equal(formatDuration(125_000), "2 分 5 秒");
    assert.equal(formatDuration(Number.NaN), "0.0 秒");
});
