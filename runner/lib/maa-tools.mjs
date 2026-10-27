import {existsSync} from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

/** 加载不到 @nekosu/maa-tools 时抛这个，入口当作前置错误（退出码 2），并提示先装依赖。 */
export class MaaToolsLoadError extends Error {
    constructor(message) {
        super(message);
        this.name = "MaaToolsLoadError";
    }
}

/**
 * 加载 @nekosu/maa-tools。
 *
 * 它是纯 ESM 包（package.json 里只有 import 条件导出），只能用动态 import。
 * 先按包名解析：本脚本在 <仓库根>/dev/maa-node-test/runner，node 会逐级向上找到仓库根的 node_modules。
 * 解析不到（比如脚本被复制走了、或 --workspace 指向别的 clone）时，退回 <workspace>/node_modules 下的显式路径，
 * 这样「仓库根在哪」始终由 --workspace 决定，不依赖脚本自身位置。
 */
export async function importMaaTools(workspace) {
    try {
        return await import("@nekosu/maa-tools");
    } catch (packageError) {
        const fallback = path.join(workspace, "node_modules", "@nekosu", "maa-tools", "dist", "index.mjs");
        if (existsSync(fallback)) {
            try {
                return await import(pathToFileURL(fallback).href);
            } catch (fallbackError) {
                throw new MaaToolsLoadError(
                    `无法加载 @nekosu/maa-tools：\n` +
                        `  按包名解析失败：${errorMessage(packageError)}\n` +
                        `  按显式路径 ${fallback} 加载也失败：${errorMessage(fallbackError)}\n` +
                        `请先在仓库根执行 pnpm install，确认 node_modules/@nekosu/maa-tools 存在。`,
                );
            }
        }
        throw new MaaToolsLoadError(
            `无法加载 @nekosu/maa-tools：\n` +
                `  按包名解析失败：${errorMessage(packageError)}\n` +
                `  ${fallback} 也不存在\n` +
                `请先在仓库根执行 pnpm install。`,
        );
    }
}

function errorMessage(error) {
    if (error && typeof error === "object" && "message" in error) return String(error.message);
    return String(error);
}
