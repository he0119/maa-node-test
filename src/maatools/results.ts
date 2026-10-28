// 把 maa-tools 已汇总的文件、用例结论转为显示数据；不在扩展中重判测试。

import {caseKeyOf, type CaseOutcome, type CaseVerdict, type FileVerdict} from "../core/testResult";
import {displayPath, pathKey} from "./paths";
import type {CaseCheck, ResultDocument, RunFileResult} from "./protocol";

export type {CaseCheck, CaseOrigin, RunCaseResult, RunFileCaseResult, RunFileResult, RunGroupResult} from "./protocol";

/** 元数据来自运行结果，不读取或解析本地测试文件。 */
export interface FileEntry extends Omit<RunFileResult, "file"> {
    key: string;
    filePath: string;
}

/** 上游逐用例汇总结论及显示明细。verdict 是唯一的用例结论来源。 */
export interface CaseInfo {
    verdict: CaseOutcome;
    reason?: string;
    platforms: string[];
    failures: CaseFailureItem[];
    missing: CaseMissingItem[];
    durationMs: number;
}

export interface CaseFailureItem {
    platform: string;
    node: string;
    reason: string;
    algorithm: string | null;
    image: string;
}

export interface CaseMissingItem {
    platform: string;
    image: string;
    path: string;
}

/** 检查明细的原因枚举转中文，不解析 maa-tools 的日志或英文 reason。 */
export function describeCheck(check: Partial<CaseCheck>): {node: string; reason: string; algorithm: string | null} {
    const node = check.node ?? "";
    const algorithm = check.detail?.algorithm ?? null;
    switch (check.reason) {
        case "should-hit":
            return {node, reason: "这张图上没识别到该节点", algorithm};
        case "should-miss":
            return {node, reason: "这条用例不期望它命中，但图上识别到了", algorithm};
        case "box-mismatch": {
            const expectedBox = check.expectedBox ?? null;
            const actualBox = check.detail?.box ?? null;
            if (expectedBox && !actualBox) {
                return {
                    node,
                    reason: `识别到了但没有返回识别框，无法和期望 ${JSON.stringify(expectedBox)} 比对`,
                    algorithm,
                };
            }
            return {
                node,
                reason: `识别框不对：期望 ${JSON.stringify(expectedBox)}，实际 ${JSON.stringify(actualBox)}`,
                algorithm,
            };
        }
        case "missing-detail":
            return {node, reason: "识别未返回明细，无法完成这项检查", algorithm};
        case "no-result":
            return {node, reason: "识别任务没跑出这个节点的结果（等于没验证）", algorithm};
        default:
            return {node, reason: "没通过（原因未知）", algorithm};
    }
}

/** 已知原因代码转为中文；未知的说明原样保留，方便排错。 */
export function describeResultReason(reason: string): string {
    const known: Record<string, string> = {
        "no-cases-selected": "本次筛选未选择用例",
        "missing-image": "部分或全部平台缺少截图，未完成全部验证",
        "some-platforms-skipped": "已有平台完成验证，其余平台因缺图跳过",
        "no-result": "识别或执行没有返回完整结果，未完成验证",
        "no-tests-matched": "没有匹配到测试组，请检查来源与过滤条件",
        "no-tests-verified": "没有任何用例完成有效节点检查，不能判定为通过",
        "test-file-error": "测试文件读取或格式检查失败",
        "test-verification-error": "部分用例未完成验证",
        "test-execution-failed": "测试执行异常，未完成验证",
        "config-load-failed": "无法加载 maa-tools 配置",
        "invalid-config": "maa-tools 配置格式不正确",
        "invalid-case-selection": "所选文件或用例下标无效，请刷新测试清单",
        "invalid-cli-arguments": "测试命令参数无效",
        "collection-source-missing": "测试来源不完整，请让 loader 保留 origin",
    };
    return Object.hasOwn(known, reason) ? known[reason] : reason;
}

/** 使用上游 files 元数据、case 聚合 verdict 和平台明细构建显示 Map。 */
export function adaptResultFiles(
    result: ResultDocument,
    workspace: string,
): {
    entries: FileEntry[];
    caseResults: Map<string, CaseInfo>;
    fileResults: Map<string, FileVerdict>;
    counts: Map<string, number>;
    fileReasons: Map<string, string>;
} {
    const entries: FileEntry[] = [];
    const caseResults = new Map<string, CaseInfo>();
    const fileResults = new Map<string, FileVerdict>();
    const counts = new Map<string, number>();
    const fileReasons = new Map<string, string>();
    for (const file of result.files) {
        const {file: filePath, ...metadata} = file;
        const key = displayPath(workspace, filePath);
        entries.push({
            key,
            filePath,
            ...metadata,
            reason: metadata.reason ? describeResultReason(metadata.reason) : undefined,
            error: metadata.error ? describeResultReason(metadata.error) : undefined,
        });
        fileResults.set(pathKey(key), file.verdict);
        counts.set(pathKey(key), file.selectedCases.length);
        const reason = file.reason ?? file.error;
        if (reason) fileReasons.set(pathKey(key), describeResultReason(reason));
        for (const testCase of file.cases) {
            const info: CaseInfo = {
                verdict: testCase.verdict,
                reason: testCase.reason ? describeResultReason(testCase.reason) : undefined,
                durationMs: testCase.durationMs,
                platforms: [],
                failures: [],
                missing: [],
            };
            for (const platform of testCase.platforms) {
                const label = `${platform.controller}-${platform.resource}`;
                if (!info.platforms.includes(label)) info.platforms.push(label);
                const platformResult = platform.result;
                if (platformResult.verdict === "skipped") {
                    info.missing.push({platform: label, image: platformResult.image, path: platformResult.imagePath});
                } else if (platformResult.verdict === "fail" || platformResult.verdict === "error") {
                    const checks = platformResult.checks.filter((check) => !check.ok);
                    for (const check of checks) {
                        info.failures.push({platform: label, image: platformResult.image, ...describeCheck(check)});
                    }
                    if (checks.length === 0) {
                        info.failures.push({
                            platform: label,
                            node: "",
                            reason: platformResult.error
                                ? describeResultReason(platformResult.error)
                                : platformResult.verdict === "error"
                                  ? "这条用例没有完成验证"
                                  : "这条用例失败，但结果未提供检查明细",
                            algorithm: null,
                            image: platformResult.image,
                        });
                    }
                }
            }
            caseResults.set(caseKeyOf(key, testCase.index), info);
        }
    }
    return {entries, caseResults, fileResults, counts, fileReasons};
}

