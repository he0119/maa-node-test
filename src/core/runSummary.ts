// 把一次测试运行压成「结果块」：结论一行、计数两三行、然后只列有问题的地方。
//
// 为什么单独一个纯模块：测试输出里真正要看的是「哪条没通过」，但 runner 的原始日志会先刷几十行
// MaaFW 准备、资源加载、worker 池的内容。原始日志不能删（排错全靠它），所以做法是在末尾补一块
// 结构化的结果 —— 通过的文件只计入数字，不逐条刷屏；失败、没跑起来、缺图跳过的逐条各占一行。
//
// 不 import vscode：拼的是纯字符串，能在 node 里直接单测。

import type {CaseOutcome, FileVerdict} from "./testResult";

/** 一条有问题的用例（失败 / 没跑起来 / 缺图跳过）；通过的不进这里 */
export interface SummaryCase {
    caseIndex?: number;
    verdict: CaseOutcome;
    /** 面板节点上那一行短标题，例如「ADB-官服 失败」「CloudADB-官服 没验证到」 */
    title: string;
}

/** 一个文件的结论 + 它下面有问题的用例 */
export interface SummaryFile {
    relativePath: string;
    verdict: FileVerdict;
    /** 文件下的用例总数（从面板节点数出来的，runner 只报有问题的那些） */
    caseCount: number;
    cases: readonly SummaryCase[];
}

export interface SummaryInput {
    files: readonly SummaryFile[];
    durationMs: number;
    cancelled?: boolean;
}

const BLOCK_TITLE = "━━━━ 结果 ━━━━";

/**
 * 拼结果块。返回的是若干行，调用方按 `\r\n` 拼进测试输出。
 *
 * 形状（通过时只有三行）：
 *
 *     结论：通过
 *     文件 2 个：通过 2
 *     用例 12 条：通过 12
 *     耗时 18.4 秒
 *
 * 有问题时在下面按「失败 → 没跑起来 → 缺图跳过」的顺序追加，每条一行，通过的不列。
 */
export function buildRunSummary(input: SummaryInput): string[] {
    const {files, durationMs, cancelled} = input;

    const lines = [BLOCK_TITLE];

    if (cancelled) {
        // 取消时没跑完，计数会让人误以为「就跑了这么点」，只报状态和耗时
        lines.push("结论：已取消（运行被中断，结果不完整）", `耗时 ${formatDuration(durationMs)}`, BLOCK_TITLE);
        return lines;
    }

    const passedFiles = files.filter((file) => file.verdict === "pass");
    const failedFiles = files.filter((file) => file.verdict === "fail");
    const errorFiles = files.filter((file) => file.verdict === "error");

    const failedCases = collectCases(files, "fail");
    const errorCases = collectCases(files, "error");
    const skippedCases = collectCases(files, "skipped");

    const totalCases = files.reduce((sum, file) => sum + file.caseCount, 0);
    const badCaseCount = failedCases.length + errorCases.length + skippedCases.length;
    const passedCases = Math.max(0, totalCases - badCaseCount);

    lines.push(summarizeVerdict({failedFiles, errorFiles, skippedCases, passedCases}));

    lines.push(formatFileCounts(passedFiles.length, failedFiles.length, errorFiles.length));
    lines.push(formatCaseCounts(passedCases, failedCases.length, errorCases.length, skippedCases.length));
    lines.push(`耗时 ${formatDuration(durationMs)}`);

    // 失败要能一眼看出是哪条用例：文件级失败但没拿到逐用例原因时，也要点名是哪个文件
    if (failedCases.length > 0) {
        lines.push("", `失败（${failedCases.length} 条）：`);
        for (const entry of failedCases) lines.push(describeCase(entry));
    } else if (failedFiles.length > 0) {
        lines.push("", `失败（${failedFiles.length} 个文件，没拿到逐用例原因）：`);
        for (const file of failedFiles) lines.push(`  ${file.relativePath} · 展开这个节点看原因`);
    }

    if (errorFiles.length > 0 || errorCases.length > 0) {
        const count = errorFiles.length > 0 ? `${errorFiles.length} 个文件` : `${errorCases.length} 条用例`;
        lines.push("", `没跑起来（${count}）：`);
        if (errorCases.length > 0) {
            for (const entry of errorCases) lines.push(describeCase(entry));
        } else {
            for (const file of errorFiles) lines.push(`  ${file.relativePath} · 原因见上面的原始日志`);
        }
    }

    if (skippedCases.length > 0) {
        lines.push("", `缺图跳过（${skippedCases.length} 条，不算失败）：`);
        for (const entry of skippedCases) lines.push(describeCase(entry));
    }

    lines.push(BLOCK_TITLE);
    return lines;
}

