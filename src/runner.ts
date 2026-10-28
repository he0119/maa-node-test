// 起 maa-tools 命令行跑节点测试，并把结果说给人听（CodeLens / 命令走这条）。
//
// 这一层只管「拉起流程 + 收输出 + 按结果给提示」。两个调用方：
//   - CodeLens / 命令（NodeTestRunner）：输出进输出面板，按结果弹提示；
//   - 测试面板（src/testing.ts）：输出灌进 TestRun，按结构化结论标通过/失败。
//
// 扩展直接启动被测仓库安装的 maa-tools test --jsonl，采用上游的文件与用例汇总结论。

import * as vscode from "vscode";

import {buildBatchRunTitle, buildMaaToolsArgs, buildRunTitle, formatCommandLine} from "./core/runnerArgs";
import {workspaceMaaToolsCli} from "./maatools/cli";
import {displayPath, resolveFromWorkspace} from "./maatools/paths";
import {caseOutcome, overallVerdict} from "./maatools/results";
import {startRunFlow, type RunFlowOutcome, type RunFlowRequest} from "./maatools/flow";
import type {TestRunEvent} from "./maatools/protocol";

export type {RunFlowOutcome} from "./maatools/flow";

/** 命令与测试面板使用同一份文件选择和启动参数。 */
export interface RunRequest extends RunFlowRequest {
    configPath: string;
    caseIndex?: number;
}

export interface TestProcessHandlers {
    /** 收到输出就回调。不保证按行 */
    onOutput?: (chunk: string) => void;
    /** 进程根本起不来时回调（例如 node 路径不对） */
    onError?: (error: unknown) => void;
    /** 已校验的即时开始或完成事件，原样交给测试面板。 */
    onProgress?: (event: TestRunEvent) => void;
}

export interface TestProcess {
    /** 流程结束，包含经过完整性检查的文件与用例结果。 */
    done: Promise<RunFlowOutcome>;
    /** 停掉这次运行。之后再调用无害 */
    cancel: () => void;
}

/** 还在跑的运行。deactivate 时统一收掉，避免留下孤儿进程 */
const activeProcesses = new Set<TestProcess>();

/** 插件卸载时调用：把还在跑的测试全部停掉 */
export function killRunningTests(): void {
    for (const running of [...activeProcesses]) running.cancel();
}

/** 本次运行等价于哪条命令行，出问题时方便用户自己复制去终端跑 */
export function describeCommand(request: RunRequest): string {
    const cliPath = workspaceMaaToolsCli(request.workspaceRoot);
    const args = buildMaaToolsArgs({
        cliPath,
        configPath: request.configPath,
        testFiles: relativePathsOf(request),
        caseIndex: request.caseIndex,
        mode: "run",
    });
    return formatCommandLine(request.nodePath, args);
}

/** 这次运行的显示标题：单文件 / 单用例 / 批量三种写法 */
export function describeRunTitle(request: RunRequest): string {
    const relativePaths = relativePathsOf(request);
    if (relativePaths.length > 1) return buildBatchRunTitle(relativePaths);
    return buildRunTitle(relativePaths[0], request.caseIndex);
}

function relativePathsOf(request: RunRequest): string[] {
    return request.testFiles.map((file) =>
        displayPath(request.workspaceRoot, resolveFromWorkspace(request.workspaceRoot, file)),
    );
}

/**
 * 启动一次 maa-tools test --jsonl。调用方负责显示输出与结果。
 * 返回的 handle 可取消；插件卸载时会统一停掉所有还在跑的运行。
 */
export function startTestRun(request: RunRequest, handlers: TestProcessHandlers = {}): TestProcess {
    const flowRequest: RunFlowRequest = {
        workspaceRoot: request.workspaceRoot,
        nodePath: request.nodePath,
        configPath: request.configPath,
        testFiles: relativePathsOf(request),
        caseIndex: request.caseIndex ?? null,
        expectedCases: request.expectedCases,
    };

    const flow = startRunFlow(flowRequest, handlers);
    const handle: TestProcess = {
        done: flow.done.finally(() => activeProcesses.delete(handle)),
        cancel: () => {
            flow.cancel();
            activeProcesses.delete(handle);
        },
    };
    activeProcesses.add(handle);
    return handle;
}

