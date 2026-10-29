import {strict as assert} from "node:assert";
import {test} from "node:test";
import {isHitsEntryPath, parseHitEntries, truncateInlayLabel} from "./hits";

const TEXT = `{
    "configs": {"controller": ["Win32"], "resource": "官服"},
    "cases": [
        {
            "image": "a.png",
            "hits": ["InWorld", {"node": "DeliveryJobsQuickTransfer", "box": [0, 0, 8, 8]}]
        },
        {
            "image": "b.png",
            "hits": []
        }
    ]
}`;

test("hits 解析：字符串和对象两种写法都能拿到节点名和位置", () => {
    const entries = parseHitEntries(TEXT);

    assert.deepEqual(
        entries.map((entry) => [
            entry.caseIndex,
            entry.hitIndex,
            entry.name,
        ]),
        [
            [
                0,
                0,
                "InWorld",
            ],
            [
                0,
                1,
                "DeliveryJobsQuickTransfer",
            ],
        ],
    );

    for (const entry of entries) {
        // offset/length 要正好覆盖带引号的节点名，内联提示就贴在它后面
        assert.equal(TEXT.slice(entry.offset, entry.offset + entry.length), `"${entry.name}"`);
    }
});

test("hits 解析：没有 hits、hits 不是数组、文件坏掉都不抛异常", () => {
    assert.deepEqual(parseHitEntries('{"cases": [{"image": "a.png"}]}'), []);
    assert.deepEqual(parseHitEntries('{"cases": [{"hits": "InWorld"}]}'), []);
    assert.deepEqual(parseHitEntries("not json"), []);
    assert.deepEqual(parseHitEntries(""), []);
});

test("hits 路径判断：只认 cases[n].hits[m] 和它的 .node", () => {
    assert.equal(
        isHitsEntryPath([
            "cases",
            0,
            "hits",
            1,
        ]),
        true,
    );
    assert.equal(
        isHitsEntryPath([
            "cases",
            0,
            "hits",
            1,
            "node",
        ]),
        true,
    );
    assert.equal(
        isHitsEntryPath([
            "cases",
            0,
            "hits",
            1,
            "box",
        ]),
        false,
    );
    assert.equal(
        isHitsEntryPath([
            "cases",
            0,
            "image",
        ]),
        false,
    );
    assert.equal(
        isHitsEntryPath([
            "configs",
            "name",
        ]),
        false,
    );
});

test("内联提示文案：压成一行并截断", () => {
    assert.equal(truncateInlayLabel("打开官方地图页"), "打开官方地图页");
    assert.equal(truncateInlayLabel("第一行\n第二行"), "第一行 第二行");
    assert.equal(truncateInlayLabel("一二三四五六七八九十", 5), "一二三四…");
});
