import assert from "node:assert/strict";
import {test} from "node:test";

import {caseKey, hitNodeName, hitNodeNames} from "./case-key.mjs";

test("字符串 hit 直接当节点名", () => {
    assert.equal(hitNodeName("InWorld"), "InWorld");
    assert.equal(caseKey({image: "a.png", hits: ["InWorld"]}), "a.png|InWorld");
});

test("{node, box} 形式只取 node，box 不参与键", () => {
    assert.equal(
        hitNodeName({
            node: "CloseButton",
            box: [
                1,
                2,
                3,
                4,
            ],
        }),
        "CloseButton",
    );
    assert.equal(
        caseKey({
            image: "a.png",
            hits: [
                {
                    node: "CloseButton",
                    box: [
                        1,
                        2,
                        3,
                        4,
                    ],
                },
            ],
        }),
        "a.png|CloseButton",
    );
});

test("节点名按字典序排序，和书写顺序无关", () => {
    const left = caseKey({
        image: "a.png",
        hits: [
            "B",
            "A",
        ],
    });
    const right = caseKey({
        image: "a.png",
        hits: [
            "A",
            "B",
        ],
    });
    assert.equal(left, right);
    assert.equal(left, "a.png|A,B");
});

test("重复节点去重", () => {
    assert.equal(
        caseKey({
            image: "a.png",
            hits: [
                "A",
                "A",
                "B",
            ],
        }),
        "a.png|A,B",
    );
});

test("负例（空 hits）也有稳定键", () => {
    assert.equal(caseKey({image: "a.png", hits: []}), "a.png|");
});

test("同一张图不同命中节点是不同的键", () => {
    const noHit = caseKey({image: "a.png", hits: []});
    const hitOne = caseKey({image: "a.png", hits: ["A"]});
    const hitTwo = caseKey({
        image: "a.png",
        hits: [
            "A",
            "B",
        ],
    });
    assert.notEqual(noHit, hitOne);
    assert.notEqual(hitOne, hitTwo);
});

test("image 缺失或不合法时按空串处理，不抛异常", () => {
    assert.equal(caseKey({hits: ["A"]}), "|A");
    assert.equal(caseKey(null), "|");
});

test("hits 不是数组时视为空", () => {
    assert.equal(caseKey({image: "a.png"}), "a.png|");
    assert.deepEqual(hitNodeNames("InWorld"), []);
});

test("hit 里缺 node 的脏数据被跳过", () => {
    assert.deepEqual(
        hitNodeNames([
            "A",
            {
                box: [
                    0,
                    0,
                    1,
                    1,
                ],
            },
            {node: "B"},
        ]),
        [
            "A",
            "B",
        ],
    );
});
