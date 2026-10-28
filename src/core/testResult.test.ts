import {strict as assert} from "node:assert";
import {test} from "node:test";
import {
    buildMessageMarkdown,
    caseKeyOf,
    describeFileFailure,
    describeVerdict,
    missingCaseVerdict,
    planFileMarking,
} from "./testResult";
import type {CaseVerdict} from "./testResult";

const passed: CaseVerdict = {verdict: "pass", title: "通过", detail: [], durationMs: 12};
const failed: CaseVerdict = {verdict: "fail", title: "ADB-官服 失败", detail: ["节点 `A` 没识别到"], durationMs: 7};
const skipped: CaseVerdict = {verdict: "skipped", title: "ADB-官服 缺图跳过", detail: ["截图不存在"], durationMs: 0};

test("文件文案：只有一条用例失败时直接展示原因", () => {
    assert.deepEqual(describeFileFailure("tests/a.json", "fail", [{caseIndex: 1, info: failed}]), {
        title: "第 2 个用例：ADB-官服 失败",
        detail: ["节点 `A` 没识别到"],
    });
});

test("文件文案：多条失败逐条列出，不重复通过的用例", () => {
    const text = describeFileFailure("tests/a.json", "fail", [
        {caseIndex: 0, info: failed},
        {caseIndex: 1, info: passed},
        {caseIndex: 2, info: failed},
    ]);
    assert.equal(text.title, "2 条用例失败");
    assert.deepEqual(text.detail, [
        "第 1 个用例 · ADB-官服 失败",
        "    节点 `A` 没识别到",
        "第 3 个用例 · ADB-官服 失败",
        "    节点 `A` 没识别到",
    ]);
});

test("文件文案：没有逐用例原因时显示文件结论", () => {
    assert.equal(describeFileFailure("tests/a.json", "fail", []).title, "断言失败");
    assert.match(describeFileFailure("tests/a.json", "fail", []).detail.join(""), /tests\/a\.json/);
});

test("用例下标缺失时写问号", () => {
    assert.equal(describeFileFailure("tests/a.json", "fail", [{info: failed}]).title, "第 ? 个用例：ADB-官服 失败");
});

test("Markdown：粗体短标题在前，明细支持子列表", () => {
    assert.equal(buildMessageMarkdown("失败", []), "**失败**");
    assert.equal(
        buildMessageMarkdown("失败", [
            "节点 `A` 没识别到",
            "    具体原因",
        ]),
        "**失败**\n\n- 节点 `A` 没识别到\n  - 具体原因",
    );
});

test("标记计划：只把有明确通过结果的用例标绿", () => {
    const marking = planFileMarking("tests/a.json", "pass", [
        {caseIndex: 0, info: passed},
        {caseIndex: 1, info: passed},
    ]);
    assert.equal(marking.file.verdict, "pass");
    assert.deepEqual(
        marking.cases.map((entry) => entry.verdict),
        [
            "pass",
            "pass",
        ],
    );
});

test("标记计划：文件报告通过但未返回任何用例结果，全部报缺项错误", () => {
    const marking = planFileMarking("tests/a.json", "pass", [
        {caseIndex: 0},
        {caseIndex: 1},
    ]);
    assert.equal(marking.file.verdict, "error");
    assert.equal(marking.file.text.title, "结果不完整");
    assert.deepEqual(
        marking.cases.map((entry) => entry.verdict),
        [
            "error",
            "error",
        ],
    );
    assert.equal(marking.cases[1].text.title, "缺少用例结果");
});

test("标记计划：存在明确通过结果也不能把缺项子用例补成通过", () => {
    const marking = planFileMarking("tests/a.json", "pass", [
        {caseIndex: 0, info: passed},
        {caseIndex: 1},
    ]);
    assert.equal(marking.file.verdict, "error");
    assert.deepEqual(
        marking.cases.map((entry) => entry.verdict),
        [
            "pass",
            "error",
        ],
    );
});

test("标记计划：文件失败时未点名的用例仍是缺项错误，不猜通过或断言失败", () => {
    const marking = planFileMarking("tests/a.json", "fail", [
        {caseIndex: 0, info: failed},
        {caseIndex: 1},
    ]);
    assert.equal(marking.file.verdict, "error");
    assert.deepEqual(
        marking.cases.map((entry) => entry.verdict),
        [
            "fail",
            "error",
        ],
    );
});

test("标记计划：部分平台缺图仍保留上游文件通过和用例跳过", () => {
    const marking = planFileMarking("tests/a.json", "pass", [{caseIndex: 3, info: skipped}]);
    assert.equal(marking.file.verdict, "pass");
    assert.equal(marking.cases[0].verdict, "skipped");
    assert.match(marking.file.text.detail[0], /未在全部平台完成验证/);
});

test("标记计划：全缺图由上游文件 error 表达，子用例仍为 skipped", () => {
    const marking = planFileMarking("tests/a.json", "error", [{caseIndex: 0, info: skipped}]);
    assert.equal(marking.file.verdict, "error");
    assert.equal(marking.cases[0].verdict, "skipped");
});

test("标记计划：失败与跳过分别标记，文件直接使用上游 fail", () => {
    const marking = planFileMarking("tests/a.json", "fail", [
        {caseIndex: 0, info: skipped},
        {caseIndex: 1, info: failed},
    ]);
    assert.equal(marking.file.verdict, "fail");
    assert.deepEqual(
        marking.cases.map((entry) => entry.verdict),
        [
            "skipped",
            "fail",
        ],
    );
});

test("标记计划：前置错误向文件和未执行用例说明同一个具体原因", () => {
    const reason = {title: "没有完成验证", detail: ["配置加载失败"]};
    const marking = planFileMarking(
        "tests/a.json",
        "error",
        [
            {caseIndex: 0},
            {caseIndex: 1},
        ],
        reason,
    );
    assert.deepEqual(marking.file.text, reason);
    assert.deepEqual(
        marking.cases.map((entry) => entry.verdict),
        [
            "error",
            "error",
        ],
    );
    assert.deepEqual(marking.cases[0].text.detail, ["配置加载失败"]);
});

test("缺项文案包含来源与原始下标，不根据图片或组名猜结果", () => {
    assert.match(missingCaseVerdict("tests/a.json", 4).detail[0], /tests\/a\.json 第 5 个用例/);
    assert.equal(missingCaseVerdict("tests/a.json", 4).verdict, "error");
});

test("用例取键遵循平台路径规则并保留原始下标", () => {
    assert.equal(
        caseKeyOf("tests\\a\\test_a.json", 7),
        process.platform === "win32" ? "tests/a/test_a.json#7" : "tests\\a\\test_a.json#7",
    );
});

test("兜底文案指向测试输出，不根据未知结果猜下载或截图问题", () => {
    assert.match(describeVerdict("fail", "tests/a.json").detail[0], /测试输出/);
    assert.equal(describeVerdict("error", "tests/a.json").title, "没有完成验证");
    assert.deepEqual(describeVerdict("pass", "tests/a.json"), {title: "通过", detail: []});
});
