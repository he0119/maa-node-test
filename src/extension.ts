import * as path from "node:path";
import * as vscode from "vscode";
import {readNodeTestConfig, resolveNodeTestWorkspace} from "./config";
import {isTestFilePath, parseTestDocument} from "./core/document";
import type {TestDocument} from "./core/document";
import {RUN_CASE_COMMAND, RUN_FILE_COMMAND, SHOW_PLAN_COMMAND} from "./core/lens";
import {NodeTestCodeLensProvider, TEST_FILE_SELECTOR} from "./providers/codeLens";
import {resolveControllerDir} from "./core/loaderMaps";
import {RepoIndex} from "./core/repoIndex";
import {NodeTestCompletionProvider} from "./providers/completion";
import {NodeTestDefinitionProvider} from "./providers/definition";
import {NodeTestHoverProvider} from "./providers/hover";
import {describeError, killRunningTests, NodeTestRunner} from "./runner";
import type {RunRequest} from "./runner";
import {NodeTestExplorer, REFRESH_TESTS_COMMAND} from "./testing";

/** 当前激活的 runner 和测试面板，只有 deactivate 时才会置空 */
let runner: NodeTestRunner | undefined;
let explorer: NodeTestExplorer | undefined;
/** 补全用的仓库索引：按工作区缓存，换工作区或改设置就重建 */
let repoIndex: RepoIndex | undefined;
let repoIndexKey = "";

/** 这里只做装配：创建输出通道、注册 provider 和命令，具体逻辑各在各的模块里 */
export function activate(context: vscode.ExtensionContext): void {
    const output = vscode.window.createOutputChannel("Maa 节点测试");
    runner = new NodeTestRunner(output, context.extensionPath);
    explorer = new NodeTestExplorer(context.extensionPath, resolveController);

    context.subscriptions.push(
        output,
        runner,
        // 测试面板：把 tests 下的用例做成可以单个运行的测试树
        explorer,
        vscode.languages.registerCodeLensProvider(TEST_FILE_SELECTOR, new NodeTestCodeLensProvider()),
        vscode.languages.registerHoverProvider(TEST_FILE_SELECTOR, new NodeTestHoverProvider(currentRepoIndex)),
        // hits 里的节点名可以 Ctrl+Click / F12 跳到 pipeline 里的定义
        vscode.languages.registerDefinitionProvider(
            TEST_FILE_SELECTOR,
            new NodeTestDefinitionProvider(currentRepoIndex),
        ),
        // 补全：controller / resource 取 loader 里的映射，image 取测试集里的截图，hits 取 pipeline 节点
        vscode.languages.registerCompletionItemProvider(
            TEST_FILE_SELECTOR,
            new NodeTestCompletionProvider(currentRepoIndex),
            '"',
        ),
        vscode.commands.registerCommand(RUN_FILE_COMMAND, (uri?: unknown) => runWholeFile(uri)),
        vscode.commands.registerCommand(RUN_CASE_COMMAND, (uri?: unknown, caseIndex?: unknown) =>
            runOneCase(uri, caseIndex),
        ),
        vscode.commands.registerCommand(SHOW_PLAN_COMMAND, (uri?: unknown) => showPlan(uri)),
        vscode.commands.registerCommand(REFRESH_TESTS_COMMAND, () => explorer?.refresh()),
    );
}

/** 把测试文件里的 controller 名字换成截图目录名（loader 里有别名时，例如 Win32-Front → Win32） */
function resolveController(controller: string): string {
    return repoIndex ? resolveControllerDir(repoIndex.maps(), controller) : controller;
}

/** 拿当前的仓库索引；工作区根或测试集目录变了就换一个新的，缓存跟着更新 */
function currentRepoIndex(): RepoIndex | null {
    const workspace = resolveNodeTestWorkspace();
    if (!workspace) return null;

    const key = `${workspace.workspaceRoot}|${workspace.testsetRoot}`;
    if (!repoIndex || repoIndexKey !== key) {
        repoIndex = new RepoIndex(workspace.workspaceRoot, workspace.testsetRoot);
        repoIndexKey = key;
    }
    return repoIndex;
}

/** 卸载时把还没跑完的 node 进程收掉，别留孤儿 */
export function deactivate(): void {
    killRunningTests();
    runner = undefined;
    explorer = undefined;
}

interface TestTarget {
    document: vscode.TextDocument;
    /** 相对工作区根的路径，斜杠分隔，用来拼标题 */
    relativePath: string;
    workspaceRoot: string;
}

interface CaseQuickPickItem extends vscode.QuickPickItem {
    caseIndex: number;
}

