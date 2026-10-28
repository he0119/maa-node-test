// maa-tools 机器输出的本地描述与运行时检查；测试来源和结论由上游提供。

import * as path from "node:path";
import {isDeepStrictEqual} from "node:util";

import type {CaseOutcome, FileVerdict} from "../core/testResult";
import {resolveFromWorkspace} from "./paths";

export interface ListCase {
    index: number;
    name: string | null;
    image: string;
    hits: string[];
    start: number;
    end: number;
}

export interface ListFileEntry {
    /** 上游返回绝对路径；runTestList 转为相对工作区的显示路径。 */
    file: string;
    name?: string | null;
    controllers: string[];
    resources: string[];
    cases: ListCase[];
    error?: string;
}

export interface ListDocument {
    schemaVersion: 1;
    files: ListFileEntry[];
    errorCode?: string;
    reason?: string;
}

export interface CaseOrigin {
    file: string;
    case: number;
}

export interface CaseCheck {
    node: string;
    expected: "hit" | "miss";
    expectedBox?: number[];
    hit: boolean;
    detail: {algorithm?: string; box?: number[]; [key: string]: unknown} | null;
    ok: boolean;
    reason?: string;
}

export interface RunCaseResult {
    image: string;
    imagePath: string;
    verdict: CaseOutcome;
    checks: CaseCheck[];
    durationMs: number;
    error?: string;
    origin?: CaseOrigin;
}

export interface RunGroupResult {
    name: string;
    source?: string;
    controller: string;
    resource: string;
    verdict: CaseOutcome;
    cases: RunCaseResult[];
    durationMs: number;
}

export interface RunFileCaseResult extends ListCase {
    verdict: CaseOutcome;
    durationMs: number;
    reason?: string;
    platforms: {controller: string; resource: string; result: RunCaseResult}[];
}

export interface RunFileResult extends Omit<ListFileEntry, "cases"> {
    verdict: FileVerdict;
    reason?: string;
    selectedCases: number[];
    cases: RunFileCaseResult[];
}

export interface ResultDocument {
    schemaVersion: 1;
    status: "passed" | "failed" | "error" | "empty";
    groups: RunGroupResult[];
    files: RunFileResult[];
    durationMs: number;
    errorCode?: string;
    reason?: string;
}

/** 标准输出中的逐项进度；完整运行报告另由末尾 run-result 行携带。 */
export type TestRunEvent =
    | {schemaVersion: 1; type: "case-started"; origin: CaseOrigin}
    | {schemaVersion: 1; type: "case-result"; origin: CaseOrigin; result: ResultDocument}
    | {schemaVersion: 1; type: "file-result"; file: string; result: ResultDocument};

export interface ResultSelection {
    workspaceRoot: string;
    testFiles: readonly string[];
    caseIndex?: number | null;
    /** 来自收集结果的本次选中下标；不重新读取测试文件。 */
    expectedCases?: ReadonlyMap<string, readonly number[]>;
}

export class ResultFormatError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ResultFormatError";
    }
}

function requireValue(condition: unknown, message: string): asserts condition {
    if (!condition) throw new ResultFormatError(message);
}

function object(value: unknown, at: string): asserts value is Record<string, unknown> {
    requireValue(value !== null && typeof value === "object" && !Array.isArray(value), `${at} 必须是对象`);
}

function text(value: unknown, at: string): asserts value is string {
    requireValue(typeof value === "string", `${at} 必须是字符串`);
}

function optionalText(value: unknown, at: string): void {
    if (value !== undefined) text(value, at);
}

function strings(value: unknown, at: string): asserts value is string[] {
    requireValue(Array.isArray(value) && value.every((item) => typeof item === "string"), `${at} 必须是字符串数组`);
}

function array(value: unknown, at: string): asserts value is unknown[] {
    requireValue(Array.isArray(value), `${at} 必须是数组`);
}

function duration(value: unknown, at: string): void {
    requireValue(typeof value === "number" && Number.isFinite(value) && value >= 0, `${at} 必须是非负有限数值`);
}

