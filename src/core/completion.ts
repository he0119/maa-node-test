import {getLocation} from "jsonc-parser";
import type {LoaderEntry} from "./loaderMaps";

/**
 * 测试文件里的补全。
 *
 * 补全的取值全都来自仓库本身，不写死：
 * - `controller` / `resource` → `tests/scripts/loader.mts` 的 controllerMap / resourceMap（那才是合法取值）；
 * - `image` → 测试集里真实存在的截图文件名（按本文件声明的 controller 收窄）；
 * - `hits` 里的节点名 → `assets/resource/pipeline/**` 里的节点。
 */

/** 光标处的 JSON 上下文：路径 + 是不是在写键 */
export interface CompletionContext {
    /** 例：`['configs','controller',0]`、`['cases',2,'image']` */
    path: (string | number)[];
    /** 光标在键上（例如刚敲完 `"con`） */
    atKey: boolean;
    /** 光标在字符串里面，插入时不用再加引号 */
    inString: boolean;
}

/** 补全数据的来源，由调用方注入，方便单测 */
export interface RepoData {
    controllers: readonly LoaderEntry[];
    resources: readonly LoaderEntry[];
    /** 截图文件名；按本文件声明的 controller 和截图子目录查找 */
    images: (controllers: readonly string[], imageRoot?: string) => readonly string[];
    /** pipeline 节点名；传本文件声明的 controller 后只算它们会加载的资源目录 */
    nodes: (controllers: readonly string[]) => readonly string[];
}

export type CandidateKind = "key" | "controller" | "resource" | "image" | "node";

export interface Candidate {
    label: string;
    kind: CandidateKind;
    /** 灰字说明，例如这个 controller 对应哪个截图目录 */
    detail?: string;
    /** 节点候选专用：节点名，provider 展开候选时再据此去查注释（懒加载，不预先拼 1938 段文字） */
    nodeName?: string;
}

/** 顶层和各级对象允许的键。测试文件的结构就这几层，写死不影响通用性 */
const KEYS_AT_ROOT = [
    "configs",
    "cases",
];
const KEYS_AT_CONFIGS = [
    "name",
    "resource",
    "controller",
    "imageRoot",
];
const KEYS_AT_CASE = [
    "name",
    "image",
    "hits",
];
const KEYS_AT_HIT = [
    "node",
    "box",
];

/**
 * 算出光标处的路径。`getLocation` 对「在对象里写键」和「在写值」给出的路径不同，这里统一成
 * 调用方好判断的形状。
 */
export function completionContextAt(text: string, offset: number): CompletionContext | null {
    const location = getLocation(text, offset);
    if (!location) return null;

    const path = [...location.path] as (string | number)[];
    // 在写键时，getLocation 会把「已经敲进去的那截键名」当最后一个路径段塞进来，这里去掉它，
    // 路径就统一成「光标所在的这个对象」
    if (location.isAtPropertyKey) path.pop();

    return {path, atKey: location.isAtPropertyKey, inString: isInsideString(text, offset)};
}

/**
 * 光标是不是在字符串里面（决定补全时要不要自己加引号）。
 *
 * 找光标左边最近的引号，数它前面还有多少个引号：偶数说明它是字符串的开头，光标就在字符串里；
 * 奇数说明它是上一个字符串的结尾，光标在字符串外面。
 */
function isInsideString(text: string, offset: number): boolean {
    const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
    let nearest = -1;
    let precedingQuotes = 0;
    for (let index = lineStart; index < offset; index += 1) {
        if (text[index] !== '"' || text[index - 1] === "\\") continue;
        nearest = index;
        precedingQuotes += 1;
    }
    if (nearest < 0) return false;
    // precedingQuotes 包含了 nearest 这个引号本身
    return (precedingQuotes - 1) % 2 === 0;
}

/**
 * 给定上下文，给出该位置的候选；拿不准就返回空数组（宁可不提示，也别给错的值）。
 * `declared` 是本文件 `configs.controller` 的取值，用来把截图列表收窄到实际会跑的平台。
 */
export function candidatesFor(
    context: CompletionContext,
    data: RepoData,
    declared: readonly string[] = [],
    imageRoot?: string,
): Candidate[] {
    const {path} = context;

    if (context.atKey) return keyCandidates(path);

    // 值是数组元素时路径末尾是个下标，判断字段要看它前面那一段
    const fieldPath =
        path[path.length - 1] === 0 || typeof path[path.length - 1] === "number" ? path.slice(0, -1) : path;
    const field = fieldPath[fieldPath.length - 1];

    if (fieldPath[0] === "configs" && field === "controller") {
        return data.controllers.map((entry) => ({
            label: entry.name,
            kind: "controller" as const,
            detail: entry.dir ? `截图目录 ${entry.dir}` : "loader 里没有对应目录",
        }));
    }

    if (fieldPath[0] === "configs" && field === "resource") {
        return data.resources.map((entry) => ({
            label: entry.name,
            kind: "resource" as const,
            detail: entry.dir ? `截图目录 ${entry.dir}` : "loader 里没有对应目录",
        }));
    }

    if (fieldPath[0] === "cases" && field === "image") {
        return data.images(declared, imageRoot).map((name) => ({label: name, kind: "image" as const}));
    }

    // hits 里的节点名：既可以写成字符串，也可以写成 { node: "..." }
    if (fieldPath[0] === "cases" && fieldPath[2] === "hits" && (field === "hits" || field === "node")) {
        return data.nodes(declared).map((name) => ({label: name, kind: "node" as const, nodeName: name}));
    }

    return [];
}

function keyCandidates(path: (string | number)[]): Candidate[] {
    const keysOf = (keys: string[], kind: CandidateKind = "key"): Candidate[] => keys.map((label) => ({label, kind}));

    if (path.length === 0) return keysOf(KEYS_AT_ROOT);
    if (path.length === 1 && path[0] === "configs") return keysOf(KEYS_AT_CONFIGS);
    if (path.length === 2 && path[0] === "cases" && typeof path[1] === "number") return keysOf(KEYS_AT_CASE);
    if (
        path.length === 4 &&
        path[0] === "cases" &&
        path[2] === "hits" &&
        typeof path[1] === "number" &&
        typeof path[3] === "number"
    ) {
        return keysOf(KEYS_AT_HIT);
    }
    return [];
}

/** 插入文本：已经写在字符串里就只插内容，否则连引号一起插 */
export function insertTextOf(candidate: Candidate, context: CompletionContext): string {
    if (context.inString) return candidate.label;
    return `"${candidate.label}"`;
}
