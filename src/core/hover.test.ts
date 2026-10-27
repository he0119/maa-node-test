import {strict as assert} from "node:assert";
import {test} from "node:test";
import {buildImageHoverMarkdown} from "./hover";
import type {ImageLocation} from "./testset";

const TESTSET_LABEL = "tests/MaaEndTestset";
const WANG32_PNG = "/repo/tests/MaaEndTestset/Win32/Official_CN/帝江号_大世界.png";
const CLOUD_PNG = "/repo/tests/MaaEndTestset/CloudADB/帝江号_大世界.png";

/** 单测里用最朴素的拼法，真实的 vscode.Uri.toString() 由 provider 那边给 */
function toUri(absolutePath: string): string {
    return `file://${absolutePath}`;
}

function found(platform: string, resource: string, filePath: string, width: number, height: number): ImageLocation {
    return {platform, resource, filePath, size: {width, height}};
}

function missing(platform: string, resource: string): ImageLocation {
    return {platform, resource, filePath: null, size: null};
}

test("hover 文本：找到的平台给尺寸和图片，没找到的写缺失", () => {
    const markdown = buildImageHoverMarkdown(
        {
            imageName: "帝江号_大世界.png",
            controllers: [
                "Win32",
                "ADB",
            ],
            testsetLabel: TESTSET_LABEL,
            testsetExists: true,
            locations: [
                found("Win32", "Official_CN", WANG32_PNG, 1280, 720),
                missing("ADB", "Official_CN"),
                {platform: "CloudADB", resource: "", filePath: CLOUD_PNG, size: null},
            ],
        },
        toUri,
    );

    const blocks = markdown.split("\n\n");
    assert.equal(blocks.length, 4);
    assert.equal(
        blocks[0],
        "**帝江号_大世界.png** · 在 `tests/MaaEndTestset` 下找到 2 张（共 3 个平台/资源组合） · 本文件声明平台：Win32、ADB",
    );
    // 描述和图片是硬换行，紧挨着的两行
    assert.equal(
        blocks[1],
        `**Win32 / Official_CN** · 1280×720 · [打开原图](file://${WANG32_PNG})  \n![](file://${WANG32_PNG})`,
    );
    assert.equal(blocks[2], "**ADB / Official_CN** · 缺失");
    // 资源目录为空时只写平台名；尺寸读不出来也要说清楚
    assert.equal(
        blocks[3],
        `**CloudADB** · 尺寸读不出来 · [打开原图](file://${CLOUD_PNG})  \n![](file://${CLOUD_PNG})`,
    );
});

test("hover 文本：一张都没找到时给人话提示，不列一堆缺失", () => {
    const markdown = buildImageHoverMarkdown(
        {
            imageName: "不存在的图.png",
            controllers: ["Win32"],
            testsetLabel: TESTSET_LABEL,
            testsetExists: true,
            locations: [
                missing("Win32", "Official_CN"),
                missing("ADB", "Official_CN"),
            ],
        },
        toUri,
    );

    assert.ok(markdown.startsWith("**不存在的图.png** · 在 `tests/MaaEndTestset` 下找到 0 张（共 2 个平台/资源组合）"));
    assert.ok(markdown.includes("没有任何平台包含 `不存在的图.png`"));
    assert.equal(markdown.includes("缺失"), false);
    assert.equal(markdown.includes("![]("), false);
});

test("hover 文本：测试集目录不存在时说目录不存在", () => {
    const markdown = buildImageHoverMarkdown(
        {
            imageName: "帝江号_大世界.png",
            controllers: [],
            testsetLabel: TESTSET_LABEL,
            testsetExists: false,
            locations: [],
        },
        toUri,
    );

    assert.ok(markdown.includes(`测试集目录 \`${TESTSET_LABEL}\` 不存在`));
    assert.ok(markdown.includes("本文件没写 configs.controller"));
    assert.equal(markdown.includes("![]("), false);
});

test("hover 文本：测试集里没有平台目录时也有说法", () => {
    const markdown = buildImageHoverMarkdown(
        {
            imageName: "帝江号_大世界.png",
            controllers: ["Win32"],
            testsetLabel: TESTSET_LABEL,
            testsetExists: true,
            locations: [],
        },
        toUri,
    );

    assert.ok(markdown.includes("在 `tests/MaaEndTestset` 下没扫到任何平台目录"));
    assert.ok(markdown.includes("没有任何平台包含 `帝江号_大世界.png`"));
});
