import {closeSync, existsSync, openSync, readSync, readdirSync, statSync} from "node:fs";
import * as path from "node:path";

/** 测试集里的一级目录（平台）和二级目录（资源），dirPath 是这一层的绝对路径 */
export interface PlatformResourceDir {
    platform: string;
    /** 二级目录名；平台下没有子目录时是空字符串 */
    resource: string;
    dirPath: string;
}

export interface PngSize {
    width: number;
    height: number;
}

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

/**
 * 在测试集里按平台找同名截图，并把每个组合的结果（含 PNG 尺寸）一起返回。
 * image 里带路径分隔符属于坏数据，直接当找不到处理，避免越界读文件。
 */
export function locateImage(testsetRoot: string, imageName: string): ImageLocation[] {
    if (!imageName || /[\\/]/.test(imageName)) return [];
    return scanTestsetDirs(testsetRoot).map((dir) => {
        const candidate = path.join(dir.dirPath, imageName);
        if (!isFile(candidate)) {
            return {platform: dir.platform, resource: dir.resource, filePath: null, size: null};
        }
        return {platform: dir.platform, resource: dir.resource, filePath: candidate, size: readPngSize(candidate)};
    });
}

/**
 * 只读 PNG 头 24 个字节拿尺寸，不把整张图读进内存（hover 会跟着鼠标反复触发）。
 * 文件不是 PNG 或者读不了返回 null。
 */
export function readPngSize(filePath: string): PngSize | null {
    let fd: number | undefined;
    try {
        fd = openSync(filePath, "r");
        const head = Buffer.alloc(24);
        if (readSync(fd, head, 0, 24, 0) < 24) return null;
        // PNG 签名：\x89 P N G \r \n \x1a \n
        if (head.readUInt32BE(0) !== 0x89504e47 || head.readUInt32BE(4) !== 0x0d0a1a0a) return null;
        // 紧接着是 IHDR 块，宽度和高度都是大端 32 位
        if (head.toString("ascii", 12, 16) !== "IHDR") return null;
        const width = head.readUInt32BE(16);
        const height = head.readUInt32BE(20);
        if (width <= 0 || height <= 0) return null;
        return {width, height};
    } catch {
        return null;
    } finally {
        if (fd !== undefined) {
            try {
                closeSync(fd);
            } catch {
                // 关闭失败就算了，不影响上面的结果
            }
        }
    }
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
