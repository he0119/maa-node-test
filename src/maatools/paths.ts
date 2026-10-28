import * as path from "node:path";

/**
 * 把命令行传来的路径解析成绝对路径。
 *
 * 为什么相对路径按「仓库根」解析而不是按 process.cwd()：扩展拉起本脚本时工作目录不保证在仓库根，
 * 接口约定的就是「--file 相对仓库根」，这样断言才稳定。
 */
export function resolveFromWorkspace(workspace: string, target: string): string {
    return path.isAbsolute(target) ? path.normalize(target) : path.resolve(workspace, target);
}

/** 日志里显示路径：仓库内显示相对路径，仓库外显示绝对路径，避免刷屏。 */
export function displayPath(workspace: string, target: string): string {
    const relative = path.relative(workspace, target);
    const inside = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    return toPosix(inside ? relative : target);
}

/** 统一正斜杠，让 Windows 上的输出和文档示例一致。 */
export function toPosix(value: string): string {
    return value.split(path.sep).join("/");
}
