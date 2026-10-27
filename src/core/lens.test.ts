import {strict as assert} from "node:assert";
import {test} from "node:test";
import {parseTestDocument} from "./document";
import {buildCodeLensDescriptors, RUN_CASE_COMMAND, RUN_FILE_COMMAND} from "./lens";

const TWO_CASES = `{
  "configs": {
    "name": "通用按钮，测试关闭按钮",
    "resource": "官服",
    "controller": ["Win32", "ADB"]
  },
  "cases": [
    { "name": "大世界主页", "image": "帝江号_大世界.png", "hits": ["InWorld"] },
    { "image": "武陵_拍照模式_画面设置.png", "hits": [] }
  ]
}`;

test("两个用例的文件给 3 个 CodeLens，命令参数对得上", () => {
    const parsed = parseTestDocument(TWO_CASES);
    const descriptors = buildCodeLensDescriptors(parsed);

    assert.equal(descriptors.length, 3);

    assert.equal(descriptors[0].offset, 0);
    assert.equal(descriptors[0].command, RUN_FILE_COMMAND);
    assert.equal(descriptors[0].title, "$(play) 运行整个文件（2 个用例）：通用按钮，测试关闭按钮");
    assert.equal(descriptors[0].caseIndex, undefined);

    assert.equal(descriptors[1].offset, parsed.cases[0].offset);
    assert.equal(descriptors[1].command, RUN_CASE_COMMAND);
    assert.equal(descriptors[1].title, "$(play) 运行此用例：大世界主页");
    assert.equal(descriptors[1].caseIndex, 0);

    assert.equal(descriptors[2].offset, parsed.cases[1].offset);
    assert.equal(descriptors[2].command, RUN_CASE_COMMAND);
    assert.equal(descriptors[2].title, "$(play) 运行此用例");
    assert.equal(descriptors[2].caseIndex, 1);
});

test("configs.name 缺失时顶部标题不带名字", () => {
    const parsed = parseTestDocument(`{
    "configs": { "resource": "官服", "controller": "Win32" },
    "cases": [{ "image": "a.png", "hits": ["A"] }]
  }`);
    const descriptors = buildCodeLensDescriptors(parsed);
    assert.equal(descriptors.length, 2);
    assert.equal(descriptors[0].title, "$(play) 运行整个文件（1 个用例）");
});

test("JSON 解析出错时不给任何 CodeLens", () => {
    const parsed = parseTestDocument(`{ "configs": { "controller": "Win32", "cases": [`);
    assert.ok(parsed.problems.length > 0);
    assert.deepEqual(buildCodeLensDescriptors(parsed), []);
});
