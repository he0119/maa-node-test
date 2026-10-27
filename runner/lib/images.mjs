import {existsSync} from "node:fs";
import path from "node:path";

/**
 * 截图绝对路径。
 *
 * 必须和 @nekosu/maa-tools runTest 里的算法逐字一致：
 *   path.resolve(cfg.cwd, cfg.test.casesCwd, group.configs.imageRoot ?? '.', case.image)
 * 不一致的话就会出现「预检说图片存在、maa-tools 说 not exists」的对不上，排查起来非常费劲。
 */
export function resolveImagePath(cfg, group, image) {
    const cwd = cfg?.cwd ?? process.cwd();
    const casesCwd = cfg?.test?.casesCwd ?? ".";
    const imageRoot = group?.configs?.imageRoot ?? ".";
    return path.resolve(cwd, casesCwd, imageRoot, image);
}

/**
 * 按「过滤后的组 × 用例」逐个检查截图是否存在。
 * exists 可注入，方便单测不碰真实文件系统。
 */
export function scanImages(cfg, groups, exists = existsSync) {
    return groups.map((group) => ({
        group,
        images: group.cases.map((testCase) => {
            const file = resolveImagePath(cfg, group, testCase.image);
            return {
                image: testCase.image,
                path: file,
                exists: exists(file),
            };
        }),
    }));
}

/** 统计截图存在情况：maa-tools 遇到不存在的图片只打印 ignored 然后跳过，跳过即视为通过。 */
export function countImages(scan) {
    let total = 0;
    let existing = 0;
    for (const entry of scan) {
        for (const item of entry.images) {
            total += 1;
            if (item.exists) existing += 1;
        }
    }
    return {total, existing, missing: total - existing};
}
