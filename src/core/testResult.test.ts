import {strict as assert} from "node:assert";
import {test} from "node:test";
import {
    buildMessageMarkdown,
    caseKeyOf,
    collectCaseVerdict,
    collectFileVerdict,
    describeFileFailure,
    fallbackVerdict,
    verdictFromExitCode,
} from "./testResult";
import type {CaseVerdict} from "./testResult";

test("解析文件结论行：路径带空格也能认出来", () => {
    const verdicts = new Map<string, string>();
    collectFileVerdict("RESULT-FILE: tests/a b/test_x.json fail\r", verdicts as never);
    assert.equal(verdicts.get("tests/a b/test_x.json"), "fail");

    collectFileVerdict("这不是结论行", verdicts as never);
    assert.equal(verdicts.size, 1);
});

test("解析用例结论行：拿到短标题和明细列表，Windows 反斜杠统一成正斜杠", () => {
    const verdicts = new Map<string, CaseVerdict>();
    collectCaseVerdict(
        'RESULT-CASE: {"file":"tests\\\\a\\\\test_x.json","case":1,"verdict":"fail","title":"CloudADB-官服 失败","detail":["节点 `X` 这张图上没识别到该节点（算法 ColorMatch）","通过：Win32-官服、ADB-官服"]}',
        verdicts,
    );

    const info = verdicts.get(caseKeyOf("tests/a/test_x.json", 1));
    assert.ok(info);
    assert.equal(info.verdict, "fail");
    assert.equal(info.title, "CloudADB-官服 失败");
    assert.equal(info.detail.length, 2);
    assert.match(info.detail[0], /节点 `X` 这张图上没识别到该节点/);
});

test("坏掉的用例结论行被忽略，不影响文件级结论", () => {
    const verdicts = new Map<string, CaseVerdict>();
    collectCaseVerdict("RESULT-CASE: 不是 json", verdicts);
    collectCaseVerdict('RESULT-CASE: {"file":"a.json","case":"1","verdict":"fail"}', verdicts);
    collectCaseVerdict('RESULT-CASE: {"file":"a.json","case":1,"verdict":"whatever"}', verdicts);
    assert.equal(verdicts.size, 0);
});

test("退出码映射：0 通过 / 1 断言失败 / 其它一律没跑起来", () => {
    assert.equal(verdictFromExitCode(0), "pass");
    assert.equal(verdictFromExitCode(1), "fail");
    assert.equal(verdictFromExitCode(2), "error");
    assert.equal(verdictFromExitCode(3), "error");
    assert.equal(verdictFromExitCode(null), "error");

    assert.equal(fallbackVerdict(0), "pass");
    assert.equal(fallbackVerdict(1), "error");
});

test("文件文案：只有一条用例失败时，标题就说「第 N 个用例：<原因标题>」", () => {
    const text = describeFileFailure("tests/a.json", "fail", [
        {
            caseIndex: 1,
            info: {verdict: "fail", title: "CloudADB-官服 失败", detail: ["节点 `A` 没识别到"]},
        },
    ]);
    assert.equal(text.title, "第 2 个用例：CloudADB-官服 失败");
    assert.deepEqual(text.detail, ["节点 `A` 没识别到"]);
});

test("文件文案：多条用例失败时标题只说条数，明细里逐条列出", () => {
    const text = describeFileFailure("tests/a.json", "fail", [
        {
            caseIndex: 0,
            info: {
                verdict: "fail",
                title: "CloudADB-官服 失败",
                detail: [
                    "节点 `A` 没识别到",
                    "通过：Win32-官服",
                ],
            },
        },
        {caseIndex: 2, info: {verdict: "fail", title: "Win32-官服 失败", detail: ["节点 `B` 识别框不对"]}},
    ]);

    assert.equal(text.title, "2 条用例失败");
    assert.deepEqual(text.detail, [
        "第 1 个用例 · CloudADB-官服 失败",
        "    节点 `A` 没识别到",
        "    通过：Win32-官服",
        "第 3 个用例 · Win32-官服 失败",
        "    节点 `B` 识别框不对",
    ]);
});

test("文件文案：一条原因都没有时回落到通用话术", () => {
    const text = describeFileFailure("tests/a.json", "fail", []);
    assert.equal(text.title, "断言失败");
    assert.match(text.detail.join(""), /tests\/a\.json/);
});

test("用例下标缺失时写问号，不崩", () => {
    const text = describeFileFailure("tests/a.json", "fail", [{info: {verdict: "fail", title: "失败", detail: []}}]);
    assert.equal(text.title, "第 ? 个用例：失败");
});

test("Markdown：粗体短标题在前，空一行后是列表", () => {
    assert.equal(buildMessageMarkdown("CloudADB-官服 失败", []), "**CloudADB-官服 失败**");
    assert.equal(
        buildMessageMarkdown("CloudADB-官服 失败", [
            "节点 `X` 没识别到",
            "通过：Win32-官服",
        ]),
        [
            "**CloudADB-官服 失败**",
            "",
            "- 节点 `X` 没识别到",
            "- 通过：Win32-官服",
        ].join("\n"),
    );
    // 以两个以上空格开头的明细当成子项，缩进两格写成嵌套列表
    assert.match(buildMessageMarkdown("标题", ["    缩进的内容"]), /^ {2}- 缩进的内容$/m);
});