/** 结论那一行：先给通过/没通过，再补一句最要紧的原因 */
function summarizeVerdict(input: {
    failedFiles: readonly SummaryFile[];
    errorFiles: readonly SummaryFile[];
    skippedCases: readonly {file: string; title: string}[] | readonly SummaryCase[];
    passedCases: number;
}): string {
    const {failedFiles, errorFiles, skippedCases, passedCases} = input;

    const reasons: string[] = [];
    if (failedFiles.length > 0) reasons.push(`${failedFiles.length} 个文件失败`);
    if (errorFiles.length > 0) reasons.push(`${errorFiles.length} 个文件没跑起来`);

    if (reasons.length === 0) {
        if (skippedCases.length === 0) return "结论：通过";
        // 一条都没真正跑过（例如单跑一条缺图用例）：说「通过」等于骗人
        if (passedCases === 0) return `结论：没有验证到（${skippedCases.length} 条用例缺图跳过，不算失败）`;
        return `结论：通过（其中 ${skippedCases.length} 条用例缺图跳过，没有真正验证到）`;
    }

    const tail = skippedCases.length > 0 ? `；另有 ${skippedCases.length} 条缺图跳过` : "";
    return `结论：没通过 —— ${reasons.join("、")}${tail}`;
}

/** `文件 3 个：通过 2 · 失败 1`，为 0 的项不写，全为 0 时写「没有文件」 */
function formatFileCounts(passed: number, failed: number, error: number): string {
    const total = passed + failed + error;
    if (total === 0) return "文件 0 个";
    const parts = [`通过 ${passed}`];
    if (failed > 0) parts.push(`失败 ${failed}`);
    if (error > 0) parts.push(`没跑起来 ${error}`);
    return `文件 ${total} 个：${parts.join(" · ")}`;
}

/** `用例 12 条：通过 10 · 失败 1 · 缺图跳过 1` */
function formatCaseCounts(passed: number, failed: number, error: number, skipped: number): string {
    const total = passed + failed + error + skipped;
    if (total === 0) return "用例 0 条";
    const parts = [`通过 ${passed}`];
    if (failed > 0) parts.push(`失败 ${failed}`);
    if (error > 0) parts.push(`没跑起来 ${error}`);
    if (skipped > 0) parts.push(`缺图跳过 ${skipped}`);
    return `用例 ${total} 条：${parts.join(" · ")}`;
}

function collectCases(
    files: readonly SummaryFile[],
    verdict: CaseOutcome,
): {file: string; caseIndex: number | undefined; verdict: CaseOutcome; title: string}[] {
    const collected: {file: string; caseIndex: number | undefined; verdict: CaseOutcome; title: string}[] = [];
    for (const file of files) {
        for (const entry of file.cases) {
            if (entry.verdict !== verdict) continue;
            collected.push({
                file: file.relativePath,
                caseIndex: entry.caseIndex,
                verdict: entry.verdict,
                title: entry.title,
            });
        }
    }
    return collected;
}

/** `  tests/A/test_a.json · 第 2 条 ADB-官服 失败` */
function describeCase(entry: {file: string; caseIndex?: number; title: string}): string {
    const index = entry.caseIndex === undefined ? "" : `第 ${entry.caseIndex + 1} 条 `;
    return `  ${entry.file} · ${index}${entry.title}`;
}

/** 毫秒变人话：不足 1 秒留一位小数，超过 1 分钟拆成分秒 */
export function formatDuration(durationMs: number): string {
    const safe = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
    if (safe < 1000) return `${(safe / 1000).toFixed(1)} 秒`;
    if (safe < 60_000) return `${Math.round(safe / 1000)} 秒`;
    const minutes = Math.floor(safe / 60_000);
    const seconds = Math.round((safe % 60_000) / 1000);
    return seconds === 0 ? `${minutes} 分` : `${minutes} 分 ${seconds} 秒`;
}
