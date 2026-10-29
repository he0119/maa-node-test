import {existsSync, readdirSync, realpathSync, statSync} from "node:fs";
import * as path from "node:path";

/** 截图目录的平台、资源归属，以及实际查找目录的绝对路径。 */
export interface PlatformResourceDir {
    platform: string;
    /** 二级目录名；平台下没有子目录时是空字符串 */
    resource: string;
    dirPath: string;
}

import {type PngSize, readPngSizeFromFile} from "./png";
/** 某张截图在某个「平台 / 资源」组合下的查找结果 */
export interface ImageLocation {
    platform: string;
    resource: string;
    /** 命中的截图绝对路径；没找到是 null */
    filePath: string | null;
    /** PNG 尺寸；没找到、或者文件不是合法 PNG 时是 null */
    size: PngSize | null;
}

/**
 * 扫测试集目录：一级目录当平台，二级目录当资源。
 * 平台下没有二级目录时，资源算空字符串（目录结构就少一层）。
 * 目录不存在或者读不了就返回空数组，不抛异常。
 */
export function scanTestsetDirs(testsetRoot: string): PlatformResourceDir[] {
    if (!isDirectory(testsetRoot)) return [];

    const result: PlatformResourceDir[] = [];
    for (const platform of listDirs(testsetRoot)) {
        const platformPath = path.join(testsetRoot, platform);
        const resources = listDirs(platformPath);
        if (resources.length === 0) {
            result.push({platform, resource: "", dirPath: platformPath});
            continue;
        }
        for (const resource of resources) {
            result.push({platform, resource, dirPath: path.join(platformPath, resource)});
        }
    }
    return result;
}

/** 按测试文件声明的 imageRoot 定位截图目录，不递归寻找同名文件。 */
export function scanImageDirs(testsetRoot: string, imageRoot = "."): PlatformResourceDir[] {
    if (path.isAbsolute(imageRoot)) return [];
    return scanTestsetDirs(testsetRoot).flatMap((dir) => {
        const dirPath = path.resolve(dir.dirPath, imageRoot);
        if (!isWithinDirectory(dir.dirPath, dirPath)) return [];
        try {
            if (!isWithinDirectory(realpathSync(dir.dirPath), realpathSync(dirPath))) return [];
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== "ENOENT" && code !== "ENOTDIR") return [];
        }
        return [{...dir, dirPath}];
    });
}

/** 在声明的截图子目录中查找图片；image 保持为文件名，避免越界读取。 */
export function locateImage(testsetRoot: string, imageName: string, imageRoot?: string): ImageLocation[] {
    if (!imageName || /[\\/]/.test(imageName)) return [];
    return scanImageDirs(testsetRoot, imageRoot).map((dir) => {
        const candidate = path.join(dir.dirPath, imageName);
        if (!isFile(candidate)) {
            return {platform: dir.platform, resource: dir.resource, filePath: null, size: null};
        }
        return {
            platform: dir.platform,
            resource: dir.resource,
            filePath: candidate,
            size: readPngSizeFromFile(candidate),
        };
    });
}

function isWithinDirectory(directory: string, target: string): boolean {
    const relative = path.relative(path.resolve(directory), target);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isDirectory(target: string): boolean {
    try {
        return statSync(target).isDirectory();
    } catch {
        return false;
    }
}

function isFile(target: string): boolean {
    try {
        return statSync(target).isFile();
    } catch {
        return false;
    }
}

/** 列出某个目录下的子目录名，按字符序排序，保证每次扫描顺序一致 */
function listDirs(parent: string): string[] {
    if (!existsSync(parent)) return [];
    try {
        return readdirSync(parent, {withFileTypes: true})
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();
    } catch {
        return [];
    }
}

/**
 * 按本文件声明的 controller 顺序排一遍截图：声明了的排前面（按声明顺序），没声明的按扫描顺序接在后面。
 *
 * 悬浮预览和 Ctrl+Click 的列表都用这个顺序 —— 两处不一致看着别扭：文件里写 `["Win32", "ADB"]`，
 * 一处 Win32 在前、一处 ADB 在前，很容易看串。
 */
export function orderImageLocations(
    locations: readonly ImageLocation[],
    controllers: readonly string[] = [],
    resolvePlatform: (controller: string) => string = (controller) => controller,
): ImageLocation[] {
    if (controllers.length === 0) return [...locations];

    const declared = controllers.map(resolvePlatform);
    const rankOf = (platform: string): number => {
        const index = declared.indexOf(platform);
        return index < 0 ? declared.length : index;
    };

    // sort 是稳定的：同样名次的平台保持原来的扫描顺序
    return [...locations].sort((left, right) => rankOf(left.platform) - rankOf(right.platform));
}
