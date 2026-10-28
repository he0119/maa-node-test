// 一次运行只启动一个 maa-tools test --jsonl；标准输出按行提供进度与最终报告。
// 这里检查协议完整性、转发日志，并提供取消；不读取测试文件重判是否合法。

import {spawn} from "node:child_process";

import {DEFAULT_CONFIG, buildMaaToolsArgs} from "../core/runnerArgs";
import type {FileVerdict} from "../core/testResult";
import {MaaToolsLoadError, describeMaaToolsSource, findMaaToolsCli} from "./cli";
import {displayPath, resolveFromWorkspace} from "./paths";
import {ResultFormatError, validateResultDocument, type ResultDocument, type TestRunEvent} from "./protocol";
import {RunProgress} from "./progress";
import {
    renderAllMissingNote,
    renderCaseSummaries,
    renderCoverage,
    renderFileResults,
    renderMissingWarnings,
} from "./render";
import {adaptResultFiles, describeResultReason, type CaseInfo, type FileEntry} from "./results";

export type {ResultDocument} from "./protocol";

export interface RunFlowRequest {
    workspaceRoot: string;
    nodePath: string;
    configPath?: string;
    /** 相对仓库根或绝对路径；只有这一份文件选择。 */
    testFiles: readonly string[];
    /** 只跑某条原始用例，只能配一个文件。 */
    caseIndex?: number | null;
    /** 从收集清单获得的本次用例下标，用于核对结果，不读取测试文件。 */
    expectedCases?: ReadonlyMap<string, readonly number[]>;
}

export interface RunFlowHandlers {
    onOutput?: (chunk: string) => void;
    onError?: (error: unknown) => void;
    /** 只交付已校验的进度；无回调时也消费全部标准输出记录并与最终报告核对。 */
    onProgress?: (event: TestRunEvent) => void;
}

export interface RunFlowOutcome {
    empty?: string;
    /** 进程、启动或结果协议错误；合法逐文件错误使用 fileResults/caseResults。 */
    error?: string;
    errorCode?: string;
    cancelled: boolean;
    result: ResultDocument | null;
    entries: FileEntry[];
    /** 文件显示路径#原始用例下标；verdict 直接来自上游聚合。 */
    caseResults: Map<string, CaseInfo>;
    fileResults: Map<string, FileVerdict>;
    counts: Map<string, number>;
    fileReasons: Map<string, string>;
}

export interface RunFlow {
    done: Promise<RunFlowOutcome>;
    cancel: () => void;
}

function emptyOutcome(): RunFlowOutcome {
    return {
        cancelled: false,
        result: null,
        entries: [],
        caseResults: new Map(),
        fileResults: new Map(),
        counts: new Map(),
        fileReasons: new Map(),
    };
}

/** 说明根据错误代码选择；reason 只原样展示，不用它推断错误种类。 */
export function describeRunError(result: Pick<ResultDocument, "errorCode" | "reason">): string {
    const detail = result.reason ? `：${describeResultReason(result.reason)}` : "";
    switch (result.errorCode) {
        case "no-tests-matched":
            return `没有匹配到任何用例${detail}。请检查文件选择、配置中的 test.cases 和 loader 保留的来源。`;
        case "config-load-failed":
        case "invalid-config":
            return `maa-tools 配置加载失败${detail}。请检查 maaNodeTest.configPath 和配置内容。`;
        case "invalid-case-selection":
        case "invalid-cli-arguments":
            return `maa-tools 拒绝了测试选择${detail}。请刷新测试清单后重试，并检查文件路径和用例下标。`;
        case "collection-source-missing":
            return `测试来源不完整${detail}。请让 loader 保留用例的 origin。`;
        case "test-execution-failed":
            return `maa-tools 没有完成测试${detail}。具体原因请查看原始日志。`;
        default:
            return `maa-tools 报告错误（${describeResultReason(result.errorCode ?? "未提供错误代码")}）${detail}。具体原因请查看原始日志。`;
    }
}

