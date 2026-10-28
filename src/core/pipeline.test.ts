import {strict as assert} from "node:assert";
import {test} from "node:test";
import {describeNodeBehavior, describePipelineNode, parsePipelineNodes} from "./pipeline";

const PIPELINE_TEXT = `{
    "ZiplineImportMain": {
        "desc": "打开官方地图页，按 roleId 区分账号保存全部地图标记",
        "action": {
            "type": "Custom",
            "param": {"custom_action": "ZiplineImport"}
        }
    },
    "InWorld": {
        "focus": "只在主界面命中",
        "recognition": "TemplateMatch",
        "action": "Click"
    },
    "ByCustom": {
        "custom_recognition": "MyRecognizer",
        "custom_action": "MyAction"
    },
    // 注释和尾逗号都要容忍
    "Broken": {
        "desc": "值不是对象也没关系",
    }
}`;

test("pipeline 解析：节点名、行号、desc、动作都读出来", () => {
    const nodes = parsePipelineNodes(PIPELINE_TEXT, "/repo/assets/resource/pipeline/X.json");
    const byName = new Map(
        nodes.map((node) => [
            node.name,
            node,
        ]),
    );

    assert.deepEqual(
        nodes.map((node) => node.name),
        [
            "ZiplineImportMain",
            "InWorld",
            "ByCustom",
            "Broken",
        ],
    );

    const zipline = byName.get("ZiplineImportMain");
    assert.equal(zipline?.line, 2);
    assert.equal(zipline?.desc, "打开官方地图页，按 roleId 区分账号保存全部地图标记");
    // action 写成对象时取 type
    assert.equal(zipline?.action, "Custom");
    assert.equal(zipline?.recognition, undefined);
});

test("pipeline 解析：recognition / action 写成字符串时直接取字符串", () => {
    const nodes = parsePipelineNodes(PIPELINE_TEXT, "/repo/X.json");
    const inWorld = nodes.find((node) => node.name === "InWorld");

    assert.equal(inWorld?.recognition, "TemplateMatch");
    assert.equal(inWorld?.action, "Click");
    assert.equal(inWorld?.focus, "只在主界面命中");
});

test("pipeline 解析：没写 recognition 时用 custom_recognition", () => {
    const nodes = parsePipelineNodes(PIPELINE_TEXT, "/repo/X.json");
    const custom = nodes.find((node) => node.name === "ByCustom");

    assert.equal(custom?.recognition, "MyRecognizer");
    assert.equal(custom?.action, "MyAction");
});

test("pipeline 解析：节点源码的起止 offset 能截出完整一段", () => {
    const nodes = parsePipelineNodes(PIPELINE_TEXT, "/repo/X.json");
    const inWorld = nodes.find((node) => node.name === "InWorld");
    assert.ok(inWorld);

    const source = PIPELINE_TEXT.slice(inWorld.keyOffset, inWorld.endOffset);
    assert.ok(source.startsWith('"InWorld": {'), `实际是 ${source.slice(0, 20)}`);
    assert.ok(source.trimEnd().endsWith("}"));
});

test("pipeline 解析：读不懂的文本给空数组，残缺的尽量给能认出来的节点", () => {
    // 完全不是 JSON 对象：什么都不给
    assert.deepEqual(parsePipelineNodes("not json at all", "/repo/X.json"), []);
    assert.deepEqual(parsePipelineNodes("", "/repo/X.json"), []);
    // 写到一半的文件：jsonc-parser 会把认出来的键给你，不抛异常
    const partial = parsePipelineNodes('{"A": ', "/repo/X.json");
    assert.deepEqual(
        partial.map((node) => node.name),
        ["A"],
    );
});

test("节点说明：desc 优先，其次 focus，再次识别方式", () => {
    const base = {name: "A", filePath: "/x.json", keyOffset: 0, endOffset: 1, line: 1};
    assert.equal(describePipelineNode({...base, desc: "有注释"}), "有注释");
    assert.equal(describePipelineNode({...base, focus: "提示"}), "提示");
    assert.equal(describePipelineNode({...base, recognition: "OCR"}), "识别方式：OCR");
    assert.equal(describePipelineNode(base), undefined);
});

test("节点行为：Reco 和 Act 拼成一行，缺哪个就不写哪个", () => {
    const base = {name: "A", filePath: "/x.json", keyOffset: 0, endOffset: 1, line: 1};
    assert.equal(describeNodeBehavior({...base, recognition: "OCR", action: "Click"}), "Reco: OCR · Act: Click");
    assert.equal(describeNodeBehavior({...base, action: "Click"}), "Act: Click");
    assert.equal(describeNodeBehavior(base), undefined);
});
