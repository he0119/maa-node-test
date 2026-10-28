import {findNodeAtLocation, parseTree} from "jsonc-parser";
import type {Node} from "jsonc-parser";

/**
 * pipeline 里一个节点的位置和说明。补全的说明文字、`转到定义`、悬浮都靠它。
 *
 * 只记位置和几个短字段，节点正文要用时再按 offset 去原文里截 —— 上千个节点全存下来也不占多少内存。
 */
export interface PipelineNode {
    /** 节点名，也就是测试文件 `hits` 里能写的值 */
    name: string;
    /** 定义这个节点的文件绝对路径 */
    filePath: string;
    /** 节点名（键）在文件里的 offset，含引号 */
    keyOffset: number;
    /** 整个节点（键 + 值）的结束 offset，用来截出源码片段 */
    endOffset: number;
    /** 节点名所在行，从 1 开始 */
    line: number;
    /** 节点的 `desc`，也就是写 pipeline 的人留的注释 */
    desc?: string;
    /** 节点里的 `focus`，MaaEnd 用它写调试提示 */
    focus?: string;
    /** 识别方式：内置算法名或自定义识别名 */
    recognition?: string;
    /** 动作类型：内置动作名或自定义动作名 */
    action?: string;
}

/**
 * 解析一份 pipeline 文件里的节点。注释和尾逗号都能容忍（jsonc）；
 * 读不懂的文本返回空数组，写到一半的文件则尽量给出已经能认出来的节点。
 */
export function parsePipelineNodes(text: string, filePath: string): PipelineNode[] {
    const root = parseTree(text);
    if (!root || root.type !== "object") return EMPTY_NODES.slice();

    const nodes: PipelineNode[] = [];
    for (const property of root.children ?? []) {
        const keyNode = property.children?.[0];
        const valueNode = property.children?.[1];
        if (!keyNode || typeof keyNode.value !== "string") continue;

        nodes.push({
            name: keyNode.value,
            filePath,
            keyOffset: keyNode.offset,
            endOffset: property.offset + property.length,
            line: lineOf(text, keyNode.offset),
            desc: stringAt(valueNode, ["desc"]),
            focus: stringAt(valueNode, ["focus"]),
            recognition: typeOf(valueNode, "recognition", "custom_recognition"),
            action: typeOf(valueNode, "action", "custom_action"),
        });
    }
    return nodes;
}

const EMPTY_NODES: PipelineNode[] = [];

/** offset 落在第几行（从 1 开始） */
function lineOf(text: string, offset: number): number {
    let line = 1;
    for (let index = 0; index < offset && index < text.length; index += 1) {
        if (text[index] === "\n") line += 1;
    }
    return line;
}

/** 取子字段的字符串值；没有或不是字符串就是 undefined */
function stringAt(node: Node | undefined, path: string[]): string | undefined {
    if (!node) return undefined;
    const target = findNodeAtLocation(node, path);
    return typeof target?.value === "string" ? target.value : undefined;
}

/**
 * 识别/动作的名字：既可能写成字符串（`"recognition": "TemplateMatch"`），
 * 也可能写成对象（`"recognition": {"type": "TemplateMatch", ...}`）；没写就用对应的自定义字段。
 */
function typeOf(node: Node | undefined, key: string, customKey: string): string | undefined {
    if (!node) return undefined;

    const direct = findNodeAtLocation(node, [key]);
    if (typeof direct?.value === "string") return direct.value;
    if (direct && direct.type === "object") {
        const type = findNodeAtLocation(direct, ["type"]);
        if (typeof type?.value === "string") return type.value;
    }

    return stringAt(node, [customKey]);
}

/** 一句话说明：desc 优先，其次 focus，再次识别方式 */
export function describePipelineNode(node: PipelineNode): string | undefined {
    if (node.desc) return node.desc;
    if (node.focus) return node.focus;
    if (node.recognition) return `识别方式：${node.recognition}`;
    return undefined;
}

/** 补全里那一小段：`Reco: TemplateMatch · Act: Click`，都没有就不给 */
export function describeNodeBehavior(node: PipelineNode): string | undefined {
    const parts: string[] = [];
    if (node.recognition) parts.push(`Reco: ${node.recognition}`);
    if (node.action) parts.push(`Act: ${node.action}`);
    return parts.length > 0 ? parts.join(" · ") : undefined;
}
