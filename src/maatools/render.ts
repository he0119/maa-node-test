// 运行结果的中文日志；只排版上游事实，不决定测试结论。

import {pathKey} from "./paths";
import {caseKeyOf} from "../core/testResult";

import {formatCaseFailure, summarizePlatforms, type CaseInfo, type FileEntry} from "./results";

export function renderCoverage(entries: readonly FileEntry[]): string[] {
    const summary = summarizePlatforms(entries);
    const lines: string[] = [];
    if (summary.platforms.length > 0) {
        lines.push("", "平台覆盖：");
        for (const item of summary.platforms) {
            const state = item.missing === 0 ? "全部存在" : `缺 ${item.missing} 张（这些平台用例被跳过，没有验证）`;
            lines.push(`  ${item.file} · ${item.label}：${item.images} 张截图，${state}`);
        }
    }
    if (summary.unmatched.length > 0) {
        lines.push("", "文件声明但本次没有返回结果的平台（loader 可主动不展开这些平台）：");
        for (const item of summary.unmatched) {
            lines.push(`  ${item.controller}（${item.file}）`);
        }
    }
    return lines;
}

export function renderMissingWarnings(missing: readonly {path: string}[]): string[] {
    if (missing.length === 0) return [];
    return [
        `警告：${missing.length} 张截图不存在，对应平台的用例被 maa-tools 跳过，未得到验证：`,
        ...missing.map((item) => `  缺失：${item.path}`),
    ];
}

/** 路径来自 maa-tools 的 imagePath，不把工作区误当成截图目录。 */
export function renderAllMissingNote(missing: readonly {path: string}[]): string[] {
    return [
        "本次所有平台都因缺图跳过，没有验证到任何用例。maa-tools 实际尝试读取的截图路径：",
        ...missing.map((item) => `  ${item.path}`),
        "请检查配置中的 casesCwd、imageRoot 和 image。",
    ];
}

export function renderFileResults(entries: readonly FileEntry[], fileResults: ReadonlyMap<string, string>): string[] {
    const mark = (verdict: string) =>
        verdict === "pass" ? "✓" : verdict === "fail" ? "✗" : verdict === "skipped" ? "↷" : "！";
    return [
        "",
        "按文件结果：",
        ...entries.map((entry) => {
            const reason = entry.reason ?? entry.error;
            return `  ${mark(fileResults.get(pathKey(entry.key)) ?? "error")} ${entry.key}${reason ? `：${reason}` : ""}`;
        }),
    ];
}

export function renderCaseSummaries(
    entries: readonly FileEntry[],
    caseResults: ReadonlyMap<string, CaseInfo>,
): {failures: string[]; skipped: string[]} {
    const failures: string[] = [];
    const skipped: string[] = [];
    for (const entry of entries) {
        for (const testCase of entry.cases) {
            const info = caseResults.get(caseKeyOf(entry.key, testCase.index));
            if (!info || info.verdict === "pass") continue;
            const lines = info.verdict === "skipped" ? skipped : failures;
            if (lines.length === 0) {
                lines.push(
                    "",
                    info.verdict === "skipped" ? "缺图跳过的用例（补图后重跑）：" : "失败或没有完成验证的用例：",
                );
            }
            const text = formatCaseFailure(info);
            lines.push(
                `  ${info.verdict === "fail" ? "✗" : "！"} ${entry.key} 第 ${testCase.index + 1} 个用例：${text.title}`,
            );
            for (const line of text.lines) lines.push(`      · ${line}`);
        }
    }
    return {failures, skipped};
}
