import {existsSync, readFileSync} from "node:fs";
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
 * 被测试仓库自己装的那份 maa-tools 的入口文件。
 * 它是纯 ESM 包（package.json 里只有 import 条件导出），只能靠动态 import 拿。
 */
export function workspaceMaaToolsEntry(workspace) {
    return path.join(workspace, "node_modules", "@nekosu", "maa-tools", "dist", "index.mjs");
}

/** 读一份 maa-tools 的版本号，读不到就返回 null。只用于日志，出问题时能看出用的是哪一份。 */
export function readMaaToolsVersion(entryPath) {
    try {
        const packageJsonPath = path.join(path.dirname(path.dirname(entryPath)), "package.json");
        const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
        return typeof parsed.version === "string" ? parsed.version : null;
    } catch {
        return null;
    }
}

/** 日志里怎么描述这次用的是哪份 maa-tools（纯函数，方便单测） */
export function describeMaaToolsSource(source, workspace) {
    const version = source.version ?? "版本未知";
    if (source.kind === "workspace") {
        const relative = path.relative(workspace, source.path) || source.path;
        return `@nekosu/maa-tools ${version}（用仓库里的副本：${relative.split(path.sep).join("/")}）`;
    }
    return `@nekosu/maa-tools ${version}（按包名解析，不是仓库里的副本）`;
}

/**
 * 加载 @nekosu/maa-tools。
 *
 * 解析顺序是「仓库里的那份优先，包名兜底」，这个顺序是刻意的：
 *
 * 1. 节点测试的定义来自被测试仓库：`maatools.config.mts` 是照它自己那份 maa-tools 写的
 *    （类型、`test.cases` 的返回结构、组名拼法、`imageRoot` 都由它决定），`pnpm test` 在 CI 里跑的
 *    也是那份。插件如果自己装一份副本，就可能出现「插件说通过、CI 说失败」，而且极难查。
 * 2. 包名兜底只是为了「脚本被复制到别处做实验」这种场景，正常工作路径永远走第 1 条。
 *
 * 返回 { module, source }，source 记着实际加载的是哪一份，入口会把版本打进日志。
 */
export async function importMaaTools(workspace) {
    const entry = workspaceMaaToolsEntry(workspace);
    const errors = [];

    if (existsSync(entry)) {
        try {
            const module = await import(pathToFileURL(entry).href);
            return {
                module,
                source: {kind: "workspace", path: entry, version: readMaaToolsVersion(entry)},
            };
        } catch (error) {
            errors.push(`  仓库里的副本加载失败 ${entry}：${errorMessage(error)}`);
        }
    } else {
        errors.push(`  仓库里没有 ${entry}`);
    }

    try {
        const module = await import("@nekosu/maa-tools");
        return {module, source: {kind: "package", path: null, version: null}};
    } catch (error) {
        errors.push(`  按包名解析也失败：${errorMessage(error)}`);
    }

    throw new MaaToolsLoadError(
        `无法加载 @nekosu/maa-tools：\n${errors.join("\n")}\n` +
            `请先在仓库根（--workspace 指的那个目录）执行 pnpm install，确认 node_modules/@nekosu/maa-tools 存在。`,
    );
}

function errorMessage(error) {
    if (error && typeof error === "object" && "message" in error) return String(error.message);
    return String(error);
}