function index(value: unknown, at: string): asserts value is number {
    requireValue(Number.isSafeInteger(value) && (value as number) >= 0, `${at} 必须是非负整数`);
}

function absoluteFile(value: unknown, at: string): asserts value is string {
    text(value, at);
    requireValue(path.isAbsolute(value), `${at} 必须是绝对路径`);
}

function verdict(value: unknown, at: string, allowSkipped = true): void {
    requireValue(
        value === "pass" || value === "fail" || value === "error" || (allowSkipped && value === "skipped"),
        `${at} 是不支持的结论：${String(value)}`,
    );
}

function caseMetadata(value: unknown, at: string): void {
    object(value, at);
    index(value.index, `${at}.index`);
    requireValue(value.name === null || typeof value.name === "string", `${at}.name 必须是字符串或 null`);
    text(value.image, `${at}.image`);
    requireValue(value.image.length > 0, `${at}.image 不能为空`);
    strings(value.hits, `${at}.hits`);
    index(value.start, `${at}.start`);
    index(value.end, `${at}.end`);
    requireValue(value.end >= value.start, `${at}.end 不能早于 start`);
}

function fileMetadata(value: unknown, at: string): void {
    object(value, at);
    absoluteFile(value.file, `${at}.file`);
    if (value.name !== null) optionalText(value.name, `${at}.name`);
    optionalText(value.error, `${at}.error`);
    strings(value.controllers, `${at}.controllers`);
    strings(value.resources, `${at}.resources`);
    array(value.cases, `${at}.cases`);
    const indices = new Set<number>();
    value.cases.forEach((item, i) => {
        caseMetadata(item, `${at}.cases[${i}]`);
        const caseIndex = (item as ListCase).index;
        requireValue(!indices.has(caseIndex), `${at} 重复返回用例下标 ${caseIndex}`);
        indices.add(caseIndex);
    });
}

function documentHeader(value: unknown): asserts value is Record<string, unknown> & {files: unknown[]} {
    object(value, "结果");
    requireValue(
        value.schemaVersion === 1,
        `不支持 maa-tools 结果版本 ${String(value.schemaVersion)}，需要 schemaVersion: 1`,
    );
    array(value.files, "files");
    optionalText(value.errorCode, "errorCode");
    optionalText(value.reason, "reason");
    const files = new Set<string>();
    value.files.forEach((file, i) => {
        fileMetadata(file, `files[${i}]`);
        const key = path.normalize((file as ListFileEntry).file);
        requireValue(!files.has(key), `重复返回测试文件 ${key}`);
        files.add(key);
    });
}

export function validateListDocument(value: unknown): ListDocument {
    documentHeader(value);
    return value as unknown as ListDocument;
}

function rectangle(value: unknown, at: string): void {
    requireValue(
        Array.isArray(value) &&
            value.length === 4 &&
            value.every((item) => typeof item === "number" && Number.isFinite(item)),
        `${at} 必须是包含四个有限数值的识别框`,
    );
}

function runCase(value: unknown, at: string): void {
    object(value, at);
    text(value.image, `${at}.image`);
    text(value.imagePath, `${at}.imagePath`);
    verdict(value.verdict, `${at}.verdict`);
    duration(value.durationMs, `${at}.durationMs`);
    optionalText(value.error, `${at}.error`);
    if (value.origin !== undefined) {
        object(value.origin, `${at}.origin`);
        absoluteFile(value.origin.file, `${at}.origin.file`);
        index(value.origin.case, `${at}.origin.case`);
    }
    array(value.checks, `${at}.checks`);
    value.checks.forEach((check, i) => {
        const location = `${at}.checks[${i}]`;
        object(check, location);
        text(check.node, `${location}.node`);
        requireValue(check.expected === "hit" || check.expected === "miss", `${location}.expected 必须是 hit 或 miss`);
        requireValue(
            typeof check.ok === "boolean" && typeof check.hit === "boolean",
            `${location}.ok/hit 必须是布尔值`,
        );
        optionalText(check.reason, `${location}.reason`);
        if (check.expectedBox !== undefined) rectangle(check.expectedBox, `${location}.expectedBox`);
        if (check.detail !== null) {
            object(check.detail, `${location}.detail`);
            optionalText(check.detail.algorithm, `${location}.detail.algorithm`);
            if (check.detail.box !== undefined) rectangle(check.detail.box, `${location}.detail.box`);
        }
    });
    requireValue(
        value.verdict !== "pass" || (value.checks.length > 0 && value.checks.every((check) => (check as CaseCheck).ok)),
        `${at} 标记通过但没有有效检查或包含失败检查`,
    );
}

