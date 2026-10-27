import {readFileSync, readdirSync, statSync} from "node:fs";
import type {Dirent} from "node:fs";
import * as path from "node:path";
import type {RepoData} from "./completion";
import type {LoaderEntry, LoaderMaps} from "./loaderMaps";
import {EMPTY_LOADER_MAPS, dirOf, parseLoaderMaps, resolveControllerDir} from "./loaderMaps";
import {scanTestsetDirs} from "./testset";

/** pipeline 目录，节点名的来源 */
const PIPELINE_DIR = path.join("assets", "resource", "pipeline");
/** loader 文件，controller / resource 合法取值的来源 */
const LOADER_PATH = path.join("tests", "scripts", "loader.mts");
/** 节点名缓存的有效期：补全每次都读 421 个 pipeline 文件太浪费，隔一会儿再看就行 */
const NODE_CACHE_TTL_MS = 10_000;

/**
 * 补全用的仓库索引。数据都来自被测仓库本身，按需读取并缓存：
 * - `tests/scripts/loader.mts` 的映射表（改了就按 mtime 重新读）；
 * - 测试集里的截图文件名（目录 mtime 变了就重扫）；
 * - pipeline 里的节点名（懒加载，缓存 10 秒）。
 */
export class RepoIndex implements RepoData {
    private mapsCache: {stamp: number; maps: LoaderMaps} | undefined;
    private imageCache: {stamp: string; byPlatform: Map<string, string[]>} | undefined;
    private nodeCache: {at: number; names: string[]} | undefined;

    constructor(
        private readonly workspaceRoot: string,
        private readonly testsetRoot: string,
    ) {}

    get controllers(): readonly LoaderEntry[] {
        return this.maps().controllers;
    }

    get resources(): readonly LoaderEntry[] {
        return this.maps().resources;
    }

    /** 截图文件名：能确定平台就只取这些平台的，确定不了就给全部 */
    images(controllers: readonly string[]): readonly string[] {
        const byPlatform = this.imagesByPlatform();
        const platforms = controllers.map((controller) => resolveControllerDir(this.maps(), controller));
        const names = new Set<string>();
        for (const [
            platform,
            list,
        ] of byPlatform) {
            if (platforms.length > 0 && !platforms.includes(platform)) continue;
            for (const name of list) names.add(name);
        }
        return [...names].sort();
    }

    /** pipeline 节点名：既是 hits 里能写的名字，也是识别结果的归因对象 */
    nodes(): readonly string[] {
        if (this.nodeCache && Date.now() - this.nodeCache.at < NODE_CACHE_TTL_MS) return this.nodeCache.names;

        const names = new Set<string>();
        for (const file of listJsonFiles(path.join(this.workspaceRoot, PIPELINE_DIR))) {
            const keys = topLevelKeysOf(file);
            for (const key of keys) names.add(key);
        }
        const sorted = [...names].sort();
        this.nodeCache = {at: Date.now(), names: sorted};
        return sorted;
    }

    /** 当前读到的映射表（带 mtime 缓存） */
    maps(): LoaderMaps {
        const loaderPath = path.join(this.workspaceRoot, LOADER_PATH);
        const stamp = mtimeOf(loaderPath);
        if (this.mapsCache && this.mapsCache.stamp === stamp) return this.mapsCache.maps;

        const maps = stamp === 0 ? EMPTY_LOADER_MAPS : parseLoaderMaps(readText(loaderPath));
        this.mapsCache = {stamp, maps};
        return maps;
    }

    /** 平台（截图目录名）→ 这个平台下所有截图文件名 */
    private imagesByPlatform(): Map<string, string[]> {
        const dirs = scanTestsetDirs(this.testsetRoot);
        const stamp = dirs.map((dir) => `${dir.dirPath}:${mtimeOf(dir.dirPath)}`).join("|");
        if (this.imageCache && this.imageCache.stamp === stamp) return this.imageCache.byPlatform;

        const byPlatform = new Map<string, string[]>();
        for (const dir of dirs) {
            const bucket = byPlatform.get(dir.platform) ?? [];
            for (const name of listPngFiles(dir.dirPath)) bucket.push(name);
            byPlatform.set(dir.platform, bucket);
        }

        this.imageCache = {stamp, byPlatform};
        return byPlatform;
    }
}

/** 递归列出目录下的 json 文件；目录不在就返回空 */
function listJsonFiles(root: string): string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
        let entries: Dirent[];
        try {
            entries = readdirSync(dir, {withFileTypes: true});
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".json")) found.push(full);
        }
    };
    walk(root);
    return found;
}

/** 只取顶层键，不解析整份 JSON 之外的任何东西；坏文件跳过 */
function topLevelKeysOf(file: string): string[] {
    const text = readText(file);
    if (!text) return [];
    try {
        const parsed: unknown = JSON.parse(stripTrailingCommas(text));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
        return Object.keys(parsed as Record<string, unknown>);
    } catch {
        return [];
    }
}

/** MaaEnd 的 pipeline 允许尾逗号（JSONC 风格），JSON.parse 之前先去掉 */
function stripTrailingCommas(text: string): string {
    return text.replace(/,(\s*[}\]])/g, "$1");
}

function listPngFiles(dir: string): string[] {
    try {
        return readdirSync(dir, {withFileTypes: true})
            .filter((entry) => entry.isFile() && entry.name.endsWith(".png"))
            .map((entry) => entry.name)
            .sort();
    } catch {
        return [];
    }
}

function readText(file: string): string {
    try {
        return readFileSync(file, "utf8");
    } catch {
        return "";
    }
}

/** 读不到（文件不存在）时返回 0，用它当缓存戳 */
function mtimeOf(target: string): number {
    try {
        return statSync(target).mtimeMs;
    } catch {
        return 0;
    }
}

export {dirOf};
