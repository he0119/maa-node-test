import {strict as assert} from "node:assert";
import {test} from "node:test";
import type {TestCase} from "./document";
import {collectMissingImages, describeMissingImage, summarizeMissingImage} from "./missingImages";
import type {ImageLocation} from "./testset";

/** 造一条用例：只关心 image 和下标，其它字段给默认值 */
function testCase(index: number, image: string): TestCase {
    return {
        index,
        offset: 0,
        endOffset: 1,
        hitCount: 0,
        image: {
            value: image,
            valueOffset: 100 + index * 10,
            valueLength: image.length + 2,
            keyOffset: 90 + index * 10,
            keyLength: 7,
        },
    };
}

/** 造扫描结果：platforms 里每个平台，有图的给个假路径，没图的 filePath 为 null */
function locations(platforms: string[], present: string[]): ImageLocation[] {
    return platforms.map((platform) => ({
        platform,
        resource: "Official_CN",
        filePath: present.includes(platform) ? `/repo/tests/MaaEndTestset/${platform}/Official_CN/a.png` : null,
        size: present.includes(platform) ? {width: 1280, height: 720} : null,
    }));
}

test("缺图检查：平台都有图时不报警告", () => {
    const warnings = collectMissingImages({
        cases: [testCase(0, "a.png")],
        controllers: [
            "Win32",
            "ADB",
        ],
        locate: () =>
            locations(
                [
                    "Win32",
                    "ADB",
                ],
                [
                    "Win32",
                    "ADB",
                ],
            ),
    });
    assert.deepEqual(warnings, []);
});

test("缺图检查：某个声明平台没有这张图时报警告，带上 offset 和平台", () => {
    const warnings = collectMissingImages({
        cases: [testCase(1, "四号谷地_地区建设.png")],
        controllers: [
            "Win32",
            "ADB",
            "CloudADB",
        ],
        locate: () =>
            locations(
                [
                    "Win32",
                    "ADB",
                    "CloudADB",
                ],
                [
                    "Win32",
                    "ADB",
                ],
            ),
    });

    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].caseIndex, 1);
    assert.equal(warnings[0].image, "四号谷地_地区建设.png");
    assert.equal(warnings[0].offset, 110);
    assert.deepEqual(warnings[0].platforms, [{platform: "CloudADB", hasDirectory: true}]);
});

test("缺图检查：声明了但测试集里连平台目录都没有，单独标出来", () => {
    const warnings = collectMissingImages({
        cases: [testCase(0, "a.png")],
        controllers: [
            "Win32",
            "Switch",
        ],
        locate: () =>
            locations(
                [
                    "Win32",
                    "ADB",
                ],
                ["Win32"],
            ),
    });

    assert.deepEqual(warnings[0].platforms, [{platform: "Switch", hasDirectory: false}]);
});

test("缺图检查：没写 configs.controller 就不判断", () => {
    const warnings = collectMissingImages({
        cases: [testCase(0, "a.png")],
        controllers: [],
        locate: () => locations(["Win32"], []),
    });
    assert.deepEqual(warnings, []);
});

test("缺图检查：测试集一个平台目录都没扫到时，不逐条刷警告", () => {
    const warnings = collectMissingImages({
        cases: [
            testCase(0, "a.png"),
            testCase(1, "b.png"),
        ],
        controllers: ["Win32"],
        locate: () => [],
    });
    assert.deepEqual(warnings, []);
});

test("缺图检查：没有 image 字段的用例跳过", () => {
    const warnings = collectMissingImages({
        cases: [{index: 0, offset: 0, endOffset: 1, hitCount: 0}],
        controllers: ["Win32"],
        locate: () => locations(["Win32"], []),
    });
    assert.deepEqual(warnings, []);
});

test("缺图文案：区分「缺这张图」和「没有这个平台目录」", () => {
    const text = describeMissingImage({
        caseIndex: 0,
        image: "a.png",
        offset: 0,
        length: 7,
        platforms: [
            {platform: "ADB", hasDirectory: true},
            {platform: "Switch", hasDirectory: false},
        ],
    });

    assert.match(text, /ADB 上没有 a\.png/);
    assert.match(text, /测试集里没有 Switch 的平台目录/);
    assert.match(text, /不会验证到这条用例/);
});

test("面板短提示只列平台名", () => {
    assert.equal(
        summarizeMissingImage({
            caseIndex: 0,
            image: "a.png",
            offset: 0,
            length: 7,
            platforms: [
                {platform: "ADB", hasDirectory: true},
                {platform: "CloudADB", hasDirectory: true},
            ],
        }),
        "缺 ADB、CloudADB 截图",
    );
});
