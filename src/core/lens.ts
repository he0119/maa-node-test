import type {TestDocument} from "./document";

export const RUN_FILE_COMMAND = "maaNodeTest.runFile";
export const RUN_CASE_COMMAND = "maaNodeTest.runCase";
export const SHOW_PLAN_COMMAND = "maaNodeTest.showPlan";

/** CodeLens 的描述，vscode 那一层再把它翻译成 Range + 命令参数 */
export interface CodeLensDescriptor {
    /** 零宽 range 落在这个 offset 上，也就是对应行的行首 */
    offset: number;
    title: string;
    command: typeof RUN_FILE_COMMAND | typeof RUN_CASE_COMMAND;
    /** 只有跑单个用例时才有 */
    caseIndex?: number;
}

/**
 * 一个测试文件应该出现的 CodeLens：顶部一个跑整文件，每个用例一个。
 * JSON 解析出错时返回空数组——坏文件不值得给按钮。
 */
export function buildCodeLensDescriptors(document: TestDocument): CodeLensDescriptor[] {
    if (document.problems.length > 0) return [];

    const count = document.cases.length;
    const groupName = document.configs.name;
    const fileTitle = `$(play) 运行整个文件（${count} 个用例）${groupName ? `：${groupName}` : ""}`;

    const descriptors: CodeLensDescriptor[] = [
        {offset: 0, title: fileTitle, command: RUN_FILE_COMMAND},
    ];

    for (const entry of document.cases) {
        const caseTitle = `$(play) 运行此用例${entry.name ? `：${entry.name}` : ""}`;
        descriptors.push({
            offset: entry.offset,
            title: caseTitle,
            command: RUN_CASE_COMMAND,
            caseIndex: entry.index,
        });
    }

    return descriptors;
}
