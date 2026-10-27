import {strict as assert} from "node:assert";
import {test} from "node:test";
import {parseTestDocument} from "./document";
import {
    buildFileNode,
    caseNodeId,
    describeCaseDescription,
    describeCaseLabel,
    describeFileDescription,
    fileNodeId,
    fileNameOf,
    folderSegments,
    toPosix,
} from "./testExplorer";

const SAMPLE = `{
  // 测试面板用的样例
  "configs": {
    "name": "通用按钮",
    "resource": "官服",
    "controller": ["Win32", "ADB"],
  },
  "cases": [
    { "name": "大世界主页", "image": "帝江号_大世界.png", "hits": ["InWorld"] },
    { "image": "四号谷地_地区建设.png", "hits": ["InRegionalDevelopment", "InRegionalDevelopmentValleyIV"] },
    { "hits": [] },
  ],
}`;

test("用例标题：优先 name，其次图片名去扩展名，最后退化成序号", () => {
    const parsed = parseTestDocument(SAMPLE);
    assert.equal(parsed.problems.length, 0);

    assert.equal(describeCaseLabel(parsed.cases[0]), "大世界主页");
    assert.equal(describeCaseLabel(parsed.cases[1]), "四号谷地_地区建设");
    assert.equal(describeCaseLabel(parsed.cases[2]), "第 3 个用例");
});

test("用例灰字：带图片名和预期命中数，负例要写清楚", () => {
    const parsed = parseTestDocument(SAMPLE);
    assert.equal(describeCaseDescription(parsed.cases[1]), "四号谷地_地区建设.png · 预期命中 2 个节点");
    assert.equal(describeCaseDescription(parsed.cases[2]), "没写 image · 负例（不期望命中）");
});

test("文件灰字：组名 + 平台/资源矩阵 + 用例数", () => {
    const parsed = parseTestDocument(SAMPLE);
    assert.equal(
        describeFileDescription(parsed, "Common/Button/test_close_button.json"),
        "通用按钮 · Win32/ADB × 官服 · 3 个用例",
    );

    const unnamed = parseTestDocument('{ "configs": { "resource": "官服" }, "cases": [] }');
    assert.match(describeFileDescription(unnamed, "a/test_x.json"), /未命名测试组（a\/test_x\.json）/);
    assert.match(describeFileDescription(unnamed, "a/test_x.json"), /未写 controller/);
});

test("节点 id 由绝对路径拼出来，同一文件刷新后不变", () => {
    const file = "C:/repo/tests/Common/Button/test_close_button.json";
    assert.equal(fileNodeId(file), `${file}#file`);
    assert.equal(caseNodeId(file, 0), `${file}#case-0`);
    assert.notEqual(caseNodeId(file, 0), caseNodeId(file, 1));
    assert.notEqual(fileNodeId(file), caseNodeId(file, 0));
});

test("建出来的文件节点：标题用相对路径，用例区间覆盖用例对象", () => {
    const parsed = parseTestDocument(SAMPLE);
    const node = buildFileNode(parsed, "/repo/tests/a/test_x.json", "tests/a/test_x.json");

    assert.equal(node.id, "/repo/tests/a/test_x.json#file");
    assert.equal(node.label, "test_x.json");
    assert.equal(node.cases.length, 3);
    assert.equal(node.cases[0].id, "/repo/tests/a/test_x.json#case-0");
    assert.deepEqual(
        node.cases.map((entry) => entry.caseIndex),
        [
            0,
            1,
            2,
        ],
    );

    for (const entry of node.cases) {
        const text = SAMPLE.slice(entry.start, entry.end);
        assert.ok(text.startsWith("{"), `用例区间应该从对象开头起：${text.slice(0, 20)}`);
        assert.ok(text.endsWith("}"), `用例区间应该包含到对象结尾：${text.slice(-20)}`);
    }
});

test("toPosix 把反斜杠转成斜杠，测试面板标题在 Windows 上也不会难看", () => {
    assert.equal(toPosix("tests\\Common\\Button\\test_x.json"), "tests/Common/Button/test_x.json");
    assert.equal(toPosix("tests/Common/test_x.json"), "tests/Common/test_x.json");
});

test("fileNameOf 取路径最后一段", () => {
    assert.equal(fileNameOf("tests/Common/Button/test_close_button.json"), "test_close_button.json");
    assert.equal(fileNameOf("test_x.json"), "test_x.json");
    assert.equal(fileNameOf("tests\\Windows\\test_x.json"), "test_x.json");
});

test("folderSegments：去掉文件名和开头的 tests 段，给出面板分组层级", () => {
    assert.deepEqual(folderSegments("tests/Common/Button/test_close_button.json"), [
        "Common",
        "Button",
    ]);
    assert.deepEqual(folderSegments("tests/test_root.json"), []);
    assert.deepEqual(folderSegments("tests/AutoDelivery/test_x.json"), [
        "AutoDelivery",
    ]);
    // 不在 tests 下的文件名不该被误删（正常路径会被 isTestFilePath 拦住，这里只保证函数本身不炸）
    assert.deepEqual(folderSegments("dev/other/test_x.json"), [
        "dev",
        "other",
    ]);
});