/** 检查汇总是否掩盖底层失败；不在扩展中生成领域结论。 */
function checkAggregate(aggregate: CaseOutcome, children: readonly CaseOutcome[], at: string): void {
    if (aggregate === "pass") {
        requireValue(
            children.length > 0 && children.every((item) => item === "pass"),
            `${at} 标记通过但子结果未全部通过`,
        );
    }
    if (aggregate === "skipped") {
        requireValue(
            children.length > 0 && !children.some((item) => item === "fail" || item === "error"),
            `${at} 标记跳过但包含失败或错误`,
        );
    }
    if (aggregate === "error") {
        requireValue(!children.includes("fail"), `${at} 标记错误但包含断言失败`);
    }
}

function sameResult(left: RunCaseResult, right: RunCaseResult): boolean {
    return (
        left.image === right.image &&
        left.imagePath === right.imagePath &&
        left.verdict === right.verdict &&
        left.durationMs === right.durationMs &&
        left.error === right.error &&
        isDeepStrictEqual(left.checks, right.checks)
    );
}

/** 仅接受完整的已知协议；省略字段、来源断裂或失败被汇总成通过都按格式错误处理。 */
export function validateResultDocument(value: unknown, selection: ResultSelection): ResultDocument {
    documentHeader(value);
    requireValue(
        typeof value.status === "string" &&
            [
                "passed",
                "failed",
                "error",
                "empty",
            ].includes(value.status),
        `不支持的运行状态 ${String(value.status)}`,
    );
    duration(value.durationMs, "durationMs");
    array(value.groups, "groups");
    value.groups.forEach((group, i) => {
        const at = `groups[${i}]`;
        object(group, at);
        text(group.name, `${at}.name`);
        optionalText(group.source, `${at}.source`);
        text(group.controller, `${at}.controller`);
        text(group.resource, `${at}.resource`);
        verdict(group.verdict, `${at}.verdict`);
        duration(group.durationMs, `${at}.durationMs`);
        array(group.cases, `${at}.cases`);
        group.cases.forEach((item, j) => runCase(item, `${at}.cases[${j}]`));
        const caseVerdicts = (group.cases as RunCaseResult[]).map((item) => item.verdict);
        if (group.verdict === "pass") {
            requireValue(
                caseVerdicts.includes("pass") && caseVerdicts.every((item) => item === "pass" || item === "skipped"),
                `${at} 标记通过但没有验证结果或包含失败/错误`,
            );
        }
        if (group.verdict === "skipped")
            requireValue(
                caseVerdicts.length > 0 && caseVerdicts.every((item) => item === "skipped"),
                `${at} 标记跳过但子结果不一致`,
            );
    });
    value.files.forEach((file, i) => {
        const at = `files[${i}]`;
        const item = file as unknown as RunFileResult;
        verdict(item.verdict, `${at}.verdict`, false);
        optionalText(item.reason, `${at}.reason`);
        array(item.selectedCases, `${at}.selectedCases`);
        item.selectedCases.forEach((caseIndex, j) => index(caseIndex, `${at}.selectedCases[${j}]`));
        requireValue(
            new Set(item.selectedCases).size === item.selectedCases.length,
            `${at}.selectedCases 包含重复下标`,
        );
        requireValue(
            isDeepStrictEqual(
                [...item.selectedCases].sort((a, b) => a - b),
                item.cases.map((testCase) => testCase.index).sort((a, b) => a - b),
            ),
            `${at}.cases 未完整覆盖 selectedCases`,
        );
        item.cases.forEach((testCase, j) => {
            const location = `${at}.cases[${j}]`;
            verdict(testCase.verdict, `${location}.verdict`);
            duration(testCase.durationMs, `${location}.durationMs`);
            optionalText(testCase.reason, `${location}.reason`);
            array(testCase.platforms, `${location}.platforms`);
            testCase.platforms.forEach((platform, k) => {
                const platformAt = `${location}.platforms[${k}]`;
                object(platform, platformAt);
                text(platform.controller, `${platformAt}.controller`);
                text(platform.resource, `${platformAt}.resource`);
                runCase(platform.result, `${platformAt}.result`);
                const origin = platform.result.origin;
                requireValue(
                    origin &&
                        path.normalize(origin.file) === path.normalize(item.file) &&
                        origin.case === testCase.index,
                    `${platformAt} 缺少或使用了错误的用例来源`,
                );
                requireValue(platform.result.image === testCase.image, `${platformAt} 截图与文件元数据不一致`);
            });
            checkAggregate(
                testCase.verdict,
                testCase.platforms.map((platform) => platform.result.verdict),
                location,
            );
        });
        if (item.verdict === "pass") {
            requireValue(
                !item.cases.some((testCase) => testCase.verdict === "fail" || testCase.verdict === "error"),
                `${at} 标记通过但包含失败或错误用例`,
            );
            requireValue(
                item.cases.some((testCase) =>
                    testCase.platforms.some((platform) => platform.result.verdict === "pass"),
                ),
                `${at} 标记通过但没有实际验证结果`,
            );
        }
    });
    const result = value as unknown as ResultDocument;
    const fileVerdicts = result.files.map((file) => file.verdict);
    const groupVerdicts = result.groups.map((group) => group.verdict);
    if (result.status === "passed") {
        requireValue(
            fileVerdicts.every((item) => item === "pass") &&
                !groupVerdicts.some((item) => item === "fail" || item === "error"),
            "顶层 passed 与文件或组结论矛盾",
        );
        requireValue(result.files.length > 0 || groupVerdicts.includes("pass"), "顶层 passed 却没有验证结果");
    }
    if (result.status === "failed") {
        requireValue(
            fileVerdicts.includes("fail") || (result.files.length === 0 && groupVerdicts.includes("fail")),
            "顶层 failed 却没有失败文件",
        );
        requireValue(!fileVerdicts.includes("error") && !groupVerdicts.includes("error"), "顶层 failed 掩盖了运行错误");
    }
    if (result.status === "empty") {
        requireValue(result.errorCode === "no-tests-matched", "empty 必须提供 no-tests-matched 错误代码");
        requireValue(
            !result.groups.some((group) => group.cases.length > 0) && fileVerdicts.every((item) => item === "error"),
            "empty 却包含已运行的测试结果",
        );
    }
    // 配置或进程准备失败时可能还没有文件元数据；必须由错误代码明确说明。
    if (result.status === "error" && result.files.length === 0 && result.groups.length === 0) {
        requireValue(typeof result.errorCode === "string" && result.errorCode.length > 0, "启动错误缺少 errorCode");
        return result;
    }

    const requested = new Set(selection.testFiles.map((file) => resolveFromWorkspace(selection.workspaceRoot, file)));
    const returned = new Map(
        result.files.map((file) => [
            path.normalize(file.file),
            file,
        ]),
    );
    for (const file of requested) requireValue(returned.has(file), `结果缺少所选测试文件 ${file}`);
    for (const file of returned.keys()) requireValue(requested.has(file), `结果包含未请求的测试文件 ${file}`);
    for (const [
        filePath,
        file,
    ] of returned) {
        let expected = selection.caseIndex != null ? [selection.caseIndex] : undefined;
        if (!expected && selection.expectedCases) {
            for (const [
                key,
                indices,
            ] of selection.expectedCases) {
                if (resolveFromWorkspace(selection.workspaceRoot, key) === filePath) expected = [...indices];
            }
        }
        const actual = file.cases.map((testCase) => testCase.index).sort((a, b) => a - b);
        if (expected) {
            const sorted = [...new Set(expected)].sort((a, b) => a - b);
            requireValue(
                isDeepStrictEqual(actual, sorted),
                `${filePath} 返回的用例下标不完整或包含未选用例（需要 ${sorted.join(",")}，收到 ${actual.join(",")}）`,
            );
        }
    }

    const grouped = result.groups.flatMap((group) => group.cases.map((testCase) => ({group, testCase})));
    const used = new Set<number>();
    for (const file of result.files) {
        for (const testCase of file.cases) {
            for (const platform of testCase.platforms) {
                const match = grouped.findIndex(
                    ({group, testCase: actual}, i) =>
                        !used.has(i) &&
                        group.controller === platform.controller &&
                        group.resource === platform.resource &&
                        actual.origin?.file === platform.result.origin?.file &&
                        actual.origin?.case === testCase.index &&
                        sameResult(actual, platform.result),
                );
                const notExecuted =
                    platform.result.verdict === "error" &&
                    platform.result.imagePath === "" &&
                    platform.result.checks.length === 0 &&
                    platform.result.durationMs === 0 &&
                    typeof platform.result.error === "string" &&
                    platform.result.error.length > 0 &&
                    (result.status === "error" || result.status === "empty");
                requireValue(match >= 0 || notExecuted, `${file.file}#${testCase.index} 的平台结果没有对应测试组`);
                if (match >= 0) used.add(match);
            }
        }
    }
    requireValue(used.size === grouped.length, "测试组有未归入所选文件的结果（来源缺失、遗漏或汇总矛盾）");
    return result;
}

