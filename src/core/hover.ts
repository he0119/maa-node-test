import type {ImageLocation} from "./testset";

export interface ImageHoverInput {
    /** image 字段里的文件名，例如 `帝江号_大世界.png` */
    imageName: string;
    /** 本文件 configs.controller 声明的平台，可能为空 */
    controllers: readonly string[];
    /** 测试集目录在提示文字里的写法，通常是相对工作区根的路径 */
    testsetLabel: string;
    /** 测试集目录在不在。不在的话直接说清楚，别让用户对着「缺失」瞎猜 */
    testsetExists: boolean;
    /** 按扫描结果逐个平台的查找结果 */
    locations: readonly ImageLocation[];
    /** controller 显示名 → 截图目录名（loader 的映射）；别名指向同一目录时不能算「没有这个平台」 */
    controllerDirs?: ReadonlyMap<string, string>;
    /**
     * 预览图的显示宽度（像素）。0 表示按原图尺寸显示。
     * 1280×720 的截图按原尺寸塞进悬浮会占掉半屏，默认缩到 400 宽，看不清再点「打开原图」。
     */
    imageWidth?: number;
}

/**
 * 拼 hover 里的 Markdown 正文。纯函数：绝对路径怎么变成 URI 由调用方给回调决定，
 * 这样这个文件不依赖 vscode，可以直接跑单测。
 */
export function buildImageHoverMarkdown(input: ImageHoverInput, toUriString: (absolutePath: string) => string): string {
    const found = input.locations.filter((location) => location.filePath !== null);
    const blocks = [
        `**${input.imageName}** · ${describeFound(
            found.length,
            input.locations.length,
            input.testsetLabel,
        )} · ${describeControllers(input.controllers)}`,
    ];

    if (!input.testsetExists) {
        blocks.push(
            `测试集目录 \`${input.testsetLabel}\` 不存在。先确认 \`maaNodeTest.testsetDir\` 设置，或者把截图放进去。`,
        );
        return blocks.join("\n\n");
    }

    if (found.length === 0) {
        blocks.push(
            `没有任何平台包含 \`${input.imageName}\`。看看文件名有没有写错，或者把这张截图补到对应平台的资源目录下。`,
        );
        return blocks.join("\n\n");
    }

    const imageWidth = input.imageWidth ?? DEFAULT_IMAGE_WIDTH;
    for (const location of input.locations) {
        blocks.push(describeLocation(location, toUriString, imageWidth));
    }

    // 声明了但测试集里连平台目录都没有：这种最容易被忽略 —— 上面按目录扫描，压根不会出现它
    for (const controller of declaredButAbsent(input)) {
        blocks.push(`**${controller}** · \`${input.testsetLabel}\` 下没有这个平台的目录`);
    }

    return blocks.join("\n\n");
}

/** 本文件声明了、但测试集里没扫到的平台（名字对不上或目录缺失） */
function declaredButAbsent(input: ImageHoverInput): string[] {
    const scanned = new Set(input.locations.map((location) => location.platform));
    const dirOf = (controller: string): string => input.controllerDirs?.get(controller) ?? controller;
    return [...new Set(input.controllers)].filter((controller) => !scanned.has(dirOf(controller)));
}

function describeFound(foundCount: number, totalCount: number, testsetLabel: string): string {
    if (totalCount === 0) return `在 \`${testsetLabel}\` 下没扫到任何平台目录`;
    return `在 \`${testsetLabel}\` 下找到 ${foundCount} 张（共 ${totalCount} 个平台/资源组合）`;
}

function describeControllers(controllers: readonly string[]): string {
    if (controllers.length === 0) return "本文件没写 configs.controller";
    return `本文件声明平台：${controllers.join("、")}`;
}

/** 默认预览宽度。原始截图是 1280×720，按原尺寸显示会占掉大半个悬浮框 */
export const DEFAULT_IMAGE_WIDTH = 400;

function describeLocation(
    location: ImageLocation,
    toUriString: (absolutePath: string) => string,
    imageWidth: number,
): string {
    const label = location.resource ? `**${location.platform} / ${location.resource}**` : `**${location.platform}**`;
    if (!location.filePath) return `${label} · 缺失`;

    const uri = toUriString(location.filePath);
    const size = location.size ? `${location.size.width}×${location.size.height}` : "尺寸读不出来";
    // 行尾两个空格是 Markdown 硬换行，让图片紧跟在描述下面一行
    return `${label} · ${size} · [打开原图](${uri})  \n${renderImage(location, uri, imageWidth)}`;
}

/**
 * 生成图片那一行。
 *
 * 宽度可控时用 HTML `<img>`：Markdown 图片语法没法指定尺寸，1280×720 的图会按原尺寸铺开。
 * 用 `<img>` 需要 hover 那边打开 `MarkdownString.supportHtml`（providers/hover.ts 里有）。
 * 设成 0 就回落到 Markdown 语法，万一哪天 HTML 渲染出问题，用户还有个开关能自救。
 */
function renderImage(location: ImageLocation, uri: string, imageWidth: number): string {
    const alt = location.resource ? `${location.platform} / ${location.resource}` : location.platform;
    if (!Number.isFinite(imageWidth) || imageWidth <= 0) return `![${alt}](${uri})`;

    // 高度按原图比例算，占位稳定；读不出尺寸就不写 height，让它自己撑开
    const height =
        location.size && location.size.width > 0
            ? ` height="${Math.round((imageWidth * location.size.height) / location.size.width)}"`
            : "";
    return `<img src="${uri}" alt="${alt}" width="${Math.round(imageWidth)}"${height}>`;
}
