import * as path from "node:path";
import * as vscode from "vscode";
import {readNodeTestConfig, resolveNodeTestWorkspace} from "./config";
import {isTestFilePath} from "./core/document";
import {collectTests, type ListCase} from "./maatools/collect";
import {samePath} from "./core/paths";
import {RUN_CASE_COMMAND, RUN_FILE_COMMAND} from "./core/lens";
import {NodeTestCodeLensProvider, TEST_FILE_SELECTOR} from "./providers/codeLens";
import {resolveControllerDir} from "./core/loaderMaps";
import {RepoIndex} from "./core/repoIndex";
import {NodeTestCompletionProvider} from "./providers/completion";
import {NodeTestDefinitionProvider} from "./providers/definition";
import {NodeTestHoverProvider} from "./providers/hover";
import {NodeTestInlayHintsProvider} from "./providers/inlayHints";
import {MaaToolsVersionStatus} from "./toolVersionStatus";
import {describeError, killRunningTests, NodeTestRunner} from "./testRunner";
import type {RunRequest} from "./testRunner";
import {NodeTestExplorer, REFRESH_TESTS_COMMAND} from "./testController";

/** 当前激活的 runner 和测试面板，只有 deactivate 时才会置空 */
let runner: NodeTestRunner | undefined;
let explorer: NodeTestExplorer | undefined;
let versionStatus: MaaToolsVersionStatus | undefined;
/** 补全用的仓库索引：按工作区缓存，换工作区或改设置就重建 */
let repoIndex: RepoIndex | undefined;
let repoIndexKey = "";
/** 后台预热用的定时器和待预热队列 */
let warmTimer: NodeJS.Timeout | undefined;
const warmPending = new Map<string, {controllers: string[]; count: number}>();
const warmDone = new Set<string>();
/** 激活后等一会儿再开始预热，先让 VS Code 把界面和面板画出来 */
const WARM_START_DELAY_MS = 1200;
/** 两个 scope 之间留出间隙，别连着占 CPU */
const WARM_STEP_DELAY_MS = 200;

/** 这里只做装配：创建输出通道、注册 provider 和命令，具体逻辑各在各的模块里 */
export function activate(context: vscode.ExtensionContext): void {
    const output = vscode.window.createOutputChannel("Maa 节点测试");
    runner = new NodeTestRunner(output);
    explorer = new NodeTestExplorer(resolveController, scheduleWarm);

    // 版本显示与兼容提示共用查询；依赖或被测工作区改变后自动更新。
    versionStatus = new MaaToolsVersionStatus(output);

    context.subscriptions.push(
        output,
        runner,
        versionStatus,
        // 测试面板：把 tests 下的用例做成可以单个运行的测试树
        explorer,
        vscode.languages.registerCodeLensProvider(TEST_FILE_SELECTOR, new NodeTestCodeLensProvider()),
        vscode.languages.registerHoverProvider(TEST_FILE_SELECTOR, new NodeTestHoverProvider(currentRepoIndex)),
        // hits 里的节点名可以 Ctrl+Click / F12 跳到 pipeline 里的定义
        vscode.languages.registerDefinitionProvider(
            TEST_FILE_SELECTOR,
            new NodeTestDefinitionProvider(currentRepoIndex),
        ),
        // hits 里的节点名后面贴一句注释（pipeline 的 desc），点一下跳过去
        vscode.languages.registerInlayHintsProvider(
            TEST_FILE_SELECTOR,
            new NodeTestInlayHintsProvider(currentRepoIndex, () => readNodeTestConfig().hitsInlayHints),
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
        vscode.commands.registerCommand(REFRESH_TESTS_COMMAND, () => explorer?.refresh()),
    );
}

/**
 * 把「这份测试文件声明的控制器组合」排进后台预热队列。
 *
 * 为什么要预热：建节点索引要读几百个 pipeline 文件（约 350ms），如果不预热，第一次在 hits 里补全、
 * 第一次打开带 hits 的文件、第一次悬浮节点名都会卡这么一下。放到后台做，用户真去操作时是 5ms。
 */
function scheduleWarm(scopes: readonly (readonly string[])[]): void {
    for (const scope of scopes) {
        const key = scopeKey(scope);
        if (warmDone.has(key)) continue;
        const existing = warmPending.get(key);
        if (existing) existing.count += 1;
        else warmPending.set(key, {controllers: [...scope], count: 1});
    }
    if (warmPending.size > 0 && !warmTimer) warmTimer = setTimeout(warmStep, WARM_START_DELAY_MS);
}

/** 一次预热一个 scope，优先热用得最多的那个（多半是基础资源那份） */
function warmStep(): void {
    warmTimer = undefined;

    const next = [...warmPending.entries()].sort((left, right) => right[1].count - left[1].count)[0];
    if (!next) return;
    warmPending.delete(next[0]);
    warmDone.add(next[0]);

    try {
        currentRepoIndex()?.nodes(next[1].controllers);
    } catch {
        // 预热失败不影响任何功能，下次操作时现建就好
    }

    if (warmPending.size > 0) warmTimer = setTimeout(warmStep, WARM_STEP_DELAY_MS);
}

/** 控制器组合当缓存键，顺序无关 */
function scopeKey(scope: readonly string[]): string {
    return [...scope].sort().join(",");
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
    if (warmTimer) clearTimeout(warmTimer);
    warmTimer = undefined;
    warmPending.clear();
    versionStatus?.dispose();
    versionStatus = undefined;
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

    // CodeLens 已提供原始下标，实际有效性由 maa-tools 检查，不再本地解析或验证测试文件。
    if (typeof caseIndexArgument === "number") {
        startRun(target, {caseIndex: caseIndexArgument});
        return;
    }

    // 命令面板需要用户选择时，使用与实际运行同源的收集清单。
    const config = readNodeTestConfig();
    const {doc, stderr} = await collectTests({
        workspaceRoot: target.workspaceRoot,
        nodePath: config.nodePath,
        configPath: config.configPath,
        files: [target.relativePath],
    });
    const file = doc?.files.find((entry) => samePath(entry.file, target.relativePath));
    if (!file || file.error || file.cases.length === 0) {
        await vscode.window.showWarningMessage(
            `没有可选择的用例：${file?.error ?? (stderr || "maa-tools 没有返回该文件的用例")}`,
        );
        return;
    }
    const picked = await vscode.window.showQuickPick(buildCaseQuickPickItems(file.cases), {
        title: `选择要运行的用例：${target.relativePath}`,
        placeHolder: "选中后回车运行",
    });
    if (!picked) return;
    startRun(target, {caseIndex: picked.caseIndex});
}

function startRun(target: TestTarget, options: {caseIndex?: number}): void {
    if (!runner) return;
    const config = readNodeTestConfig();
    const request: RunRequest = {
        workspaceRoot: target.workspaceRoot,
        nodePath: config.nodePath,
        configPath: config.configPath,
        testFiles: [target.relativePath],
        caseIndex: options.caseIndex,
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

function buildCaseQuickPickItems(cases: readonly ListCase[]): CaseQuickPickItem[] {
    return cases.map((entry) => {
        const image = entry.image;
        return {
            label: `$(play) 第 ${entry.index + 1} 个用例：${entry.name ?? image}`,
            description: entry.name ? image : undefined,
            detail: `命中节点 ${entry.hits.length} 个`,
            caseIndex: entry.index,
        };
    });
}
