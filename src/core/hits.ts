import {findNodeAtLocation, parseTree} from "jsonc-parser";
import type {Node} from "jsonc-parser";

/**
 * 测试文件里 `hits` 的一项。内联提示要靠它的位置，把节点注释贴在节点名后面。
 *
 * `hits` 有两种写法，都要认：
 * - 字符串：`"hits": ["InWorld"]`
 * - 对象：`"hits": [{"node": "InWorld", "box": [0, 0, 8, 8]}]`
 */
export interface HitEntry {
    /** 第几个用例，从 0 开始 */
    caseIndex: number;
    /** 用例里第几个 hit，从 0 开始 */
    hitIndex: number;
    /** 节点名 */
    name: string;
    /** 节点名那个字符串在文件里的 offset（含引号） */
    offset: number;
    /** 字符串长度（含引号） */
    length: number;
}

/** 解析出所有 hit 条目；读不懂的片段直接跳过，不抛异常 */
export function parseHitEntries(text: string): HitEntry[] {
    const root = parseTree(text);
    if (!root || root.type !== "object") return [];

    const cases = findNodeAtLocation(root, ["cases"]);
    if (!cases || cases.type !== "array") return [];

    const entries: HitEntry[] = [];
    for (const [
        caseIndex,
        caseNode,
    ] of (cases.children ?? []).entries()) {
        const hits = childOf(caseNode, "hits");
        if (!hits || hits.type !== "array") continue;

        for (const [
            hitIndex,
            hitNode,
        ] of (hits.children ?? []).entries()) {
            const nameNode = nameNodeOf(hitNode);
            if (!nameNode || typeof nameNode.value !== "string") continue;
            entries.push({
                caseIndex,
                hitIndex,
                name: nameNode.value,
                offset: nameNode.offset,
                length: nameNode.length,
            });
        }
    }
    return entries;
}

/** hit 是字符串就直接用，是对象就取它的 `node` 字段 */
function nameNodeOf(hitNode: Node): Node | undefined {
    if (hitNode.type === "string") return hitNode;
    if (hitNode.type !== "object") return undefined;
    const node = childOf(hitNode, "node");
    return node?.type === "string" ? node : undefined;
}

function childOf(node: Node, key: string): Node | undefined {
    return findNodeAtLocation(node, [key]);
}

/** 光标路径是不是 `hits` 里的一项：`cases[n].hits[m]` 或 `cases[n].hits[m].node` */
export function isHitsEntryPath(path: readonly (string | number)[]): boolean {
    if (path.length === 4) return path[0] === "cases" && path[2] === "hits";
    if (path.length === 5) return path[0] === "cases" && path[2] === "hits" && path[4] === "node";
    return false;
}

/** 内联提示最长显示多少个字，超过截断（提示是贴在代码行尾的，太长会挤走代码） */
export const INLAY_MAX_CHARS = 32;

/** 把节点注释压成一行短提示 */
export function truncateInlayLabel(label: string, max = INLAY_MAX_CHARS): string {
    const singleLine = label.replace(/\s+/g, " ").trim();
    if (singleLine.length <= max) return singleLine;
    return `${singleLine.slice(0, max - 1)}…`;
}