async function runWholeFile(uriArgument: unknown): Promise<void> {
    const target = await resolveTestTarget(uriArgument);
    if (!target) return;
    startRun(target, {});
}

async function runOneCase(uriArgument: unknown, caseIndexArgument: unknown): Promise<void> {
    const target = await resolveTestTarget(uriArgument);
    if (!target) return;

    const parsed = parseTestDocument(target.document.getText());
    if (parsed.problems.length > 0) {
        const problem = parsed.problems[0];
        const line = target.document.positionAt(problem.offset).line + 1;
        await vscode.window.showWarningMessage(
            `测试文件的 JSON 有语法错误（第 ${line} 行：${problem.message}），先修好再运行。`,
        );
        return;
    }
    if (parsed.cases.length === 0) {
        await vscode.window.showWarningMessage("这个测试文件里没有 cases，没有可运行的用例。");
        return;
    }

    // CodeLens 会直接把下标传进来；从命令面板调时没有参数，弹列表让用户挑
    const requested = typeof caseIndexArgument === "number" ? caseIndexArgument : undefined;
    if (requested !== undefined && Number.isInteger(requested) && requested >= 0 && requested < parsed.cases.length) {
        startRun(target, {caseIndex: requested});
        return;
    }

    const picked = await vscode.window.showQuickPick(buildCaseQuickPickItems(parsed), {
        title: `选择要运行的用例：${target.relativePath}`,
        placeHolder: "选中后回车运行",
    });
    if (!picked) return;
    startRun(target, {caseIndex: picked.caseIndex});
}

async function showPlan(uriArgument: unknown): Promise<void> {
    const target = await resolveTestTarget(uriArgument);
    if (!target) return;
    startRun(target, {dryRun: true});
}

function startRun(target: TestTarget, options: {caseIndex?: number; dryRun?: boolean}): void {
    if (!runner) return;
    const config = readNodeTestConfig();
    const request: RunRequest = {
        workspaceRoot: target.workspaceRoot,
        nodePath: config.nodePath,
        configPath: config.configPath,
        testFile: target.document.uri.fsPath,
        testFileRelativePath: target.relativePath,
        caseIndex: options.caseIndex,
        dryRun: options.dryRun,
    };
    runner.run(request);
}

/**
 * 找出这次要跑的文件：给了 Uri 就用它（CodeLens 传的），没给就用当前活动编辑器。
 * 不是 tests 目录下的 test_*.json 就当场说清楚，不让它跑歪。
 */
async function resolveTestTarget(uriArgument: unknown): Promise<TestTarget | null> {
    const workspace = resolveNodeTestWorkspace();
    if (!workspace) {
        await vscode.window.showWarningMessage(
            "没有打开任何文件夹：先把放了 maatools.config.mts 的仓库作为工作区打开，再运行节点测试。",
        );
        return null;
    }

    let document: vscode.TextDocument;
    if (uriArgument instanceof vscode.Uri) {
        try {
            document = await vscode.workspace.openTextDocument(uriArgument);
        } catch (error) {
            await vscode.window.showErrorMessage(`打不开这个测试文件：${describeError(error)}`);
            return null;
        }
    } else {
        const active = vscode.window.activeTextEditor?.document;
        if (!active) {
            await vscode.window.showWarningMessage(
                "当前没有打开的编辑器：请先打开 tests 目录下的 test_*.json 测试文件。",
            );
            return null;
        }
        document = active;
    }

    if (document.uri.scheme !== "file") {
        await vscode.window.showWarningMessage(`只支持磁盘上的测试文件，当前是 ${document.uri.toString()}。`);
        return null;
    }

    const relativePath = path.relative(workspace.workspaceRoot, document.uri.fsPath).split(path.sep).join("/");
    if (!isTestFilePath(relativePath)) {
        await vscode.window.showWarningMessage(
            `只能运行 tests 目录下的 test_*.json 测试文件，当前文件是 ${relativePath || document.uri.fsPath}。`,
        );
        return null;
    }

    return {document, relativePath, workspaceRoot: workspace.workspaceRoot};
}

function buildCaseQuickPickItems(parsed: TestDocument): CaseQuickPickItem[] {
    return parsed.cases.map((entry) => {
        const image = entry.image?.value ?? "没写 image";
        return {
            label: `$(play) 第 ${entry.index + 1} 个用例：${entry.name ?? image}`,
            description: entry.name ? image : undefined,
            detail: `命中节点 ${entry.hitCount} 个`,
            caseIndex: entry.index,
        };
    });
}