/** 返回值包含全部可显示数据；意外异常也转为 outcome.error，不让 done reject。 */
export function startRunFlow(request: RunFlowRequest, handlers: RunFlowHandlers = {}): RunFlow {
    const emit = (lines: readonly string[]) => {
        if (lines.length > 0) handlers.onOutput?.(`${lines.join("\n")}\n`);
    };
    let cancelled = false;
    let currentChild: ReturnType<typeof spawn> | null = null;
    const workspace = resolveFromWorkspace(request.workspaceRoot, ".");
    const progress = new RunProgress({...request, workspaceRoot: workspace});
    const cancel = () => {
        cancelled = true;
        currentChild?.kill();
    };
    const done = (async (): Promise<RunFlowOutcome> => {
        const base = emptyOutcome();
        if (request.testFiles.length === 0 || (request.caseIndex != null && request.testFiles.length !== 1)) {
            return {
                ...base,
                errorCode: "invalid-case-selection",
                error: "运行必须选择测试文件；单条用例只能和一个文件一起运行。",
            };
        }
        if (request.caseIndex != null && (!Number.isSafeInteger(request.caseIndex) || request.caseIndex < 0)) {
            return {...base, errorCode: "invalid-case-selection", error: "用例下标必须是从 0 开始的整数。"};
        }
        let cli;
        try {
            cli = findMaaToolsCli(workspace);
        } catch (error) {
            if (error instanceof MaaToolsLoadError)
                return {...base, errorCode: "maa-tools-unavailable", error: error.message};
            throw error;
        }
        const testFiles = [
            ...new Set(request.testFiles.map((file) => displayPath(workspace, resolveFromWorkspace(workspace, file)))),
        ];
        emit([
            `库：${describeMaaToolsSource(cli.source, workspace)}`,
            "",
            "开始运行，下面是 maa-tools 的日志：",
        ]);
        let result: ResultDocument | undefined;
        const run = await runChild(
            workspace,
            request.nodePath,
            buildMaaToolsArgs({
                cliPath: cli.cliPath,
                configPath: request.configPath ?? DEFAULT_CONFIG,
                testFiles,
                caseIndex: request.caseIndex ?? undefined,
                mode: "run",
            }),
            (chunk) => handlers.onOutput?.(chunk),
            (child) => {
                currentChild = child;
                if (cancelled) child.kill();
            },
            (line) => {
                if (result) throw new ResultFormatError("run-result 必须唯一且为最后一条记录");
                const record = JSON.parse(line) as {schemaVersion?: unknown; type?: unknown; result?: unknown} | null;
                if (record?.schemaVersion === 1 && record.type === "run-result") {
                    result = validateResultDocument(record.result, {...request, workspaceRoot: workspace});
                    progress.checkFinal(result);
                } else {
                    const event = progress.accept(record);
                    if (event) handlers.onProgress?.(event);
                }
            },
        );
        currentChild = null;
        // 协议错误优先于用户取消；内部终止进程不能让可疑的通过结果留在面板上。
        if (run.streamError)
            return {
                ...base,
                cancelled,
                errorCode: "invalid-result",
                error: `maa-tools 输出记录不符合约定：${run.streamError instanceof Error ? run.streamError.message : String(run.streamError)}`,
            };
        if (cancelled) return {...base, ...progress.partial(), cancelled: true};
        if (run.spawnError) {
            handlers.onError?.(run.spawnError);
            return {
                ...base,
                ...progress.partial(),
                errorCode: "process-start-failed",
                error: `maa-tools 进程没能启动：${String(run.spawnError)}。请检查 maaNodeTest.nodePath。`,
            };
        }
        if (run.signal)
            return {
                ...base,
                ...progress.partial(),
                errorCode: "process-terminated",
                error: `maa-tools 进程被信号 ${run.signal} 终止，请查看原始日志。`,
            };
        try {
            if (run.incompleteLine) throw new ResultFormatError("标准输出末行未以换行结束，结果可能被截断");
            if (!result) throw new ResultFormatError("标准输出缺少最终 run-result 记录");
            if (result.status === "passed" && run.exitCode !== 0) {
                throw new ResultFormatError(`结果标记 passed，但进程退出码为 ${String(run.exitCode)}`);
            }
        } catch (error) {
            // 所有最终输出读取或对账异常都使结果不可信，不能保留此前显示的通过。
            return {
                ...base,
                errorCode: "invalid-result",
                error: `maa-tools 结果不符合约定：${error instanceof Error ? error.message : "结果字段无法读取"}。请检查并更新被测仓库的 @nekosu/maa-tools 依赖版本和锁文件，再执行 pnpm install，并查看原始日志。\n${run.stderr.trim() || run.stdout.trim() || "（没有任何输出）"}`,
            };
        }
        const outcome = {...base, result, errorCode: result.errorCode, ...adaptResultFiles(result, workspace)};
        if (result.status === "empty") return {...outcome, empty: describeRunError(result)};
        if (result.status === "error") outcome.error = describeRunError(result);

        emit(renderCoverage(outcome.entries));
        const missing = [
            ...new Map(
                [...outcome.caseResults.values()]
                    .flatMap((info) => info.missing)
                    .map(
                        (item) =>
                            [
                                item.path,
                                item,
                            ] as const,
                    ),
            ).values(),
        ];
        emit(renderMissingWarnings(missing));
        emit(renderFileResults(outcome.entries, outcome.fileResults));
        const summaries = renderCaseSummaries(outcome.entries, outcome.caseResults);
        emit(summaries.failures);
        emit(summaries.skipped);
        const platforms = result.files.flatMap((file) => file.cases.flatMap((testCase) => testCase.platforms));
        if (platforms.length > 0 && platforms.every((platform) => platform.result.verdict === "skipped")) {
            emit(renderAllMissingNote(missing));
        }
        return outcome;
    })()
        .then((outcome) => {
            if (outcome.error) emit([`✖ ${outcome.error}`]);
            if (outcome.empty) emit([`⚠ ${outcome.empty}`]);
            return outcome;
        })
        .catch((error: unknown) => {
            const outcome = {
                ...emptyOutcome(),
                ...progress.partial(),
                cancelled,
                errorCode: "adapter-error",
                error: `运行流程出了意外：${error instanceof Error ? error.message : String(error)}`,
            };
            emit([`✖ ${outcome.error}`]);
            return outcome;
        });
    return {done, cancel};
}