/** 只接受所选来源的进度；结果快照沿用最终报告的完整协议检查。 */
export function validateTestRunEvent(value: unknown, selection: ResultSelection): TestRunEvent {
    object(value, "进度消息");
    requireValue(value.schemaVersion === 1, "进度消息必须使用 schemaVersion: 1");
    requireValue(
        value.type === "case-started" || value.type === "case-result" || value.type === "file-result",
        `不支持的进度消息类型 ${String(value.type)}`,
    );
    let file: string;
    let caseIndex: number | undefined;
    if (value.type === "file-result") {
        absoluteFile(value.file, "进度消息.file");
        file = value.file;
    } else {
        object(value.origin, "进度消息.origin");
        absoluteFile(value.origin.file, "进度消息.origin.file");
        index(value.origin.case, "进度消息.origin.case");
        file = value.origin.file;
        caseIndex = value.origin.case;
    }
    const filePath = path.normalize(file);
    requireValue(
        selection.testFiles.some((item) => resolveFromWorkspace(selection.workspaceRoot, item) === filePath),
        `进度消息包含未请求的测试文件 ${file}`,
    );
    let expected: readonly number[] | undefined = selection.caseIndex != null ? [selection.caseIndex] : undefined;
    if (!expected && selection.expectedCases) {
        for (const [
            key,
            indices,
        ] of selection.expectedCases) {
            if (resolveFromWorkspace(selection.workspaceRoot, key) === filePath) expected = indices;
        }
    }
    if (caseIndex !== undefined && expected)
        requireValue(expected.includes(caseIndex), `进度消息包含未请求的用例 ${file}#${caseIndex}`);
    if (value.type !== "case-started") {
        const result = validateResultDocument(value.result, {
            workspaceRoot: selection.workspaceRoot,
            testFiles: [filePath],
            caseIndex: caseIndex ?? selection.caseIndex,
            expectedCases: expected
                ? new Map([
                      [
                          filePath,
                          expected,
                      ],
                  ])
                : undefined,
        });
        // 全局启动错误可以没有 files，但逐项完成事件必须明确包含对应文件。
        requireValue(
            result.files.length === 1 && path.normalize(result.files[0].file) === filePath,
            "进度结果快照必须包含对应的单个文件",
        );
    }
    return value as unknown as TestRunEvent;
}
