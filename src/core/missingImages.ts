import type {TestCase} from "./document";
import type {ImageLocation} from "./testset";

/**
 * 一条用例缺截图的警告。探测阶段（扫测试文件时）就能算出来，不用等跑测试。
 *
 * 为什么要提前警告：`maa-tools` 遇到不存在的截图只打印跳过、跳过即通过，所以缺图的用例跑完是「绿的」。
 * 等跑完再看就晚了 —— 写用例的时候就应该知道「这个声明的平台其实没有截图」。
 */
export interface MissingImageWarning {
    /** 用例下标，和测试面板的节点、runner 的 --case 一致 */
    caseIndex: number;
    /** 截图文件名 */
    image: string;
    /** image 值的起点 offset（含左侧引号），给诊断画范围 */
    offset: number;
    /** image 值的长度（含引号） */
    length: number;
    /** 声明了但没有截图的平台 */
    platforms: MissingPlatform[];
}

export interface MissingPlatform {
    platform: string;
    /**
     * 测试集里有没有这个平台的目录。
     * 没有 = 目录名和 controller 名对不上，或者这个平台还没建目录；有 = 单纯缺这一张图。
     */
    hasDirectory: boolean;
}

export interface MissingImageInput {
    /** 解析出来的用例列表 */
    cases: readonly TestCase[];
    /** 本文件 configs.controller 声明的平台 */
    controllers: readonly string[];
    /** 按图片名查各平台/资源下的命中情况（由调用方注入，便于单测和复用扫描结果） */
    locate: (image: string) => readonly ImageLocation[];
    /**
     * 把测试文件里的 controller 名字换成截图目录名。
     * 有别名时（loader 里 `Win32-Front` 和 `Win32` 指向同一个目录）必须换，否则会误报「没有这个平台目录」。
     */
    resolvePlatform?: (controller: string) => string;
}

/**
 * 逐条用例检查：本文件声明的平台里，哪些在这个平台上一张截图都没有。
 *
 * 刻意不做的判断：
 * - 没写 `configs.controller` 就不判断（没法知道该有哪些平台）；
 * - 测试集一个平台目录都没扫到也不判断（多半是 `maaNodeTest.testsetDir` 配错了，这时候每条都警告只是噪音）。
 */
export function collectMissingImages(input: MissingImageInput): MissingImageWarning[] {
    if (input.controllers.length === 0) return [];

    const warnings: MissingImageWarning[] = [];
    for (const testCase of input.cases) {
        const image = testCase.image;
        if (!image) continue;

        const locations = input.locate(image.value);
        if (locations.length === 0) return [];

        const platformsPresent = new Set(
            locations.filter((item) => item.filePath !== null).map((item) => item.platform),
        );
        const platformsScanned = new Set(locations.map((item) => item.platform));
        // 别名（Win32-Front → Win32）要先换成目录名再比对，否则会被当成「没有这个平台」
        const resolve = input.resolvePlatform ?? ((controller: string) => controller);

        const platforms = input.controllers
            .filter((controller) => !platformsPresent.has(resolve(controller)))
            .map((controller) => ({
                platform: controller,
                hasDirectory: platformsScanned.has(resolve(controller)),
            }));

        if (platforms.length === 0) continue;

        warnings.push({
            caseIndex: testCase.index,
            image: image.value,
            offset: image.valueOffset,
            length: image.valueLength,
            platforms,
        });
    }

    return warnings;
}

/** 诊断里那句人话 */
export function describeMissingImage(warning: MissingImageWarning): string {
    const noDirectory = warning.platforms.filter((item) => !item.hasDirectory).map((item) => item.platform);
    const missingFile = warning.platforms.filter((item) => item.hasDirectory).map((item) => item.platform);

    const parts: string[] = [];
    if (missingFile.length > 0) {
        parts.push(`${missingFile.join("、")} 上没有 ${warning.image}`);
    }
    if (noDirectory.length > 0) {
        parts.push(`测试集里没有 ${noDirectory.join("、")} 的平台目录（检查 controller 名字或 testsetDir 设置）`);
    }
    parts.push("这些平台不会验证到这条用例");
    return parts.join("；");
}

/** 测试面板里挂在用例节点上的短提示，例如 `缺 ADB、CloudADB 截图` */
export function summarizeMissingImage(warning: MissingImageWarning): string {
    return `缺 ${warning.platforms.map((item) => item.platform).join("、")} 截图`;
}
