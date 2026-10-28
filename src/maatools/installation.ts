// 找到并跑「被测试仓库自己装的那份」@nekosu/maa-tools 命令行。
//
// 节点测试的定义来自被测试仓库：maatools.config.mts 是照它自己那份 maa-tools 写的
// （类型、test.cases 的返回结构、组名拼法、imageRoot 都由它决定），CI 里跑的也是那份。
// 插件如果自己装一份副本，就可能出现「插件说通过、CI 说失败」，而且极难查。
// 所以这里只认仓库里的那份：node_modules/@nekosu/maa-tools/bin/maa-tools，找不到就报错让人先装依赖。

import {spawn} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";
import * as path from "node:path";

import {isToolVersion} from "../core/toolStatus";

/** 找不到仓库里的 maa-tools，或安装版本不兼容时，入口将其作为前置错误。 */
export class MaaToolsLoadError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MaaToolsLoadError";
    }
}

/** 实际用的是哪份 maa-tools（记下来打进日志，出问题能看出版本） */
export interface MaaToolsSource {
    path: string;
    version: string | null;
}

/** 被测试仓库自己装的那份 maa-tools 的命令行入口。 */
export function workspaceMaaToolsCli(workspace: string): string {
    return path.join(workspace, "node_modules", "@nekosu", "maa-tools", "bin", "maa-tools");
}

/** 读一份 maa-tools 的版本号，读不到就返回 null。供实际启动前检查与版本状态查询共用。 */
export function readMaaToolsVersion(cliPath: string): string | null {
    try {
        const packageJsonPath = path.join(path.dirname(path.dirname(cliPath)), "package.json");
        const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {version?: unknown};
        return typeof parsed.version === "string" ? parsed.version : null;
    } catch {
        return null;
    }
}

/** 日志里怎么描述这次用的是哪份 maa-tools（纯函数，方便单测） */
export function describeMaaToolsSource(source: MaaToolsSource, workspace: string): string {
    const version = source.version ?? "版本未知";
    const relative = path.relative(workspace, source.path) || source.path;
    return `@nekosu/maa-tools ${version}（用仓库里的副本：${relative.split(path.sep).join("/")}）`;
}

/**
 * 找 maa-tools 命令行入口：仓库里的那份，找不到就抛 MaaToolsLoadError。
 * 返回 { cliPath, source }，source 记着实际用的是哪一份，入口会把版本打进日志。
 */
export function findMaaToolsCli(workspace: string): {cliPath: string; source: MaaToolsSource} {
    const cliPath = workspaceMaaToolsCli(workspace);
    if (!existsSync(cliPath)) {
        throw new MaaToolsLoadError(
            `仓库里没有 @nekosu/maa-tools 的命令行入口：${cliPath}\n` +
                `请先在被测仓库根（工作区根目录）执行 pnpm install。`,
        );
    }
    return {cliPath, source: {path: cliPath, version: readMaaToolsVersion(cliPath)}};
}

/** 本插件读取 maa-tools 1.x 的收集与运行数据；边界同用于状态栏和实际启动检查。 */
export const MIN_MAA_TOOLS_VERSION = "1.2.0";
export const MAX_MAA_TOOLS_VERSION_EXCLUSIVE = "2.0.0";
export const MAA_TOOLS_VERSION_RANGE = `>=${MIN_MAA_TOOLS_VERSION} <${MAX_MAA_TOOLS_VERSION_EXCLUSIVE}（仅稳定版）`;

/**
 * 版本号比较：a < b → 负数，相等 → 0，a > b → 正数。
 * 只比数字段（v 前缀忽略）；数字段全等时，带预发布后缀（如 1.2.0-beta）的视为更旧。
 */
export function compareVersions(a: string, b: string): number {
    const parse = (version: string) => {
        const [
            core = "",
            ...rest
        ] = version.replace(/^v/, "").split("+", 1)[0].split("-");
        return {
            parts: core.split(".").map((part) => Number.parseInt(part, 10)),
            preRelease: rest.length > 0,
        };
    };
    const left = parse(a);
    const right = parse(b);
    for (let i = 0; i < Math.max(left.parts.length, right.parts.length); i++) {
        const l = left.parts[i] ?? 0;
        const r = right.parts[i] ?? 0;
        if (l !== r) return l < r ? -1 : 1;
    }
    // 数字段全等：1.2.0-beta < 1.2.0
    if (left.preRelease !== right.preRelease) return left.preRelease ? -1 : 1;
    return 0;
}

/** 版本格式正确且是受支持的稳定版；构建元数据不影响兼容性。 */
export function isMaaToolsVersionSupported(version: unknown): boolean {
    return (
        isToolVersion(version) &&
        !version.split("+", 1)[0].includes("-") &&
        compareVersions(version, MIN_MAA_TOOLS_VERSION) >= 0 &&
        compareVersions(version, MAX_MAA_TOOLS_VERSION_EXCLUSIVE) < 0
    );
}

/** 真实收集与运行共用安装包检查；通过后仍须检查进程启动和实际输出。 */
export function requireSupportedMaaTools(source: MaaToolsSource): void {
    if (isMaaToolsVersionSupported(source.version)) return;
    const reason =
        source.version === null
            ? "安装包版本未知或无法读取"
            : !isToolVersion(source.version)
              ? `安装包版本格式无效：${JSON.stringify(source.version)}`
              : `安装包版本 ${source.version} 不兼容`;
    const packagePath = path.join(path.dirname(path.dirname(source.path)), "package.json");
    throw new MaaToolsLoadError(
        `${reason}；节点测试支持 ${MAA_TOOLS_VERSION_RANGE}。\n` +
            `版本来源：${packagePath}\n命令入口：${source.path}\n` +
            "请检查被测仓库的 @nekosu/maa-tools 依赖声明、锁文件和实际安装版本，再执行 pnpm install。",
    );
}

/**
 * 跑一次 `maa-tools --version` 问出 CLI 自己报的版本（状态栏与兼容提示共用）。
 * 问不到（旧版 CLI 不认识 --version、或进程起不来）返回 null，调用方自行兜底。
 */
export function queryMaaToolsVersion(nodePath: string, cliPath: string): Promise<string | null> {
    return new Promise((resolve) => {
        let child: ReturnType<typeof spawn>;
        try {
            child = spawn(
                nodePath,
                [
                    cliPath,
                    "--version",
                ],
                {
                    stdio: [
                        "ignore",
                        "pipe",
                        "pipe",
                    ],
                },
            );
        } catch {
            resolve(null);
            return;
        }
        let stdout = "";
        let settled = false;
        const settle = (value: string | null) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => (stdout += chunk));
        // stderr 不关心但必须排空：没人读的话子进程刷屏会把管道缓冲堵死
        child.stderr?.resume();
        // nodePath 指向一个挂住的程序时不无限等：5 秒问不到就当问不到
        const timer = setTimeout(() => {
            child.kill();
            settle(null);
        }, 5000);
        child.on("error", () => {
            clearTimeout(timer);
            settle(null);
        });
        child.on("close", () => {
            clearTimeout(timer);
            const line = stdout
                .split(/\r?\n/)
                .map((text) => text.trim())
                .find((text) => text.length > 0);
            settle(line && /^v?\d/.test(line) ? line : null);
        });
    });
}
