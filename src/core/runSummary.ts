// 测试输出末尾的结果摘要：显示上游结论，按明确返回的用例结果计数。
// 原始日志保留在前面供排错，通过的用例只计数，不逐条列出。

import type {CaseOutcome, FileVerdict} from "./testResult";

/** 一条所选用例的结果，包括明确返回的通过结果。 */
export interface SummaryCase {
    caseIndex?: number;
    verdict: CaseOutcome;
    title: string;
}

export interface SummaryFile {
    relativePath: string;
    verdict: FileVerdict;
    /** 本次选择的用例总数；不能用它减去问题数来推算通过数。 */
    caseCount: number;
    cases: readonly SummaryCase[];
    reason?: string;
}

export interface SummaryInput {
    files: readonly SummaryFile[];
    durationMs: number;
    cancelled?: boolean;
    /** 整批运行错误；逐文件、逐用例的有效结果仍各自保留。 */
    error?: string;
}

const BLOCK_TITLE = "━━━━ 结果 ━━━━";

/** 返回摘要各行，由调用方转成测试输出要求的换行符。 */
export function buildRunSummary(input: SummaryInput): string[] {
    const {files, durationMs, cancelled, error} = input;
    const lines = [BLOCK_TITLE];
    if (cancelled) {
        lines.push("结论：已取消（运行被中断，结果不完整）", `耗时 ${formatDuration(durationMs)}`, BLOCK_TITLE);
        return lines;
    }

    const passedFiles = files.filter((file) => file.verdict === "pass");
    const failedFiles = files.filter((file) => file.verdict === "fail");
    const errorFiles = files.filter((file) => file.verdict === "error");
    const skippedFiles = files.filter((file) => file.verdict === "skipped");
    const passedCases = collectCases(files, "pass");
    const failedCases = collectCases(files, "fail");
    const errorCases = collectCases(files, "error");
    const skippedCases = collectCases(files, "skipped");
    const missingResults = files
        .map((file) => ({file, count: Math.max(0, file.caseCount - file.cases.length)}))
        .filter((entry) => entry.count > 0);
    const unknownCases = missingResults.reduce((sum, entry) => sum + entry.count, 0);

    lines.push(
        summarizeVerdict({passedFiles, failedFiles, errorFiles, skippedFiles, skippedCases, unknownCases, error}),
    );
    lines.push(formatFileCounts(passedFiles.length, failedFiles.length, errorFiles.length, skippedFiles.length));
    lines.push(
        formatCaseCounts(passedCases.length, failedCases.length, errorCases.length, skippedCases.length, unknownCases),
    );
    lines.push(`耗时 ${formatDuration(durationMs)}`);
    if (error) lines.push("", "运行错误：", `  ${error}`);

    const failuresWithoutCases = failedFiles.filter((file) => !file.cases.some((entry) => entry.verdict === "fail"));
    if (failedCases.length > 0) {
        lines.push("", `失败（${failedCases.length} 条）：`);
        for (const entry of failedCases) lines.push(describeCase(entry));
    }
    if (failuresWithoutCases.length > 0) {
        lines.push("", `失败（${failuresWithoutCases.length} 个文件，没拿到逐用例原因）：`);
        for (const file of failuresWithoutCases)
            lines.push(`  ${file.relativePath} · ${file.reason ?? "展开这个节点看原因"}`);
    }

    if (errorFiles.length > 0 || errorCases.length > 0) {
        const count = errorFiles.length > 0 ? `${errorFiles.length} 个文件` : `${errorCases.length} 条用例`;
        lines.push("", `没有完成验证（${count}）：`);
        for (const entry of errorCases) lines.push(describeCase(entry));
        for (const file of errorFiles) {
            if (file.cases.some((entry) => entry.verdict === "error")) continue;
            lines.push(`  ${file.relativePath} · ${file.reason ?? "原因见上面的原始日志"}`);
        }
    }
    if (unknownCases > 0) {
        lines.push("", `未返回结果（${unknownCases} 条）：`);
        for (const {file, count} of missingResults)
            lines.push(`  ${file.relativePath} · ${count} 条所选用例没有结果，不能确认是否通过`);
    }
    if (skippedFiles.length > 0) {
        lines.push("", `筛选跳过（${skippedFiles.length} 个文件）：`);
        for (const file of skippedFiles) lines.push(`  ${file.relativePath} · ${file.reason ?? "本次筛选未选择用例"}`);
    }
    if (skippedCases.length > 0) {
        lines.push("", `缺图跳过（${skippedCases.length} 条，不算失败）：`);
        for (const entry of skippedCases) lines.push(describeCase(entry));
    }
    lines.push(BLOCK_TITLE);
    return lines;
}

