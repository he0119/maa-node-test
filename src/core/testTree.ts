/**
 * 把 maa-tools test --list --json 的收集结果转成面板树描述：每个文件一个节点，每条用例一个子节点。
 * 收集和运行使用同一份配置；这里只显示收集结果，不解析测试文件。
 * 不 import vscode，实际 TestItem 由 src/testController.ts 创建。
 */

import {pathKey, toPosix} from "./paths";

/** 收集结果里的一条用例（面板要用的字段） */
export interface CollectedCase {
    index: number;
    name: string | null;
    image: string;
    hits: string[];
    /** 用例对象在文件里的字符范围：从0计数，end不包含在范围内。 */
    start: number;
    end: number;
}

/** 收集结果里的一个测试文件 */
export interface CollectedFile {
    /** 适配层归一后的显示路径：仓库内为相对路径，仓库外为绝对路径。 */
    file: string;
    /** 组名（configs.name）；没有或读取失败的条目可省略 */
    name?: string | null;
    controllers: string[];
    resources: string[];
    cases: CollectedCase[];
    /** 文件读不了 / 不符合结构时的原因（此时 cases 为空） */
    error?: string;
}

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
    /** 收集失败的原因；用于文件节点的错误提示和运行时的独立报错。 */
    error?: string;
}

/** 文件级节点 id：绝对路径 + `#file` */
export function fileNodeId(filePath: string): string {
    return `${pathKey(filePath)}${FILE_NODE_SUFFIX}`;
}

/** 用例节点 id：绝对路径 + `#case-<下标>` */
export function caseNodeId(filePath: string, caseIndex: number): string {
    return `${pathKey(filePath)}${CASE_NODE_SUFFIX}${caseIndex}`;
}

/**
 * 用例在测试面板里显示的名字：优先用 name，没有就用去掉扩展名的图片名，
 * 都没有（缺 image）就退化成「第 N 个用例」。
 */
export function describeCaseLabel(entry: CollectedCase): string {
    if (entry.name) return entry.name;
    if (entry.image) return stripExtension(entry.image);
    return `第 ${entry.index + 1} 个用例`;
}

/**
 * 用例右侧的灰字：图片名 + 预期命中节点数。
 * 标题已经是图片名（没写 name）时不再重复一遍 —— 同一行写两遍同样的字，只是把行撑长。
 */
export function describeCaseDescription(entry: CollectedCase): string {
    const parts: string[] = [];
    if (!entry.image) parts.push("没写 image");
    else if (entry.name) parts.push(entry.image);
    parts.push(entry.hits.length === 0 ? "负例（不该命中）" : `命中 ${entry.hits.length} 个节点`);
    return parts.join(" · ");
}

/**
 * 文件右侧的灰字：测试组名 + 平台/资源矩阵。
 * 这几项正好是「跑这个文件会展开成哪几组」的关键，省得用户回去翻 configs；
 * 用例数不写：展开就能看见，而且和目录行一样属于数数，凑长了只会被截断。
 */
export function describeFileDescription(entry: CollectedFile): string {
    const parts: string[] = [];
    parts.push(entry.name ?? `未命名测试组（${entry.file}）`);
    const {controllers, resources} = entry;
    if (controllers.length > 0 || resources.length > 0) {
        parts.push(
            `${controllers.length > 0 ? controllers.join("/") : "未写 controller"} × ${resources.length > 0 ? resources.join("/") : "未写 resource"}`,
        );
    }
    return parts.join(" · ");
}

/**
 * 建一棵文件节点描述。标题只用文件名 —— 目录层级由测试面板的目录节点负责，
 * 文件名再带一遍完整路径就跟目录重复了。
 */
export function buildFileNode(entry: CollectedFile, filePath: string): FileNodeDescriptor {
    const cases: CaseNodeDescriptor[] = entry.cases.map((item) => ({
        id: caseNodeId(filePath, item.index),
        label: describeCaseLabel(item),
        description: describeCaseDescription(item),
        start: item.start,
        end: item.end,
        caseIndex: item.index,
    }));

    return {
        id: fileNodeId(filePath),
        label: fileNameOf(entry.file),
        description: entry.error ? `读取失败：${entry.error}` : describeFileDescription(entry),
        error: entry.error,
        // 文件级节点指向文件开头
        start: 0,
        end: 0,
        cases,
    };
}

/** 相对路径统一用正斜杠显示，Windows 上也不会出现反斜杠 */
export {toPosix};

/** 相对路径里的文件名部分 */
export function fileNameOf(relativePath: string): string {
    const segments = toPosix(relativePath)
        .split("/")
        .filter((segment) => segment.length > 0);
    return segments[segments.length - 1] ?? relativePath;
}

/**
 * 按显示路径的目录层级分组，省略开头的 tests 目录。
 * 例如 tests/Common/Button/test_close_button.json 对应 Common、Button 两层。
 */
export function folderSegments(relativePath: string): string[] {
    const segments = toPosix(relativePath)
        .split("/")
        .filter((segment) => segment.length > 0);
    segments.pop();
    if (pathKey(segments[0] ?? "") === pathKey("tests")) segments.shift();
    return segments;
}

/** 运行选择只需要节点关系，不依赖 VS Code。 */
interface TestTreeItem<Item> {
    id: string;
    parent?: Item;
    children: Iterable<readonly [string, Item]>;
}

/** 完整文件保留为批量目标；有用例被排除时，只返回剩余用例。 */
export function collectRunTargets<Item extends TestTreeItem<Item>, Leaf extends {filePath: string; caseIndex?: number}>(
    request: {include?: readonly Item[]; exclude?: readonly Item[]},
    rootItems: readonly Item[],
    leaves: ReadonlyMap<string, Leaf>,
): (Leaf & {item: Item})[] {
    const excludedIds = new Set((request.exclude ?? []).map((item) => item.id));
    const isExcluded = (item: Item): boolean => {
        for (let current: Item | undefined = item; current; current = current.parent) {
            if (excludedIds.has(current.id)) return true;
        }
        return false;
    };
    const included = request.include?.length ? request.include : rootItems;
    const fileTargets = new Map<string, Leaf & {item: Item}>();
    const caseTargets = new Map<string, Leaf & {item: Item}>();
    const visit = (item: Item): void => {
        if (isExcluded(item)) return;
        const leaf = leaves.get(item.id);
        if (leaf?.caseIndex !== undefined) {
            caseTargets.set(item.id, {...leaf, item});
            return;
        }
        const children = [...item.children].map(
            ([
                ,
                child,
            ]) => child,
        );
        if (leaf && !children.some(isExcluded)) {
            fileTargets.set(pathKey(leaf.filePath), {...leaf, item});
            return;
        }
        for (const child of children) visit(child);
    };
    for (const item of included) visit(item);
    return [
        ...fileTargets.values(),
        ...[...caseTargets.values()].filter((target) => !fileTargets.has(pathKey(target.filePath))),
    ];
}

function stripExtension(fileName: string): string {
    const dot = fileName.lastIndexOf(".");
    return dot > 0 ? fileName.slice(0, dot) : fileName;
}
