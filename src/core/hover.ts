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

    for (const location of input.locations) {
        blocks.push(describeLocation(location, toUriString));
    }
    return blocks.join("\n\n");
}

function describeFound(foundCount: number, totalCount: number, testsetLabel: string): string {
    if (totalCount === 0) return `在 \`${testsetLabel}\` 下没扫到任何平台目录`;
    return `在 \`${testsetLabel}\` 下找到 ${foundCount} 张（共 ${totalCount} 个平台/资源组合）`;
}

function describeControllers(controllers: readonly string[]): string {
    if (controllers.length === 0) return "本文件没写 configs.controller";
    return `本文件声明平台：${controllers.join("、")}`;
}

function describeLocation(location: ImageLocation, toUriString: (absolutePath: string) => string): string {
    const label = location.resource ? `**${location.platform} / ${location.resource}**` : `**${location.platform}**`;
    if (!location.filePath) return `${label} · 缺失`;

    const uri = toUriString(location.filePath);
    const size = location.size ? `${location.size.width}×${location.size.height}` : "尺寸读不出来";
    // 行尾两个空格是 Markdown 硬换行，让图片紧跟在描述下面一行
    return `${label} · ${size} · [打开原图](${uri})  \n![](${uri})`;
}
