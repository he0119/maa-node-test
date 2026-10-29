import * as path from "node:path";

function platformPath(platform: NodeJS.Platform = process.platform) {
    return platform === "win32" ? path.win32 : path.posix;
}

/** 比较和 Map 使用的路径身份；Windows 忽略大小写，显示路径不经过此转换。 */
export function pathKey(value: string, platform: NodeJS.Platform = process.platform): string {
    if (value === "") return value;
    return platform === "win32"
        ? path.win32.normalize(value).replace(/\\/g, "/").toLowerCase()
        : path.posix.normalize(value);
}

export function samePath(left: string, right: string, platform: NodeJS.Platform = process.platform): boolean {
    return pathKey(left, platform) === pathKey(right, platform);
}

export function isAbsolutePath(value: string): boolean {
    return platformPath().isAbsolute(value);
}

/** 命令参数的相对路径一律按被测仓库根解析。 */
export function resolveFromWorkspace(workspace: string, target: string): string {
    const api = platformPath();
    return api.isAbsolute(target) ? api.normalize(target) : api.resolve(workspace, target);
}

/** 日志里显示路径：仓库内显示相对路径，仓库外显示绝对路径，保留原有大小写。 */
export function displayPath(workspace: string, target: string): string {
    const api = platformPath();
    const relative = api.relative(workspace, target);
    const inside =
        relative !== "" && relative !== ".." && !relative.startsWith(`..${api.sep}`) && !api.isAbsolute(relative);
    return toPosix(inside ? relative : target);
}

/** 统一正斜杠，让 Windows 上的输出和文档示例一致。 */
export function toPosix(value: string): string {
    return process.platform === "win32" ? value.replace(/\\/g, "/") : value;
}
