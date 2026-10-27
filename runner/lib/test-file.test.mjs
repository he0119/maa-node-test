import assert from "node:assert/strict";
import {test} from "node:test";

import {CaseIndexOutOfRangeError, TestFileError, buildTarget, normalizeTestFile, parseTestFile} from "./test-file.mjs";

const sampleText = `{
    "configs": {
        // 注释要能读；尾逗号不能（和 maa-tools 的读法一致）
        "name": "通用按钮，测试关闭按钮",
        "resource": "官服",
        "controller": ["Win32", "ADB"]
    },
    "cases": [
        { "image": "a.png", "hits": ["CloseButtonType1"] },
        { "image": "b.png", "hits": [] }
    ]
}`;

test("解析带注释的 jsonc", () => {
    const raw = parseTestFile(sampleText);
    assert.equal(raw.configs.name, "通用按钮，测试关闭按钮");
    assert.equal(raw.cases.length, 2);
});

test("尾逗号按 maa-tools 的行为判为解析失败，并额外提示是尾逗号问题", () => {
    const text = `{
    "configs": { "controller": ["Win32"], "resource": "官服" },
    "cases": [{ "image": "a.png", "hits": [] }],
  }`;
    assert.throws(
        () => parseTestFile(text),
        (error) => error instanceof TestFileError && error.message.includes("尾逗号"),
    );
});

test("语法错误抛 TestFileError 并带上错误类型", () => {
    assert.throws(
        () => parseTestFile('{ "configs": { "controller": ["Win32" }, }'),
        (error) => error instanceof TestFileError && error.message.includes("JSON 解析失败"),
    );
});

test("规整：字符串 controller/resource 变成数组，数组去重", () => {
    const file = normalizeTestFile({
        configs: {
            controller: [
                "Win32",
                "Win32",
                "ADB",
            ],
            resource: "官服",
        },
        cases: [{image: "a.png", hits: []}],
    });
    assert.deepEqual(file.controllers, [
        "Win32",
        "ADB",
    ]);
    assert.deepEqual(file.resources, ["官服"]);
    assert.equal(file.name, null);
});

test("规整：空名字当没有名字", () => {
    const file = normalizeTestFile({
        configs: {name: "", controller: "Win32", resource: "官服"},
        cases: [{image: "a.png", hits: []}],
    });
    assert.equal(file.name, null);
});

test("结构不合法时给出人话错误", () => {
    const cases = [
        [
            null,
            "顶层",
        ],
        [
            {cases: [{image: "a.png", hits: []}]},
            "configs",
        ],
        [
            {configs: {controller: "Win32"}, cases: [{image: "a.png", hits: []}]},
            "resource",
        ],
        [
            {configs: {controller: [], resource: "官服"}, cases: [{image: "a.png", hits: []}]},
            "controller",
        ],
        [
            {configs: {controller: "Win32", resource: "官服"}},
            "cases",
        ],
        [
            {configs: {controller: "Win32", resource: "官服"}, cases: []},
            "cases",
        ],
        [
            {configs: {controller: "Win32", resource: "官服"}, cases: [{hits: []}]},
            "image",
        ],
        [
            {configs: {controller: "Win32", resource: "官服"}, cases: [{image: "a.png"}]},
            "hits",
        ],
    ];
    for (const [
        raw,
        keyword,
    ] of cases) {
        assert.throws(
            () => normalizeTestFile(raw),
            (error) => error instanceof TestFileError && error.message.includes(keyword),
            `应报错并提到「${keyword}」`,
        );
    }
});

test("buildTarget 默认取全部用例", () => {
    const file = normalizeTestFile(parseTestFile(sampleText));
    const target = buildTarget(file);
    assert.equal(target.caseIndex, null);
    assert.equal(target.cases.length, 2);
    assert.deepEqual(target.caseKeys, [
        "a.png|CloseButtonType1",
        "b.png|",
    ]);
    assert.deepEqual(target.controllers, [
        "Win32",
        "ADB",
    ]);
    assert.equal(target.name, "通用按钮，测试关闭按钮");
});

test("buildTarget 指定 --case 时只留那一个用例", () => {
    const file = normalizeTestFile(parseTestFile(sampleText));
    const target = buildTarget(file, 1);
    assert.equal(target.caseIndex, 1);
    assert.equal(target.cases.length, 1);
    assert.deepEqual(target.caseKeys, ["b.png|"]);
});

test("--case 越界抛 CaseIndexOutOfRangeError，带总数方便提示", () => {
    const file = normalizeTestFile(parseTestFile(sampleText));
    for (const bad of [
        2,
        99,
        -1,
    ]) {
        assert.throws(
            () => buildTarget(file, bad),
            (error) => error instanceof CaseIndexOutOfRangeError && error.total === 2 && error.index === bad,
            `应拒绝下标 ${bad}`,
        );
    }
});

test("--case 不是整数时同样拒绝", () => {
    const file = normalizeTestFile(parseTestFile(sampleText));
    assert.throws(() => buildTarget(file, 1.5), CaseIndexOutOfRangeError);
});