interface ChildRun {
    parsed: unknown;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal?: NodeJS.Signals | null;
    spawnError?: unknown;
    streamError?: unknown;
    incompleteLine?: boolean;
}

/** 标准 close 保证管道已排空；收集读单份 JSON，运行按完整行交给消费者。 */
export function runChild(
    cwd: string,
    nodePath: string,
    args: readonly string[],
    onOutput: (chunk: string) => void,
    register?: (child: ReturnType<typeof spawn>) => void,
    onLine?: (line: string) => void,
): Promise<ChildRun> {
    return new Promise((resolve) => {
        let child: ReturnType<typeof spawn>;
        try {
            child = spawn(nodePath, [...args], {
                cwd,
                stdio: [
                    "ignore",
                    "pipe",
                    "pipe",
                ],
            });
        } catch (error) {
            resolve({parsed: null, stdout: "", stderr: "", exitCode: null, spawnError: error});
            return;
        }
        register?.(child);
        let stdout = "";
        let stderr = "";
        let pending = "";
        let streamError: unknown;
        let spawnError: unknown;
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
            stdout += chunk;
            if (!onLine || streamError) return;
            pending += chunk;
            try {
                let newline: number;
                while ((newline = pending.indexOf("\n")) >= 0) {
                    const line = pending.slice(0, newline);
                    pending = pending.slice(newline + 1);
                    onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
                }
            } catch (error) {
                streamError = error instanceof Error ? error : new ResultFormatError("无法读取标准输出记录");
                child.kill();
            }
        });
        child.stderr?.on("data", (chunk: string) => {
            stderr += chunk;
            onOutput(chunk);
        });
        child.on("error", (error) => {
            spawnError = error;
        });
        child.once("close", (exitCode, signal) => {
            let parsed: unknown = null;
            if (!onLine) {
                try {
                    parsed = JSON.parse(stdout);
                } catch {
                    /* 由收集调用方解释格式错误。 */
                }
            }
            resolve({
                parsed,
                stdout,
                stderr,
                exitCode,
                signal,
                spawnError,
                streamError,
                incompleteLine: pending.length > 0,
            });
        });
    });
}
