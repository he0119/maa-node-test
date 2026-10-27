import {findNodeAtLocation, parseTree, printParseErrorCode} from "jsonc-parser";
import type {Node, ParseError} from "jsonc-parser";

/**
 * 测试文件里 configs 段的内容。resource / controller 既可以写字符串，也可以写字符串数组，
 * 这里统一展开成数组，调用方不用再自己判断类型。
 */
export interface TestConfigs {
    name?: string;
    resource: string[];
    controller: string[];
}

/** image 字段在文件里的位置。Hover 要靠它把范围限定在值上，否则整块都会闪。 */
export interface ImageField {
    /** 字符串值本身，例如 `帝江号_大世界.png` */
    value: string;
    /** 值的起点 offset（含左侧引号） */
    valueOffset: number;
    valueLength: number;
    /** 键 `"image"` 的起点 offset（含引号） */
    keyOffset: number;
    keyLength: number;
}

/** 一条 cases 元素。offset 落在对象开头的 `{` 上，拿来放 CodeLens。 */
export interface TestCase {
    /** 在 cases 数组里的下标，从 0 开始，就是传给 runner 的 `--case` */
    index: number;
    name?: string;
    offset: number;
    /** 用例对象的结束 offset（不含），给测试面板画高亮范围用 */
    endOffset: number;
    image?: ImageField;
    /** hits 数组的条目数，读不到算 0 */
    hitCount: number;
}

export interface ParseProblem {
    message: string;
    offset: number;
    length: number;
}

export interface TestDocument {
    configs: TestConfigs;
    cases: TestCase[];
    /** 空数组表示 JSON 没毛病 */
    problems: ParseProblem[];
}

/** 仓库里的测试文件允许写注释和尾逗号，这两项都放开 */
const PARSE_OPTIONS = {allowTrailingComma: true, disallowComments: false};

/** 测试文件名规则：`test_xxx.json`，也允许 jsonc */
const TEST_FILE_NAME = /^test_.*\.jsonc?$/;

/**
 * 解析测试文件。坏掉的 JSON 不抛异常，而是把错误塞进 problems，
 * 让上层决定是「别跑」还是「照样画 CodeLens」。
 */
export function parseTestDocument(text: string): TestDocument {
    const errors: ParseError[] = [];
    const root = parseTree(text, errors, PARSE_OPTIONS);

    const problems: ParseProblem[] = errors.map((error) => ({
        message: printParseErrorCode(error.error),
        offset: error.offset,
        length: error.length,
    }));

    const configs: TestConfigs = {resource: [], controller: []};
    const cases: TestCase[] = [];

    if (!root) {
        return {configs, cases, problems};
    }

    const configsNode = findNodeAtLocation(root, ["configs"]);
    if (configsNode) {
        const nameNode = findNodeAtLocation(configsNode, ["name"]);
        if (typeof nameNode?.value === "string") {
            configs.name = nameNode.value;
        }
        configs.resource = toStringList(findNodeAtLocation(configsNode, ["resource"]));
        configs.controller = toStringList(findNodeAtLocation(configsNode, ["controller"]));
    }

    const casesNode = findNodeAtLocation(root, ["cases"]);
    if (casesNode?.type === "array") {
        const caseNodes = casesNode.children ?? [];
        caseNodes.forEach((caseNode, index) => {
            if (caseNode.type !== "object") return;
            const entry: TestCase = {
                index,
                offset: caseNode.offset,
                endOffset: caseNode.offset + caseNode.length,
                hitCount: 0,
            };

            const nameNode = findNodeAtLocation(caseNode, ["name"]);
            if (typeof nameNode?.value === "string") {
                entry.name = nameNode.value;
            }

            const imageProperty = findPropertyNode(caseNode, "image");
            const keyNode = imageProperty?.children?.[0];
            const valueNode = imageProperty?.children?.[1];
            if (keyNode && valueNode?.type === "string" && typeof valueNode.value === "string") {
                entry.image = {
                    value: valueNode.value,
                    valueOffset: valueNode.offset,
                    valueLength: valueNode.length,
                    keyOffset: keyNode.offset,
                    keyLength: keyNode.length,
                };
            }

            const hitsNode = findNodeAtLocation(caseNode, ["hits"]);
            if (hitsNode?.type === "array") {
                entry.hitCount = hitsNode.children?.length ?? 0;
            }

            cases.push(entry);
        });
    }

    return {configs, cases, problems};
}

/**
 * 找出 offset 落在哪个用例的 image 字段上。键 `"image"` 和它的字符串值都算命中。
 * 找不到返回 undefined，Hover 直接不弹。
 */
export function findImageFieldAt(document: TestDocument, offset: number): ImageField | undefined {
    for (const entry of document.cases) {
        const image = entry.image;
        if (!image) continue;
        if (inside(offset, image.keyOffset, image.keyLength)) return image;
        if (inside(offset, image.valueOffset, image.valueLength)) return image;
    }
    return undefined;
}

/**
 * 判断一个相对工作区根的路径是不是测试文件：目录里要有 `tests` 这一段，
 * 文件名要匹配 `test_*.json`（或 jsonc）。命令侧用它拦住随便什么文件。
 */
export function isTestFilePath(relativePath: string): boolean {
    const segments = relativePath
        .replace(/\\/g, "/")
        .split("/")
        .filter((segment) => segment.length > 0);
    if (segments.length < 2) return false;
    const fileName = segments[segments.length - 1];
    if (!TEST_FILE_NAME.test(fileName)) return false;
    return segments.slice(0, -1).includes("tests");
}

function inside(offset: number, start: number, length: number): boolean {
    return offset >= start && offset <= start + length;
}

function findPropertyNode(objectNode: Node | undefined, key: string): Node | undefined {
    for (const property of objectNode?.children ?? []) {
        if (property.type !== "property") continue;
        const keyNode = property.children?.[0];
        if (keyNode?.value === key) return property;
    }
    return undefined;
}

function toStringList(node: Node | undefined): string[] {
    if (!node) return [];
    if (node.type === "string") {
        return typeof node.value === "string" ? [node.value] : [];
    }
    if (node.type !== "array") return [];
    const result: string[] = [];
    for (const child of node.children ?? []) {
        if (typeof child.value === "string") result.push(child.value);
    }
    return result;
}
