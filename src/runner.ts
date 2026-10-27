import {spawn} from "node:child_process";
import type {ChildProcess} from "node:child_process";
import {existsSync} from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {buildBatchRunTitle, buildRunTitle, buildRunnerArgs, formatCommandLine} from "./core/runnerArgs";

/**
 * 这一层只管「把 runner 脚本拉起来 + 收输出 + 拿退出码」。
 * 两个调用方：
 *   - CodeLens / 命令（NodeTestRunner）：输出进输出面板，按退出码弹提示；
 *   - 测试面板（src/testing.ts）：输出灌进 TestRun，按退出码标通过/失败。
 */

/** 还活着的子进程。deactivate 时统一收掉，避免留下孤儿 node 进程 */
const activeProcesses = new Set<RunningProcess>();

interface RunningProcess {
    child: ChildProcess;
    /** 被我们主动停掉（卸载插件、用户在测试面板点取消） */
    cancelled: boolean;
}

/** 插件卸载时调用：把还在跑的测试全部停掉 */
export function killRunningTests(): void {
    for (const running of activeProcesses) {
        running.cancelled = true;
        running.child.kill();
    }
    activeProcesses.clear();
}

export interface RunRequest {
    /** 仓库根绝对路径，同时作为子进程的工作目录 */
    workspaceRoot: string;
    /** node 可执行文件 */
    nodePath: string;
    /** maatools 配置，相对仓库根 */
    configPath: string;
    /** 测试文件绝对路径（单文件跑时用它；批量跑时是第一个文件） */
    testFile: string;
    /** 相对仓库根的路径，只用来拼标题 */
    testFileRelativePath: string;
    /** 批量跑的绝对路径列表。非空时一次进程跑完这些文件，省掉每个文件重新准备 MaaFW */
    testFiles?: readonly string[];
    /** 批量跑对应的相对路径，只用来拼标题 */
    testFileRelativePaths?: readonly string[];
    /** 用例下标，不传就跑整个文件 */
    caseIndex?: number;
    /** 只看计划，不实际执行 */
    dryRun?: boolean;
}

/** 进程结束时的结果。cancelled 为 true 表示是我们自己停掉的，不该当成失败 */
export interface ProcessOutcome {
    code: number | null;
    cancelled: boolean;
}

export interface TestProcessHandlers {
    /** 收到输出就回调。不保证按行，也不保证 stdout / stderr 之间的先后 */
    onOutput?: (chunk: string) => void;
    /** 进程根本起不来时回调（例如 node 路径不对）；之后 done 会给 code=null */
    onError?: (error: unknown) => void;
}

export interface TestProcess {
    done: Promise<ProcessOutcome>;
    /** 停掉这个进程。之后再调用无害 */
    cancel: () => void;
}

/** 本次运行等价于哪条命令行，出问题时方便用户自己复制去终端跑 */
export function describeCommand(request: RunRequest, extensionPath: string): string {
    return formatCommandLine(request.nodePath, buildRunnerArgsIn(request, extensionPath));
}

/** 这次运行的显示标题：单文件 / 单用例 / 批量三种写法 */
export function describeRunTitle(request: RunRequest): string {
    if (request.testFiles && request.testFiles.length > 1) {
        return buildBatchRunTitle(request.testFileRelativePaths ?? []);
    }
    return buildRunTitle(request.testFileRelativePath, request.caseIndex);
}

/** 启动一次 runner。调用方负责自己处理输出与结果 */
export function startTestProcess(
    request: RunRequest,
    extensionPath: string,
    handlers: TestProcessHandlers = {},
): TestProcess {
    const args = buildRunnerArgsIn(request, extensionPath);

    let child: ChildProcess;
    try {
        child = spawn(request.nodePath, args, {cwd: request.workspaceRoot});
    } catch (error) {
        handlers.onError?.(error);
        return {done: Promise.resolve({code: null, cancelled: false}), cancel: () => {}};
    }

    const running: RunningProcess = {child, cancelled: false};
    activeProcesses.add(running);

    // 统一按 utf8 解，中文日志不会被拆成乱码
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => handlers.onOutput?.(chunk));
    child.stderr?.on("data", (chunk: string) => handlers.onOutput?.(chunk));

    const done = new Promise<ProcessOutcome>((resolve) => {
        let settled = false;
        const settle = (outcome: ProcessOutcome) => {
            if (settled) return;
            settled = true;
            activeProcesses.delete(running);
            resolve(outcome);
        };

        child.on("error", (error: Error) => {
            handlers.onError?.(error);
            settle({code: null, cancelled: running.cancelled});
        });
        child.on("close", (code: number | null) => {
            settle({code, cancelled: running.cancelled});
        });
    });

    return {
        done,
        cancel: () => {
            running.cancelled = true;
            child.kill();
        },
    };
}

