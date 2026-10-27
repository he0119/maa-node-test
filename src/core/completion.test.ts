import {strict as assert} from "node:assert";
import {test} from "node:test";
import {candidatesFor, completionContextAt, insertTextOf} from "./completion";
import type {CompletionContext, RepoData} from "./completion";

const DATA: RepoData = {
    controllers: [
        {name: "Win32", dir: "Win32"},
        {name: "Win32-Front", dir: "Win32"},
        {name: "ADB", dir: "ADB"},
    ],
    resources: [{name: "官服", dir: "Official_CN"}],
    images: (controllers) =>
        controllers.includes("ADB")
            ? ["只有ADB.png"]
            : [
                  "A.png",
                  "B.png",
              ],
    nodes: () => [
        "NodeA",
        "NodeB",
    ],
};

/** 在 `marker` 处放光标，返回补全上下文（拿不到就当测试失败，调用方不用到处判空） */
function contextAt(text: string, marker: string): CompletionContext {
    const offset = text.indexOf(marker) + marker.length;
    assert.ok(offset >= marker.length, "测试文本里要有 marker");
    const context = completionContextAt(text, offset);
    assert.ok(context, `应该能算出 ${marker} 处的补全上下文`);
    return context;
}

test("补全上下文：能认出在写 controller 的值", () => {
    const context = contextAt('{"configs": {"controller": ["', '"controller": ["');
    assert.deepEqual(context?.path, [
        "configs",
        "controller",
        0,
    ]);
    assert.equal(context?.atKey, false);
    assert.equal(context?.inString, true);
});

test("补全：controller 给 loader 里登记的名字，别名标出对应目录", () => {
    const candidates = candidatesFor(contextAt('{"configs": {"controller": ["', '"controller": ["'), DATA);
    assert.deepEqual(
        candidates.map((item) => item.label),
        [
            "Win32",
            "Win32-Front",
            "ADB",
        ],
    );
    assert.equal(candidates[1].detail, "截图目录 Win32");
});

test("补全：resource 给 loader 里的资源名", () => {
    const candidates = candidatesFor(contextAt('{"configs": {"resource": "', '"resource": "'), DATA);
    assert.deepEqual(
        candidates.map((item) => item.label),
        ["官服"],
    );
    assert.equal(candidates[0].detail, "截图目录 Official_CN");
});

test("补全：image 按本文件声明的平台收窄", () => {
    const withAdb = candidatesFor(contextAt('{"cases": [{"image": "', '"image": "'), DATA, ["ADB"]);
    assert.deepEqual(
        withAdb.map((item) => item.label),
        ["只有ADB.png"],
    );

    const noController = candidatesFor(contextAt('{"cases": [{"image": "', '"image": "'), DATA, []);
    assert.deepEqual(
        noController.map((item) => item.label),
        [
            "A.png",
            "B.png",
        ],
    );
});

test("补全：hits 里的字符串给 pipeline 节点名", () => {
    const candidates = candidatesFor(contextAt('{"cases": [{"hits": ["', '"hits": ["'), DATA);
    assert.deepEqual(
        candidates.map((item) => item.label),
        [
            "NodeA",
            "NodeB",
        ],
    );
});

test("补全：hits 里写成对象的 node 也给节点名", () => {
    const candidates = candidatesFor(contextAt('{"cases": [{"hits": [{"node": "', '"node": "'), DATA);
    assert.deepEqual(
        candidates.map((item) => item.label),
        [
            "NodeA",
            "NodeB",
        ],
    );
});

test("补全：各级对象的键也能补", () => {
    const root = candidatesFor(contextAt("{", "{"), DATA);
    assert.deepEqual(
        root.map((item) => item.label),
        [
            "configs",
            "cases",
        ],
    );

    const configs = candidatesFor(contextAt('{"configs": {', '"configs": {'), DATA);
    assert.deepEqual(
        configs.map((item) => item.label),
        [
            "name",
            "resource",
            "controller",
            "imageRoot",
        ],
    );

    const oneCase = candidatesFor(contextAt('{"cases": [{', '"cases": [{'), DATA);
    assert.deepEqual(
        oneCase.map((item) => item.label),
        [
            "name",
            "image",
            "hits",
        ],
    );

    const oneHit = candidatesFor(contextAt('{"cases": [{"hits": [{', '"hits": [{'), DATA);
    assert.deepEqual(
        oneHit.map((item) => item.label),
        [
            "node",
            "box",
        ],
    );
});

test("补全：认不出的位置不给候选（宁可不提示，也别给错的值）", () => {
    assert.deepEqual(candidatesFor(contextAt('{"cases": [{"name": "', '"name": "'), DATA), []);
    assert.deepEqual(candidatesFor(contextAt('{"configs": {"imageRoot": "', '"imageRoot": "'), DATA), []);
});

test("补全：插入文本按「是否已在字符串里」决定带不带引号", () => {
    const inside = contextAt('{"configs": {"controller": ["', '"controller": ["');
    const outside = contextAt('{"configs": {"controller": [', '"controller": [');
    const candidate = {label: "ADB", kind: "controller" as const};

    assert.equal(insertTextOf(candidate, inside), "ADB");
    assert.equal(insertTextOf(candidate, outside), '"ADB"');
});
