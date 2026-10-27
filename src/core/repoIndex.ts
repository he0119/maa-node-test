import {readFileSync, readdirSync, statSync} from "node:fs";
import type {Dirent} from "node:fs";
import * as path from "node:path";
import type {RepoData} from "./completion";
import type {LoaderEntry, LoaderMaps} from "./loaderMaps";
import {describeNodeBehavior, describePipelineNode, parsePipelineNodes} from "./pipeline";
import type {PipelineNode} from "./pipeline";
import {EMPTY_LOADER_MAPS, dirOf, parseLoaderMaps, resolveControllerDir} from "./loaderMaps";
import {parseControllerResources, resourcesForControllers} from "./resources";
import type {ControllerResources} from "./resources";
import {scanTestsetDirs} from "./testset";

/**
 * pipeline 目录，节点名的来源。
 *
 * 不能只认 `assets/resource/pipeline`：MaaEnd 还有 `assets/resource_adb`、`resource_cloud_adb`、
 * `resource_linux`、`resource_macos` 这些平台覆盖目录，各自也有 `pipeline/`，里面会定义（或覆盖）
 * 节点。所以扫 `assets` 下**所有**叫 `pipeline` 的目录。
 */
const ASSETS_DIR = "assets";
/** interface.json 的位置，控制器 ↔ 资源目录的映射从这儿读 */
const INTERFACE_PATH = path.join("assets", "interface.json");
const PIPELINE_DIR_NAME = "pipeline";
/** 递归找 pipeline 目录的最大深度（`assets/<资源>/pipeline` 是 2 层，留点余量） */
const PIPELINE_SEARCH_DEPTH = 3;
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
    /** 按「要扫哪些资源目录」分开缓存：不同控制器组合的节点集合不一样 */
    private readonly nodeCache = new Map<string, {at: number; nodes: Map<string, PipelineNode[]>}>();
    /** 控制器组合 → 要读的 pipeline 文件清单 */
    private readonly fileListCache = new Map<string, {at: number; files: string[]}>();
    private interfaceCache: {stamp: number; resources: ControllerResources[]} | undefined;
    /** 资源目录 → pipeline 目录的清单，几秒内复用（每次补全都重新 walk 一遍太亏） */
    private availableCache: {at: number; dirs: Map<string, string>} | undefined;
    /** 单个 pipeline 文件的解析结果，按 mtime 复用：TTL 过期后只重新解析改过的文件 */
    private readonly nodeFiles = new Map<string, {mtime: number; nodes: PipelineNode[]}>();

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

    /**
     * pipeline 节点名：既是 `hits` 里能写的名字，也是识别结果的归因对象。
     * 传了 `controllers` 就只算这些控制器会加载的资源目录（见 `resourcesForControllers`）。
     */
    nodes(controllers: readonly string[] = []): readonly string[] {
        return [...this.nodeIndex(controllers).keys()].sort();
    }

    /** 某个节点的定义位置和说明；同名节点有多处定义时给按路径排序后的第一处（基础资源在前） */
    nodeInfo(name: string, controllers: readonly string[] = []): PipelineNode | undefined {
        return this.nodeInfos(name, controllers)[0];
    }

    /**
     * 同一个节点名的所有定义。平台覆盖目录（`resource_adb` 等）会重新定义基础资源里的节点，
     * 所以一个名字可能有多处 —— 顺序固定成「基础资源 `assets/resource/pipeline` 在前，其余按路径」，
     * 补全和悬浮里显示的就是基础那份，跳转列表里基础那份也排第一。
     */
    nodeInfos(name: string, controllers: readonly string[] = []): PipelineNode[] {
        return [...(this.nodeIndex(controllers).get(name) ?? [])].sort((left, right) => {
            const baseLeft = this.isBaseResource(left.filePath) ? 0 : 1;
            const baseRight = this.isBaseResource(right.filePath) ? 0 : 1;
            if (baseLeft !== baseRight) return baseLeft - baseRight;
            return left.filePath < right.filePath ? -1 : left.filePath > right.filePath ? 1 : 0;
        });
    }

    /** 是不是基础资源（`assets/resource/pipeline`）里的定义 */
    private isBaseResource(filePath: string): boolean {
        const relative = path.relative(this.workspaceRoot, filePath).replace(/\\/g, "/");
        return relative.startsWith(`${ASSETS_DIR}/resource/${PIPELINE_DIR_NAME}/`);
    }

    /**
     * 补全里挂在节点候选上的说明：注释 + 识别/动作 + 定义位置。
     * 抄参考实现（maa-support-extension）的写法，三段之间空行。
     */
    describeNode(name: string, controllers: readonly string[] = []): string | undefined {
        const node = this.nodeInfo(name, controllers);
        if (!node) return undefined;

        const where = relativePath(this.workspaceRoot, node.filePath);
        const blocks: string[] = [];
        const summary = describePipelineNode(node);
        if (summary) blocks.push(summary);

        const behavior = describeNodeBehavior(node);
        if (behavior) blocks.push(behavior);

        blocks.push(`定义在 \`${where}:${node.line}\``);
        return blocks.join("\n\n");
    }

    /** 节点名 → 节点信息；同名节点以先扫到的为准（MaaEnd 里不该有重名） */
    private nodeIndex(controllers: readonly string[] = []): Map<string, PipelineNode[]> {
        const files = this.pipelineFilesFor(controllers);
        const key = files.join("|");
        const cached = this.nodeCache.get(key);
        if (cached && Date.now() - cached.at < NODE_CACHE_TTL_MS) return cached.nodes;

        const nodes = new Map<string, PipelineNode[]>();
        const seen = new Set<string>();
        for (const file of files) {
            seen.add(file);
            const mtime = mtimeOf(file);
            const cached = this.nodeFiles.get(file);
            // 只重新解析改过的文件，没改的直接用上次的结果
            const parsed = cached && cached.mtime === mtime ? cached.nodes : parsePipelineNodes(readText(file), file);
            this.nodeFiles.set(file, {mtime, nodes: parsed});

            for (const node of parsed) {
                const list = nodes.get(node.name);
                if (list) list.push(node);
                else nodes.set(node.name, [node]);
            }
        }
        for (const file of [...this.nodeFiles.keys()]) {
            if (!seen.has(file)) this.nodeFiles.delete(file);
        }

        this.nodeCache.set(key, {at: Date.now(), nodes});
        return nodes;
    }

    /**
     * 这份测试文件会加载哪些 pipeline 文件：只看声明控制器挂的资源目录 + 基础资源。
     * 为什么不扫全部：平台覆盖目录（`resource_adb`、`resource_macos` …）里的节点多是在改别的平台
     * 的行为，混进补全里既吵又容易选错。
     */
    private pipelineFilesFor(controllers: readonly string[]): string[] {
        const key = [...controllers].sort().join(",");
        const cached = this.fileListCache.get(key);
        if (cached && Date.now() - cached.at < NODE_CACHE_TTL_MS) return cached.files;

        const files = this.computePipelineFiles(controllers);
        this.fileListCache.set(key, {at: Date.now(), files});
        return files;
    }

    private computePipelineFiles(controllers: readonly string[]): string[] {
        const available = this.availableResources();
        const mapping = this.controllerResources();
        const wanted = resourcesForControllers(controllers, mapping, [...available.keys()]);

        const files: string[] = [];
        for (const resource of wanted) {
            const dir = available.get(resource);
            if (dir) files.push(...listJsonFiles(dir));
        }
        return [...new Set(files)].sort();
    }

    /** `assets/<资源名>/pipeline` 目录，键是资源名（例如 `resource_adb`） */
    private availableResources(): Map<string, string> {
        if (this.availableCache && Date.now() - this.availableCache.at < NODE_CACHE_TTL_MS) {
            return this.availableCache.dirs;
        }

        const found = new Map<string, string>();
        for (const dir of findPipelineDirs(path.join(this.workspaceRoot, ASSETS_DIR), PIPELINE_SEARCH_DEPTH)) {
            found.set(path.basename(path.dirname(dir)), dir);
        }
        this.availableCache = {at: Date.now(), dirs: found};
        return found;
    }

    /** interface.json 里的控制器 → 资源目录映射，按 mtime 缓存 */
    private controllerResources(): ControllerResources[] {
        const interfacePath = path.join(this.workspaceRoot, INTERFACE_PATH);
        const stamp = mtimeOf(interfacePath);
        if (this.interfaceCache && this.interfaceCache.stamp === stamp) return this.interfaceCache.resources;

        const resources = stamp === 0 ? [] : parseControllerResources(readText(interfacePath));
        this.interfaceCache = {stamp, resources};
        return resources;
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

/** 相对工作区的路径，统一正斜杠 */
function relativePath(root: string, target: string): string {
    return path.relative(root, target).replace(/\\/g, "/");
}

/** 找出 `assets` 下所有名为 pipeline 的目录（含自身），深度受限，跳过常见的大目录 */
function findPipelineDirs(root: string, depth: number): string[] {
    const found: string[] = [];
    const walk = (dir: string, left: number): void => {
        if (path.basename(dir) === PIPELINE_DIR_NAME) {
            found.push(dir);
            return;
        }
        if (left <= 0) return;

        let entries: Dirent[];
        try {
            entries = readdirSync(dir, {withFileTypes: true});
        } catch {
            return;
        }
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "install") continue;
            walk(path.join(dir, entry.name), left - 1);
        }
    };
    walk(root, depth);
    return found;
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