/** 上游已决定结论，这里只返回原值。 */
export function caseOutcome(info: CaseInfo): CaseOutcome {
    return info.verdict;
}

export function formatCaseFailure(info: CaseInfo): {title: string; lines: string[]} {
    const failedPlatforms = unique(info.failures.map((item) => item.platform));
    const missingPlatforms = unique(info.missing.map((item) => item.platform)).filter(
        (item) => !failedPlatforms.includes(item),
    );
    const passedPlatforms = info.platforms.filter(
        (item) => !failedPlatforms.includes(item) && !missingPlatforms.includes(item),
    );
    const title =
        info.verdict === "error"
            ? `${failedPlatforms.join("、") || "用例"} 没有完成验证`
            : info.verdict === "fail"
              ? `${failedPlatforms.join("、") || "用例"} 失败`
              : `${missingPlatforms.join("、") || "用例"} 没验证到`;
    const lines: string[] = [];
    for (const item of info.failures) {
        const algorithm = item.algorithm ? `（算法 ${item.algorithm}）` : "";
        const prefix = failedPlatforms.length > 1 ? `${item.platform}：` : "";
        lines.push(`${prefix}${item.node ? `节点 \`${item.node}\` ` : ""}${item.reason}${algorithm}`);
        lines.push(`截图 \`${item.image}\`（${item.platform}）`);
    }
    for (const item of info.missing) {
        lines.push(`截图不存在 \`${item.path}\`，这条用例在 ${item.platform} 上被跳过`);
    }
    if (info.reason) lines.push(info.reason);
    if (lines.length === 0) lines.push("maa-tools 未提供这条用例的具体原因，请查看原始日志。");
    if (passedPlatforms.length > 0) lines.push(`通过：${passedPlatforms.join("、")}`);
    return {title, lines};
}

function unique(items: readonly string[]): string[] {
    return [...new Set(items)];
}

export function caseInfoToVerdict(info: CaseInfo): CaseVerdict {
    const text = info.verdict === "pass" ? {title: "通过", lines: []} : formatCaseFailure(info);
    return {verdict: info.verdict, title: text.title, detail: text.lines, durationMs: info.durationMs};
}

/** 按文件、平台统计显示数据；其他文件的平台不能掩盖当前文件未匹配的平台。 */
export function summarizePlatforms(entries: readonly FileEntry[]): {
    platforms: {label: string; controller: string; file: string; images: number; missing: number}[];
    unmatched: {controller: string; file: string}[];
} {
    const platforms: {label: string; controller: string; file: string; images: number; missing: number}[] = [];
    const unmatched: {controller: string; file: string}[] = [];
    for (const entry of entries) {
        if (entry.verdict === "skipped") continue;
        const byPlatform = new Map<
            string,
            {label: string; controller: string; file: string; images: number; missing: number}
        >();
        const seen = new Set<string>();
        for (const testCase of entry.cases) {
            for (const platform of testCase.platforms) {
                seen.add(platform.controller);
                const label = `${platform.controller}-${platform.resource}`;
                const slot = byPlatform.get(label) ?? {
                    label,
                    controller: platform.controller,
                    file: entry.key,
                    images: 0,
                    missing: 0,
                };
                slot.images++;
                if (platform.result.verdict === "skipped") slot.missing++;
                byPlatform.set(label, slot);
            }
        }
        platforms.push(...byPlatform.values());
        for (const controller of entry.controllers) {
            if (!seen.has(controller)) unmatched.push({controller, file: entry.key});
        }
    }
    return {platforms, unmatched};
}

/** 显示多个文件的总状态；每个文件的结论已由 maa-tools 决定。 */
export function overallVerdict(fileResults: ReadonlyMap<string, FileVerdict>): "pass" | "fail" | "error" | "empty" {
    const verdicts = [...fileResults.values()];
    if (verdicts.length === 0) return "empty";
    if (verdicts.includes("error")) return "error";
    if (verdicts.includes("fail")) return "fail";
    return verdicts.includes("pass") ? "pass" : "empty";
}
