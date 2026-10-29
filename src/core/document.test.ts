import {strict as assert} from "node:assert";
import {test} from "node:test";
import {findImageFieldAt, isTestFilePath, parseTestDocument} from "./document";

// 真实形态的测试文件：带注释、尾逗号、多控制器、hits 里混写字符串和对象
const REAL_SHAPED = `{
    "configs": {
        "name": "环境监测终端通用选中态矩阵",
        "resource": "官服",
        "controller": [
            "Win32",
            "ADB",
            "CloudADB"
        ]
    },
    "cases": [
        {
            "name": "终端已选中",
            "image": "武陵_环境监测终端_城郊已选中.png",
            "hits": [
                "EnvironmentMonitoringInMonitoringTerminal",
                {
                    "node": "EnvironmentMonitoringInOutskirtsMonitoringTerminal",
                    "box": {
                        "Win32": [0, 0, 1280, 720]
                    }
                }
            ]
        },
        {
            // 负例：这张图不该命中任何节点
            "image": "帝江号_大世界.png",
            "hits": []
        },
    ]
}
`;

test("解析真实形态的测试文件", () => {
    const parsed = parseTestDocument(REAL_SHAPED);
    assert.deepEqual(parsed.problems, []);
    assert.equal(parsed.configs.name, "环境监测终端通用选中态矩阵");
    assert.deepEqual(parsed.configs.resource, ["官服"]);
    assert.deepEqual(parsed.configs.controller, [
        "Win32",
        "ADB",
        "CloudADB",
    ]);
    assert.equal(parsed.cases.length, 2);

    const [
        first,
        second,
    ] = parsed.cases;
    assert.equal(first.index, 0);
    assert.equal(first.name, "终端已选中");
    assert.equal(first.image?.value, "武陵_环境监测终端_城郊已选中.png");
    assert.equal(first.hitCount, 2);

    assert.equal(second.index, 1);
    assert.equal(second.name, undefined);
    assert.equal(second.image?.value, "帝江号_大世界.png");
    assert.equal(second.hitCount, 0);
});

test("用例和 image 字段的 offset 落在正确的位置上", () => {
    const parsed = parseTestDocument(REAL_SHAPED);
    for (const entry of parsed.cases) {
        assert.equal(REAL_SHAPED.slice(entry.offset, entry.offset + 1), "{");
        const image = entry.image;
        assert.ok(image);
        // 键的切片带引号，值也一样
        assert.equal(REAL_SHAPED.slice(image.keyOffset, image.keyOffset + image.keyLength), '"image"');
        assert.equal(REAL_SHAPED.slice(image.valueOffset, image.valueOffset + image.valueLength), `"${image.value}"`);
    }
});

test("configs 写单个字符串时也展开成数组", () => {
    const parsed = parseTestDocument(`{
    "configs": { "resource": "官服", "controller": "Win32" },
    "cases": [{ "image": "a.png", "hits": ["A"] }]
  }`);
    assert.deepEqual(parsed.configs.resource, ["官服"]);
    assert.deepEqual(parsed.configs.controller, ["Win32"]);
    assert.equal(parsed.configs.name, undefined);
});

test("findImageFieldAt 命中 image 的键和值，其它位置不命中", () => {
    const parsed = parseTestDocument(REAL_SHAPED);
    const image = parsed.cases[0].image;
    assert.ok(image);

    const byKey = findImageFieldAt(parsed, image.keyOffset + 1);
    assert.equal(byKey?.value, image.value);
    const byValue = findImageFieldAt(parsed, image.valueOffset + 2);
    assert.equal(byValue?.value, image.value);

    // 用例对象的 `{`、hits 数组里都不该命中
    assert.equal(findImageFieldAt(parsed, parsed.cases[0].offset), undefined);
    assert.equal(findImageFieldAt(parsed, 0), undefined);
});

test("JSON 坏掉时 problems 非空，且不抛异常", () => {
    const parsed = parseTestDocument(`{
    "configs": { "controller": "Win32",
    "cases": [
  `);
    assert.ok(parsed.problems.length > 0);
    assert.equal(typeof parsed.problems[0].message, "string");
    assert.deepEqual(parsed.cases, []);
});

test("空字符串输入也只报问题，不炸", () => {
    const parsed = parseTestDocument("");
    assert.ok(parsed.problems.length > 0);
    assert.deepEqual(parsed.cases, []);
});

test("isTestFilePath 只认 tests 目录下的 test_*.json(c)", () => {
    assert.equal(isTestFilePath("tests/Common/Button/test_close_button.json"), true);
    assert.equal(isTestFilePath("tests/test_a.jsonc"), true);
    assert.equal(isTestFilePath("tests\\DeliveryJobs\\test_region.json"), true);
    assert.equal(isTestFilePath("dev/maa-node-test/test_a.json"), false);
    assert.equal(isTestFilePath("tests/Common/Button/demo.json"), false);
    assert.equal(isTestFilePath("tests/Common/Button/test_close_button.json.bak"), false);
    assert.equal(isTestFilePath("test_close_button.json"), false);
});

test("解析可选的 imageRoot，不改变其他配置", () => {
    for (const imageRoot of [
        "RestaurantDaily",
        "RestaurantDaily/Menu",
        "",
        ".",
    ]) {
        const parsed = parseTestDocument(
            JSON.stringify({
                configs: {controller: "Win32", resource: "官服", imageRoot},
                cases: [],
            }),
        );
        assert.equal(parsed.configs.imageRoot, imageRoot);
        assert.deepEqual(parsed.configs.controller, ["Win32"]);
        assert.deepEqual(parsed.problems, []);
    }
    for (const imageRoot of [
        undefined,
        null,
        42,
        ["RestaurantDaily"],
    ]) {
        const parsed = parseTestDocument(JSON.stringify({configs: {imageRoot}, cases: []}));
        assert.equal(parsed.configs.imageRoot, undefined);
    }
});
