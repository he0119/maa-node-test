// 把 maa-tools 给出的文件、用例结论转成测试面板标记和中文说明。
// 不重新计算测试结论；所选用例缺少结果时，明确报结果不完整。
// 不 import vscode，便于在普通 Node 环境验证。

/** 单个文件的结论 */
export type FileVerdict = "pass" | "fail" | "error";

/** 单条用例还可以被跳过，表示至少有平台没有完成验证，不能标成用例通过。 */
export type CaseOutcome = FileVerdict | "skipped";

/** 单条用例的结论、原因和识别耗时，均来自 maa-tools 的结构化结果。 */
export interface CaseVerdict {
    verdict: CaseOutcome;
    title: string;
    detail: string[];
    durationMs: number;
}

export interface CaseMark {
    caseIndex?: number;
    verdict: CaseOutcome;
    text: VerdictText;
}

export interface FileMarking {
    file: {verdict: FileVerdict; text: VerdictText};
    cases: CaseMark[];
}

/** 节点上的短标题，以及展开结果后看到的说明。 */
export interface VerdictText {
    title: string;
    detail: string[];
}

/** 逐用例结论的键：相对路径 + 用例下标。 */
export function caseKeyOf(relativePath: string, caseIndex: number): string {
    return `${relativePath.replace(/\\/g, "/")}#${caseIndex}`;
}

/** 上游未给具体原因时使用的说明。 */
export function describeVerdict(verdict: FileVerdict, title: string): VerdictText {
    if (verdict === "fail") {
        return {
            title: "断言失败",
            detail: [`maa-tools 报告 ${title} 失败，但没有提供具体原因。请查看测试输出中的原始日志。`],
        };
    }
    if (verdict === "error") {
        return {
            title: "没有完成验证",
            detail: [`${title} 没有完成验证。请查看测试输出中的错误原因。`],
        };
    }
    return {title: "通过", detail: []};
}

/** 所选用例没有结果时不能补成通过，也不能猜它是否断言失败。 */
export function missingCaseVerdict(relativePath: string, caseIndex?: number, reason?: VerdictText): CaseVerdict {
    return {
        verdict: "error",
        title: reason?.title ?? "缺少用例结果",
        detail: reason?.detail ?? [
            `maa-tools 没有返回 ${relativePath} 第 ${formatIndex(caseIndex)} 个用例的结果，无法确认是否通过。`,
            "请刷新测试面板后重跑，并查看测试输出中的错误原因。",
        ],
        durationMs: 0,
    };
}

/** 文件失败说明：只有一条有问题时直接展示它的原因，多条时逐条列出。 */
export function describeFileFailure(
    relativePath: string,
    verdict: FileVerdict,
    knownCases: readonly {info?: CaseVerdict; caseIndex?: number}[],
): VerdictText {
    const problems = knownCases.filter((entry) => entry.info !== undefined && isProblemOutcome(entry.info.verdict));
    if (problems.length === 0) return describeVerdict(verdict, relativePath);
    if (problems.length === 1) {
        const entry = problems[0];
        return {
            title: `第 ${formatIndex(entry.caseIndex)} 个用例：${entry.info?.title ?? "没有完成验证"}`,
            detail: entry.info?.detail ?? [],
        };
    }
    const detail: string[] = [];
    for (const entry of problems) {
        detail.push(`第 ${formatIndex(entry.caseIndex)} 个用例 · ${entry.info?.title ?? "没有完成验证"}`);
        for (const line of entry.info?.detail ?? []) detail.push(`    ${line}`);
    }
    const allFailed = problems.every((entry) => entry.info?.verdict === "fail");
    return {title: `${problems.length} 条用例${allFailed ? "失败" : "没有通过验证"}`, detail};
}

/** 使用上游结论标记节点；这里只额外检查所选用例是否都有结果。 */
export function planFileMarking(
    relativePath: string,
    verdict: FileVerdict,
    cases: readonly {caseIndex?: number; info?: CaseVerdict}[],
    fileText?: VerdictText,
): FileMarking {
    const missing = cases.filter((entry) => !entry.info);
    const complete = cases.map((entry) => ({
        caseIndex: entry.caseIndex,
        info: entry.info ?? missingCaseVerdict(relativePath, entry.caseIndex, fileText),
    }));
    const fileVerdict = missing.length > 0 ? "error" : verdict;
    let text: VerdictText;
    if (fileText) {
        text = fileText;
    } else if (missing.length > 0) {
        text = {
            title: "结果不完整",
            detail: missing.map((entry) => `第 ${formatIndex(entry.caseIndex)} 个用例没有返回结果，不能确认是否通过。`),
        };
    } else if (fileVerdict === "pass") {
        text = {title: "通过", detail: describeSkippedCases(complete)};
    } else {
        text = describeFileFailure(relativePath, fileVerdict, complete);
    }
    return {
        file: {verdict: fileVerdict, text},
        cases: complete.map((entry) => ({caseIndex: entry.caseIndex, verdict: entry.info.verdict, text: entry.info})),
    };
}

function isProblemOutcome(outcome: CaseOutcome): boolean {
    return outcome === "fail" || outcome === "error";
}

/** 文件通过时仍明确列出跳过的用例，避免把跳过看成通过。 */
function describeSkippedCases(cases: readonly {caseIndex?: number; info: CaseVerdict}[]): string[] {
    const skipped = cases.filter((entry) => entry.info.verdict === "skipped");
    if (skipped.length === 0) return [];
    return [
        `${skipped.length} 条用例未在全部平台完成验证（缺图跳过，补图后重跑即可）`,
        ...skipped.map((entry) => `第 ${formatIndex(entry.caseIndex)} 个用例 · ${entry.info.title}`),
    ];
}

/** 第一行是粗体短标题，明细按 Markdown 列表显示。 */
export function buildMessageMarkdown(title: string, detail: readonly string[]): string {
    if (detail.length === 0) return `**${title}**`;
    return [
        `**${title}**`,
        "",
        ...detail.map((line) => (/^ {2,}/.test(line) ? `  - ${line.trim()}` : `- ${line.trim()}`)),
    ].join("\n");
}

function formatIndex(caseIndex: number | undefined): string {
    return caseIndex === undefined ? "?" : String(caseIndex + 1);
}
