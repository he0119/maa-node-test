import type {TestCase, TestDocument} from "./document";

/**
 * 把解析好的测试文件翻译成 VS Code 测试面板里的树：
 * 文件一个根节点，每个用例一个子节点。
 *
 * 这一层不 import vscode，纯函数，方便单测；真正的 TestItem 由 src/testing.ts 照着描述建。
 */

/** 文件级节点的 id 后缀。id 用「绝对路径 + 固定后缀」，同一个文件刷新后 id 不变 */
export const FILE_NODE_SUFFIX = "#file";

/** 用例节点 id 后缀，后面接用例下标 */
export const CASE_NODE_SUFFIX = "#case-";

export interface CaseNodeDescriptor {
    /** 稳定 id：`<绝对路径>#case-<下标>` */
    id: string;
    label: string;
    description: string;
    /** 用例对象在文件里的字符区间，测试面板点一下就跳到这里 */
    start: number;
    end: number;
    caseIndex: number;
}

export interface FileNodeDescriptor {
    id: string;
    label: string;
    description: string;
    /** 文件级节点指到文件开头即可 */
    start: number;
    end: number;
    cases: CaseNodeDescriptor[];
}

/** 文件级节点 id：绝对路径 + `#file` */
export function fileNodeId(filePath: string): string {
    return `${filePath}${FILE_NODE_SUFFIX}`;
}

/** 用例节点 id：绝对路径 + `#case-<下标>` */
export function caseNodeId(filePath: string, caseIndex: number): string {
    return `${filePath}${CASE_NODE_SUFFIX}${caseIndex}`;
}

/**
 * 用例在测试面板里显示的名字：优先用 name，没有就用去掉扩展名的图片名，
 * 都没有（缺 image）就退化成「第 N 个用例」。
 */
export function describeCaseLabel(entry: TestCase): string {
    if (entry.name) return entry.name;
    const image = entry.image?.value;
    if (image) return stripExtension(image);
    return `第 ${entry.index + 1} 个用例`;
}

/**
 * 用例右侧的灰字：图片名 + 预期命中节点数。
 * 有无 name 都带上图片名，因为「跑这张图」才是用户真正关心的。
 */
export function describeCaseDescription(entry: TestCase): string {
    const parts: string[] = [];
    if (entry.image?.value) parts.push(entry.image.value);
    else parts.push("没写 image");
    parts.push(entry.hitCount === 0 ? "负例（不期望命中）" : `预期命中 ${entry.hitCount} 个节点`);
    return parts.join(" · ");
}

/**
 * 文件右侧的灰字：测试组名 + 平台/资源矩阵 + 用例数。
 * 这几个信息正好是「跑这个文件会展开成哪几组」的关键，省得用户回去翻 configs。
 */
export function describeFileDescription(document: TestDocument, relativePath: string): string {
    const parts: string[] = [];
    const name = document.configs.name;
    parts.push(name ?? `未命名测试组（${relativePath}）`);
    const controllers = document.configs.controller;
    const resources = document.configs.resource;
    if (controllers.length > 0 || resources.length > 0) {
        parts.push(
            `${controllers.length > 0 ? controllers.join("/") : "未写 controller"} × ${resources.length > 0 ? resources.join("/") : "未写 resource"}`,
        );
    }
    parts.push(`${document.cases.length} 个用例`);
    return parts.join(" · ");
}

/**
 * 建一棵文件节点描述。标题只用文件名 —— 目录层级由测试面板的目录节点负责，
 * 文件名再带一遍完整路径就跟目录重复了。
 */
export function buildFileNode(document: TestDocument, filePath: string, relativePath: string): FileNodeDescriptor {
    const cases: CaseNodeDescriptor[] = document.cases.map((entry) => ({
        id: caseNodeId(filePath, entry.index),
        label: describeCaseLabel(entry),
        description: describeCaseDescription(entry),
        start: entry.offset,
        end: entry.endOffset,
        caseIndex: entry.index,
    }));

    return {
        id: fileNodeId(filePath),
        label: fileNameOf(relativePath),
        description: describeFileDescription(document, relativePath),
        // 文件级节点不指向具体内容，落在文件开头，点一下就是文件第一行
        start: 0,
        end: 0,
        cases,
    };
}

/** 相对路径统一用正斜杠显示，Windows 上也不会出现反斜杠 */
export function toPosix(target: string): string {
    return target.replace(/\\/g, "/");
}

/** 相对路径里的文件名部分 */
export function fileNameOf(relativePath: string): string {
    const segments = toPosix(relativePath)
        .split("/")
        .filter((segment) => segment.length > 0);
    return segments[segments.length - 1] ?? relativePath;
}

/**
 * 把相对路径拆成「目录层级」，给测试面板分组用：去掉文件名，再去掉开头的 `tests` 段
 * （所有测试都在 tests 下，留着这一层每一级都跟着一个没信息量的 tests）。
 *
 * 例：`tests/Common/Button/test_close_button.json` → `["Common", "Button"]`
 */
export function folderSegments(relativePath: string): string[] {
    const segments = toPosix(relativePath)
        .split("/")
        .filter((segment) => segment.length > 0);
    segments.pop();
    if (segments[0] === "tests") segments.shift();
    return segments;
}

function stripExtension(fileName: string): string {
    const dot = fileName.lastIndexOf(".");
    return dot > 0 ? fileName.slice(0, dot) : fileName;
}