function summarizeVerdict(input: {
    passedFiles: readonly SummaryFile[];
    failedFiles: readonly SummaryFile[];
    errorFiles: readonly SummaryFile[];
    skippedFiles: readonly SummaryFile[];
    skippedCases: readonly SummaryCase[];
    unknownCases: number;
    error?: string;
}): string {
    const {passedFiles, failedFiles, errorFiles, skippedFiles, skippedCases, unknownCases, error} = input;
    const reasons: string[] = [];
    if (failedFiles.length > 0) reasons.push(`${failedFiles.length} 个文件失败`);
    if (errorFiles.length > 0) reasons.push(`${errorFiles.length} 个文件没有完成验证`);
    if (unknownCases > 0) reasons.push(`${unknownCases} 条用例未返回结果`);
    if (error && reasons.length === 0) reasons.push("运行报告错误");
    if (reasons.length > 0) {
        const tail = skippedCases.length > 0 ? `；另有 ${skippedCases.length} 条缺图跳过` : "";
        return `结论：没通过 —— ${reasons.join("、")}${tail}`;
    }
    // 一条聚合用例 skipped 可能表示部分平台缺图，是否已有效验证由上游文件结论决定。
    if (passedFiles.length === 0)
        return skippedFiles.length > 0 ? "结论：本次筛选未选择可运行用例" : "结论：没有验证到任何用例";
    return skippedCases.length > 0
        ? `结论：通过（其中 ${skippedCases.length} 条用例未在全部平台完成验证）`
        : "结论：通过";
}

function formatFileCounts(passed: number, failed: number, error: number, skipped: number): string {
    const total = passed + failed + error + skipped;
    if (total === 0) return "文件 0 个";
    const parts = [`通过 ${passed}`];
    if (failed > 0) parts.push(`失败 ${failed}`);
    if (error > 0) parts.push(`没有完成验证 ${error}`);
    if (skipped > 0) parts.push(`筛选跳过 ${skipped}`);
    return `文件 ${total} 个：${parts.join(" · ")}`;
}

function formatCaseCounts(passed: number, failed: number, error: number, skipped: number, unknown: number): string {
    const total = passed + failed + error + skipped + unknown;
    if (total === 0) return "用例 0 条";
    const parts = [`通过 ${passed}`];
    if (failed > 0) parts.push(`失败 ${failed}`);
    if (error > 0) parts.push(`没有完成验证 ${error}`);
    if (skipped > 0) parts.push(`缺图跳过 ${skipped}`);
    if (unknown > 0) parts.push(`未返回结果 ${unknown}`);
    return `用例 ${total} 条：${parts.join(" · ")}`;
}

function collectCases(files: readonly SummaryFile[], verdict: CaseOutcome): (SummaryCase & {file: string})[] {
    return files.flatMap((file) =>
        file.cases.filter((entry) => entry.verdict === verdict).map((entry) => ({...entry, file: file.relativePath})),
    );
}

function describeCase(entry: {file: string; caseIndex?: number; title: string}): string {
    const index = entry.caseIndex === undefined ? "" : `第 ${entry.caseIndex + 1} 条 `;
    return `  ${entry.file} · ${index}${entry.title}`;
}

/** 毫秒变人话：不足 1 秒留一位小数，超过 1 分钟拆成分秒。 */
export function formatDuration(durationMs: number): string {
    const safe = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
    if (safe < 1000) return `${(safe / 1000).toFixed(1)} 秒`;
    if (safe < 60_000) return `${Math.round(safe / 1000)} 秒`;
    const minutes = Math.floor(safe / 60_000);
    const seconds = Math.round((safe % 60_000) / 1000);
    return seconds === 0 ? `${minutes} 分` : `${minutes} 分 ${seconds} 秒`;
}
