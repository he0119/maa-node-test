// maa-tools 机器输出的本地描述与运行时检查；测试来源和结论由上游提供。

import {isDeepStrictEqual} from "node:util";

import {isAbsolutePath, pathKey, resolveFromWorkspace} from "../core/paths";

/** 文件跳过仅表示本次筛选未选择用例。 */
export type FileVerdict = "pass" | "fail" | "error" | "skipped";

/** 单条用例还可以被跳过，表示至少有平台没有完成验证，不能标成用例通过。 */
export type CaseOutcome = FileVerdict | "skipped";

export interface ListCase {
    index: number;
    name: string | null;
    image: string;
    hits: string[];
    start: number;
    end: number;
}

export interface ListFileEntry {
    /** 上游返回绝对路径；collectTests 转为相对工作区的显示路径。 */
    file: string;
    name?: string | null;
    controllers: string[];
    resources: string[];
    cases: ListCase[];
    error?: string;
}

export interface ListDocument {
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
    origin: CaseOrigin;
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
    status: "passed" | "failed" | "error" | "empty";
    files: RunFileResult[];
    durationMs: number;
    errorCode?: string;
    reason?: string;
}

/** 标准输出中的逐项进度；完整运行报告另由末尾 run-result 行携带。 */
export type TestRunEvent =
    | {type: "case-started"; origin: CaseOrigin}
    | {type: "case-result"; origin: CaseOrigin; result: ResultDocument}
    | {type: "file-result"; file: string; result: ResultDocument};

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
    requireValue(isAbsolutePath(value), `${at} 必须是绝对路径`);
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
    array(value.files, "files");
    optionalText(value.errorCode, "errorCode");
    optionalText(value.reason, "reason");
    const files = new Set<string>();
    value.files.forEach((file, i) => {
        fileMetadata(file, `files[${i}]`);
        const key = pathKey((file as ListFileEntry).file);
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
    object(value.origin, `${at}.origin`);
    absoluteFile(value.origin.file, `${at}.origin.file`);
    index(value.origin.case, `${at}.origin.case`);
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
    if (value.imagePath === "") {
        requireValue(
            notExecuted(value as unknown as RunCaseResult),
            `${at} 尚未执行的错误占位包含识别事实或缺少错误原因`,
        );
    } else {
        absoluteFile(value.imagePath, `${at}.imagePath`);
    }
    requireValue(
        value.verdict !== "pass" || (value.checks.length > 0 && value.checks.every((check) => (check as CaseCheck).ok)),
        `${at} 标记通过但没有有效检查或包含失败检查`,
    );
}

/** 空图片路径只用于尚未执行的错误占位，不可包含识别事实。 */
function notExecuted(result: RunCaseResult): boolean {
    return (
        result.verdict === "error" &&
        result.imagePath === "" &&
        result.checks.length === 0 &&
        result.durationMs === 0 &&
        typeof result.error === "string" &&
        result.error.length > 0
    );
}

/** 只核对上游平台结论的汇总，不重新判断识别或识别框。 */
function checkAggregate(aggregate: CaseOutcome, children: readonly CaseOutcome[], at: string): void {
    const expected = children.includes("fail")
        ? "fail"
        : children.length === 0 || children.includes("error")
          ? "error"
          : children.includes("skipped")
            ? "skipped"
            : "pass";
    requireValue(aggregate === expected, `${at} 标记 ${aggregate} 但平台结论应汇总为 ${expected}`);
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
    value.files.forEach((file, i) => {
        const at = `files[${i}]`;
        const item = file as unknown as RunFileResult;
        verdict(item.verdict, `${at}.verdict`);
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
        if (item.verdict === "skipped") {
            requireValue(
                !item.error &&
                    item.reason === "no-cases-selected" &&
                    item.cases.length === 0 &&
                    item.selectedCases.length === 0,
                `${at} 文件跳过必须无文件错误、无所选用例，并提供 no-cases-selected 原因`,
            );
        }
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
                    pathKey(origin.file) === pathKey(item.file) && origin.case === testCase.index,
                    `${platformAt} 使用了错误的用例来源`,
                );
                requireValue(platform.result.image === testCase.image, `${platformAt} 截图与文件元数据不一致`);
            });
            checkAggregate(
                testCase.verdict,
                testCase.platforms.map((platform) => platform.result.verdict),
                location,
            );
        });
        if (item.verdict !== "skipped") {
            const caseVerdicts = item.cases.map((testCase) => testCase.verdict);
            const verified = item.cases.some((testCase) =>
                testCase.platforms.some((platform) => platform.result.verdict === "pass"),
            );
            const expected = caseVerdicts.includes("fail")
                ? "fail"
                : item.error || caseVerdicts.includes("error") || !verified
                  ? "error"
                  : "pass";
            requireValue(item.verdict === expected, `${at} 标记 ${item.verdict} 但文件结论应汇总为 ${expected}`);
        }
    });
    const result = value as unknown as ResultDocument;
    const files = result.files;
    const cases = files.flatMap((file) => file.cases);
    const platforms = cases.flatMap((testCase) => testCase.platforms.map((platform) => platform.result));
    const hasFailure =
        files.some((file) => file.verdict === "fail") ||
        cases.some((testCase) => testCase.verdict === "fail") ||
        platforms.some((platform) => platform.verdict === "fail");
    const hasError =
        files.some((file) => file.verdict === "error" || Boolean(file.error)) ||
        cases.some((testCase) => testCase.verdict === "error") ||
        platforms.some((platform) => platform.verdict === "error");
    if (result.status === "passed") {
        requireValue(!hasFailure && !hasError, "顶层 passed 与文件、用例或平台结论矛盾");
        requireValue(
            platforms.some((platform) => platform.verdict === "pass"),
            "顶层 passed 却没有实际验证通过的结果",
        );
    }
    if (result.status === "failed") {
        requireValue(hasFailure, "顶层 failed 却没有失败文件");
        requireValue(!hasError, "顶层 failed 掩盖了运行错误");
    }
    if (result.status === "empty") {
        requireValue(result.errorCode === "no-tests-matched", "empty 必须提供 no-tests-matched 错误代码");
        requireValue(
            files.every((file) => file.verdict === "error" || file.verdict === "skipped") &&
                cases.every((testCase) => testCase.verdict === "error" && testCase.durationMs === 0) &&
                platforms.every(notExecuted),
            "empty 却包含已运行的测试结果",
        );
    }
    if (result.status === "error") {
        requireValue(
            hasError || (typeof result.errorCode === "string" && result.errorCode.length > 0),
            "顶层 error 缺少错误结果或明确的全局 errorCode",
        );
        // 配置或进程准备失败时可能还没有文件元数据；必须由错误代码明确说明。
        if (files.length === 0) return result;
    }

    const requested = new Set(
        selection.testFiles.map((file) => pathKey(resolveFromWorkspace(selection.workspaceRoot, file))),
    );
    const returned = new Map(
        result.files.map((file) => [
            pathKey(file.file),
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
                if (pathKey(resolveFromWorkspace(selection.workspaceRoot, key)) === filePath) expected = [...indices];
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

    return result;
}

/** 只接受所选来源的进度；结果快照沿用最终报告的完整协议检查。 */
export function validateTestRunEvent(value: unknown, selection: ResultSelection): TestRunEvent {
    object(value, "进度消息");
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
    const filePath = pathKey(file);
    requireValue(
        selection.testFiles.some((item) => pathKey(resolveFromWorkspace(selection.workspaceRoot, item)) === filePath),
        `进度消息包含未请求的测试文件 ${file}`,
    );
    let expected: readonly number[] | undefined = selection.caseIndex != null ? [selection.caseIndex] : undefined;
    if (!expected && selection.expectedCases) {
        for (const [
            key,
            indices,
        ] of selection.expectedCases) {
            if (pathKey(resolveFromWorkspace(selection.workspaceRoot, key)) === filePath) expected = indices;
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
            result.files.length === 1 && pathKey(result.files[0].file) === filePath,
            "进度结果快照必须包含对应的单个文件",
        );
    }
    return value as unknown as TestRunEvent;
}