/** 负责起流程、把输出灌进输出面板、转状态栏、按结果给提示（CodeLens / 命令走这条） */
export class NodeTestRunner implements vscode.Disposable {
    private readonly statusBar: vscode.StatusBarItem;
    private runningCount = 0;

    constructor(private readonly output: vscode.OutputChannel) {
        this.statusBar = vscode.window.createStatusBarItem("maaNodeTest.running", vscode.StatusBarAlignment.Left, 100);
    }

    /** 发起一次运行。并发多次调用没问题，用计数器维护状态栏 */
    run(request: RunRequest): void {
        const title = describeRunTitle(request);

        this.output.appendLine(`▶ ${title}`);
        this.output.appendLine(describeCommand(request));
        this.output.show(true);

        const process = startTestRun(request, {
            onOutput: (chunk) => this.output.append(chunk),
            // 进程起不来只记日志：弹窗统一从 report 出，一次故障只提示一次
            onError: (error) => this.output.appendLine(`✖ 进程没起来：${describeError(error)}`),
        });

        this.changeRunningCount(1);
        void process.done.then((outcome) => {
            this.changeRunningCount(-1);
            if (outcome.cancelled) {
                this.output.appendLine(`■ ${title} 已手动停止`);
                return;
            }
            this.output.appendLine(`■ ${title} 结束`);
            void this.report(outcome, title);
        });
    }

    dispose(): void {
        this.statusBar.dispose();
    }

    /** 结果到人话提示。口径和测试面板一致：缺图跳过 ≠ 通过 */
    private async report(outcome: RunFlowOutcome, title: string): Promise<void> {
        if (outcome.empty) {
            const action = await vscode.window.showWarningMessage(
                `没有匹配到任何用例：${title}。${outcome.empty}`,
                "查看输出",
            );
            if (action === "查看输出") this.output.show();
            return;
        }

        if (outcome.error) {
            const action = await vscode.window.showErrorMessage(
                `节点测试未完成：${title}。${outcome.error.split("\n")[0]}`,
                "查看输出",
            );
            if (action === "查看输出") this.output.show();
            return;
        }

        const overall = overallVerdict(outcome.fileResults);
        const skippedCases = [...outcome.caseResults.values()].filter((info) => caseOutcome(info) === "skipped").length;

        if (overall === "fail") {
            const action = await vscode.window.showErrorMessage(`节点测试失败：${title}`, "查看输出");
            if (action === "查看输出") this.output.show();
            return;
        }

        if (overall === "error" || overall === "empty") {
            const action = await vscode.window.showWarningMessage(
                `节点测试未完成全部验证：${title}。请查看输出中的文件和用例原因。`,
                "查看输出",
            );
            if (action === "查看输出") this.output.show();
            return;
        }

        const skippedFiles = [...outcome.fileResults.values()].filter((verdict) => verdict === "skipped").length;
        if (skippedCases > 0 || skippedFiles > 0) {
            const notes = [
                ...(skippedFiles > 0 ? [`${skippedFiles} 个文件本次筛选未选择用例`] : []),
                ...(skippedCases > 0 ? [`${skippedCases} 条用例因截图缺失被跳过、没有验证`] : []),
            ];
            const action = await vscode.window.showWarningMessage(
                `节点测试通过；${notes.join("；")}：${title}`,
                "查看输出",
            );
            if (action === "查看输出") this.output.show();
            return;
        }

        await vscode.window.showInformationMessage(`节点测试通过：${title}`);
    }

    private changeRunningCount(delta: number): void {
        this.runningCount = Math.max(0, this.runningCount + delta);
        if (this.runningCount === 0) {
            this.statusBar.hide();
        } else {
            this.statusBar.text = `$(beaker) 节点测试 ${this.runningCount} 项运行中`;
            this.statusBar.show();
        }
    }
}

export function describeError(error: unknown): string {
    if (error instanceof Error) {
        const code = (error as NodeJS.ErrnoException).code;
        return code ? `${error.message}（${code}）` : error.message;
    }
    return String(error);
}
