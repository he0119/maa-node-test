import {existsSync} from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

/** 设置项，已经过默认值兜底和路径归一化（统一用正斜杠） */
export interface NodeTestConfig {
    /** node 可执行文件，可以是 `node` 也可以是绝对路径 */
    nodePath: string;
    /** maatools 配置文件，相对工作区根 */
    configPath: string;
    /** 测试截图根目录，相对工作区根 */
    testsetDir: string;
    /** 悬浮里预览图的显示宽度，0 表示按原图尺寸 */
    hoverImageWidth: number;
    /** 是否在 hits 里的节点名后面显示注释（内联提示） */
    hitsInlayHints: boolean;
}

/** 设置 + 解析好的工作区根目录，命令和 hover 都从这里取 */
export interface NodeTestWorkspace {
    workspaceRoot: string;
    nodePath: string;
    configPath: string;
    testsetDir: string;
    /** 测试集目录的绝对路径 */
    testsetRoot: string;
    /** 悬浮里预览图的显示宽度，0 表示按原图尺寸 */
    hoverImageWidth: number;
    /** 是否在 hits 里的节点名后面显示注释（内联提示） */
    hitsInlayHints: boolean;
}

const SECTION = "maaNodeTest";
const DEFAULT_NODE_PATH = "node";
const DEFAULT_CONFIG_PATH = "maatools.config.mts";
const DEFAULT_TESTSET_DIR = "tests/MaaEndTestset";
const DEFAULT_HOVER_IMAGE_WIDTH = 400;

/** 读三个设置项，空字符串当作没填 */
export function readNodeTestConfig(): NodeTestConfig {
    const config = vscode.workspace.getConfiguration(SECTION);
    return {
        nodePath: nonEmpty(config.get<string>("nodePath")) ?? DEFAULT_NODE_PATH,
        configPath: toPosix(nonEmpty(config.get<string>("configPath")) ?? DEFAULT_CONFIG_PATH),
        testsetDir: toPosix(nonEmpty(config.get<string>("testsetDir")) ?? DEFAULT_TESTSET_DIR),
        hoverImageWidth: readWidth(config.get<number>("hoverImageWidth")),
        hitsInlayHints: config.get<boolean>("hitsInlayHints") ?? true,
    };
}

/**
 * 选工作区根目录：优先选真正含 maatools 配置文件的那个 folder（一个人可能开了好几个目录），
 * 都不含就退化成第一个 folder；连 folder 都没有就返回 null。
 */
export function resolveWorkspaceRoot(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;

    const {configPath} = readNodeTestConfig();
    const matched = folders.find(
        (folder) => folder.uri.scheme === "file" && existsSync(path.join(folder.uri.fsPath, configPath)),
    );
    return (matched ?? folders[0]).uri.fsPath;
}

/** 设置和工作区根一起返回；没有打开任何文件夹时给 null */
export function resolveNodeTestWorkspace(): NodeTestWorkspace | null {
    const workspaceRoot = resolveWorkspaceRoot();
    if (!workspaceRoot) return null;

    const config = readNodeTestConfig();
    const testsetRoot = path.isAbsolute(config.testsetDir)
        ? config.testsetDir
        : path.join(workspaceRoot, config.testsetDir);
    return {workspaceRoot, ...config, testsetRoot};
}

/** 宽度：没填或填了负数都回到默认值；0 是「按原图尺寸」，要保留 */
function readWidth(value: number | undefined): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return DEFAULT_HOVER_IMAGE_WIDTH;
    return Math.round(value);
}

function nonEmpty(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

function toPosix(target: string): string {
    return target.replace(/\\/g, "/");
}
