import {strict as assert} from "node:assert";
import {test} from "node:test";

import {
    aggregateFileResults,
    attributeGroupResults,
    formatFileResultLine,
    hasAnyAttributedGroup,
    normalizeFileResults,
    overallVerdict,
    stripAnsi,
} from "./results.mjs";

const FAILED_OUTPUT = [
    "use latest version 5.15.0-beta.1",
    "(Win32-官服)通用按钮，测试关闭按钮",
    "  帝江号_大世界.png CloseButtonType1 should hit but missed",
    "  四号谷地_地区建设.png CloseButtonType1 box mismatch. Expect [223,32,32,19], hit [220,30,34,20]",
    "(ADB-官服)通用按钮，测试关闭按钮",
    "",
];

test("按组名切分：有明细行的组算失败，只有组名行的算通过", () => {
    const verdicts = attributeGroupResults(FAILED_OUTPUT, [
        "(Win32-官服)通用按钮，测试关闭按钮",
        "(ADB-官服)通用按钮，测试关闭按钮",
        "(CloudADB-官服)通用按钮，测试关闭按钮",
    ]);

    assert.equal(verdicts.get("(Win32-官服)通用按钮，测试关闭按钮"), "fail");
    assert.equal(verdicts.get("(ADB-官服)通用按钮，测试关闭按钮"), "pass");
    assert.equal(verdicts.get("(CloudADB-官服)通用按钮，测试关闭按钮"), "unknown");
});

test("组名带 ANSI 颜色也能认出来（在终端里手跑时会带颜色）", () => {
    const verdicts = attributeGroupResults(
        [
            "\u001b[32m(Win32-官服)某组\u001b[39m",
            "  a.png X should hit but missed",
        ],
        ["(Win32-官服)某组"],
    );
    assert.equal(verdicts.get("(Win32-官服)某组"), "fail");
    assert.equal(stripAnsi("\u001b[31m红\u001b[39m"), "红");
});

test("同一组名重复出现时，只要有一次失败就算失败", () => {
    const verdicts = attributeGroupResults(
        [
            "(Win32-官服)某组",
            "  a.png X should hit but missed",
            "(Win32-官服)某组",
        ],
        ["(Win32-官服)某组"],
    );
    assert.equal(verdicts.get("(Win32-官服)某组"), "fail");
});

test("行首只有一个空格的无关行不会把组判失败", () => {
    const verdicts = attributeGroupResults(
        [
            " (Win32-官服)某组不是组名",
            "(Win32-官服)某组",
        ],
        ["(Win32-官服)某组"],
    );
    assert.equal(verdicts.get("(Win32-官服)某组"), "pass");
});

test("hasAnyAttributedGroup：全都是 unknown 说明一个组都没执行", () => {
    assert.equal(
        hasAnyAttributedGroup(
            new Map([
                [
                    "a",
                    "unknown",
                ],
            ]),
        ),
        false,
    );
    assert.equal(
        hasAnyAttributedGroup(
            new Map([
                [
                    "a",
                    "pass",
                ],
            ]),
        ),
        true,
    );
});

test("按文件汇总：文件名下任意一组失败，这个文件就失败", () => {
    const owners = new Map([
        [
            "(Win32-官服)组一",
            new Set(["tests/a/test_a.json"]),
        ],
        [
            "(ADB-官服)组一",
            new Set(["tests/a/test_a.json"]),
        ],
        [
            "(Win32-官服)组二",
            new Set(["tests/b/test_b.json"]),
        ],
    ]);
    const verdicts = new Map([
        [
            "(Win32-官服)组一",
            "pass",
        ],
        [
            "(ADB-官服)组一",
            "fail",
        ],
        [
            "(Win32-官服)组二",
            "pass",
        ],
    ]);

    const files = aggregateFileResults(owners, verdicts, [
        "tests/a/test_a.json",
        "tests/b/test_b.json",
    ]);
    assert.equal(files.get("tests/a/test_a.json"), "fail");
    assert.equal(files.get("tests/b/test_b.json"), "pass");
});

test("没有归因到任何组的文件是 unknown，对外统一成 error", () => {
    const files = aggregateFileResults(new Map(), new Map(), ["tests/a/test_a.json"]);
    assert.equal(files.get("tests/a/test_a.json"), "unknown");

    const normalized = normalizeFileResults(files);
    assert.equal(normalized.get("tests/a/test_a.json"), "error");
});

test("整批结论：error 优先于 fail，全通过才是 pass", () => {
    assert.equal(overallVerdict(new Map()), "empty");
    assert.equal(
        overallVerdict(
            new Map([
                [
                    "a",
                    "pass",
                ],
            ]),
        ),
        "pass",
    );
    assert.equal(
        overallVerdict(
            new Map([
                [
                    "a",
                    "pass",
                ],
                [
                    "b",
                    "fail",
                ],
            ]),
        ),
        "fail",
    );
    assert.equal(
        overallVerdict(
            new Map([
                [
                    "a",
                    "fail",
                ],
                [
                    "b",
                    "error",
                ],
            ]),
        ),
        "error",
    );
});

test("RESULT-FILE 行格式固定，扩展按前缀解析", () => {
    assert.equal(formatFileResultLine("tests/a/test_a.json", "pass"), "RESULT-FILE: tests/a/test_a.json pass");
    assert.match(formatFileResultLine("tests/a/test_a.json", "error"), /^RESULT-FILE: .+ error$/);
});