function buildRunnerArgsIn(request: RunRequest, extensionPath: string): string[] {
    return buildRunnerArgs({
        runnerScriptPath: path.join(extensionPath, "runner", "run-single-test.mjs"),
        workspaceRoot: request.workspaceRoot,
        configPath: request.configPath,
        testFile: request.testFile,
        testFiles: request.testFiles,
        caseIndex: request.caseIndex,
        dryRun: request.dryRun,
    });
}

/** 负责起进程、把输出灌进输出面板、转状态栏、按退出码给提示（CodeLens / 命令走这条） */
export class NodeTestRunner implements vscode.Disposable {
    private readonly statusBar: vscode.StatusBarItem;
    private runningCount = 0;

    constructor(
        private readonly output: vscode.OutputChannel,
        private readonly extensionPath: string,
    ) {
        this.statusBar = vscode.window.createStatusBarItem("maaNodeTest.running", vscode.StatusBarAlignment.Left, 100);
    }

    /** 发起一次运行。并发多次调用没问题，用计数器维护状态栏 */
    run(request: RunRequest): void {
        const title = buildRunTitle(request.testFileRelativePath, request.caseIndex);

        this.output.appendLine(`▶ ${title}${request.dryRun ? "（只看运行计划，不实际执行）" : ""}`);
        this.output.appendLine(describeCommand(request, this.extensionPath));
        this.output.show(true);

        const process = startTestProcess(request, this.extensionPath, {
            onOutput: (chunk) => this.output.append(chunk),
            onError: (error) => {
                this.output.appendLine(`✖ 进程没起来：${describeError(error)}`);
                void vscode.window.showErrorMessage(
                    `节点测试没能跑起来：${title}。检查 maaNodeTest.nodePath 设置（当前是「${request.nodePath}」）。`,
                );
            },
        });

        this.changeRunningCount(1);
        void process.done.then((outcome) => {
            this.changeRunningCount(-1);
            if (outcome.cancelled) {
                this.output.appendLine(`■ ${title} 已手动停止`);
                return;
            }
            this.output.appendLine(`■ ${title} 结束：退出码 ${outcome.code ?? "无"}`);
            void this.report(outcome.code, title, request);
        });
    }

    dispose(): void {
        this.statusBar.dispose();
    }

    /** 退出码到人话提示 */
    private async report(code: number | null, title: string, request: RunRequest): Promise<void> {
        if (code === 0) {
            if (!request.dryRun) {
                await vscode.window.showInformationMessage(`节点测试通过：${title}`);
            }
            return;
        }

        if (code === 1) {
            const action = await vscode.window.showErrorMessage(`节点测试失败：${title}`, "打开错误详情");
            if (action === "打开错误详情") await this.openErrorDetails(request.workspaceRoot);
            return;
        }

        if (code === 2) {
            const action = await vscode.window.showErrorMessage(`节点测试没能跑起来：${title}`, "查看输出");
            if (action === "查看输出") this.output.show();
            return;
        }

        if (code === 3) {
            const action = await vscode.window.showWarningMessage(
                `没有匹配到任何用例：${title}，请检查 configs.controller / configs.resource 与 tests/scripts/loader.mts 的映射`,
                "查看输出",
            );
            if (action === "查看输出") this.output.show();
            return;
        }

        const action = await vscode.window.showErrorMessage(
            `节点测试意外退出（${code === null ? "没有退出码" : `退出码 ${code}`}）：${title}`,
            "查看输出",
        );
        if (action === "查看输出") this.output.show();
    }

    /** 打开 maa-tools 写的错误明细；文件不在就退回输出面板 */
    async openErrorDetails(workspaceRoot: string): Promise<void> {
        const detailsPath = path.join(workspaceRoot, "tests", "maatools", "error_details.json");
        if (!existsSync(detailsPath)) {
            this.output.appendLine(`没有找到 ${detailsPath}，改看输出面板里的日志。`);
            this.output.show();
            return;
        }
        try {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(detailsPath));
            await vscode.window.showTextDocument(document, {preview: true});
        } catch (error) {
            this.output.appendLine(`打开 ${detailsPath} 失败：${describeError(error)}`);
            this.output.show();
        }
    }

    /** 并发运行用计数器，不排队 */
    private changeRunningCount(delta: number): void {
        this.runningCount = Math.max(0, this.runningCount + delta);
        if (this.runningCount === 0) {
            this.statusBar.hide();
            return;
        }
        this.statusBar.text = `$(sync~spin) 节点测试运行中（${this.runningCount}）`;
        this.statusBar.tooltip = "Maa 节点测试正在运行，输出在「Maa 节点测试」面板里";
        this.statusBar.show();
    }
}

/** 把 Error 说成人话，顺手带上 errno 里的错误码（比如 ENOENT） */
export function describeError(error: unknown): string {
    if (error instanceof Error) {
        const code = (error as NodeJS.ErrnoException).code;
        return code ? `${error.message}（${code}）` : error.message;
    }
    return String(error);
}
