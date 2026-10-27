import * as path from "node:path";
import * as vscode from "vscode";
import {readNodeTestConfig, resolveNodeTestWorkspace} from "./config";
import type {NodeTestWorkspace} from "./config";
import {isTestFilePath, parseTestDocument} from "./core/document";
import {buildFileNode} from "./core/testExplorer";
import {describeCommand, startTestProcess} from "./runner";
import type {RunRequest} from "./runner";

/**
 * 把节点测试挂到 VS Code 的测试面板（Test Explorer）上：
 *   - 发现：扫 tests 目录下所有 test_*.json，文件一个根节点，每个用例一个子节点；
 *   - 运行：点文件节点跑整个文件（一次进程），点用例节点只跑这一条（一次进程，精确到用例）；
 *   - 结果：runner 的退出码翻译成通过 / 失败 / 未能运行 / 没有匹配用例。
 *
 * 为什么「跑整个文件」只起一次进程：runner 一次调用只能回答「这个文件里有没有失败的用例」，
 * 给不出「第几条失败」。所以整文件跑完，子用例按同一结果标记，失败信息里提示用户
 * 展开后单独重跑以定位到具体用例；只有点单条用例时才是独立进程、精确结果。
 */

/** 命令面板里的「刷新测试面板」。测试面板自己也有刷新按钮，这个命令方便用快捷键触发 */
export const REFRESH_TESTS_COMMAND = "maaNodeTest.refreshTests";

/** 测试文件的两条 glob：json 和 jsonc 各查一次，比花括号 glob 兼容性稳 */
const TEST_FILE_GLOBS = [
    "**/tests/**/test_*.json",
    "**/tests/**/test_*.jsonc",
];

/** 从节点 id 里读用例下标：`<文件绝对路径>#case-<下标>` */
const CASE_ID_PATTERN = /#case-(\d+)$/;

interface RunTarget {
    /** 测试面板上要标记结果的节点：整文件跑时是文件节点，单用例跑时是用例节点 */
    item: vscode.TestItem;
    /** 测试文件绝对路径 */
    filePath: string;
    /** 相对工作区根的路径，斜杠分隔 */
    relativePath: string;
    /** 有值表示只跑这一条用例 */
    caseIndex?: number;
}

export class NodeTestExplorer implements vscode.Disposable {
    private readonly controller: vscode.TestController;
    private readonly disposables: vscode.Disposable[] = [];
    private refreshTimer: NodeJS.Timeout | undefined;
    /** 串行执行：一次测试运行里的多个目标逐个跑，避免同时起一堆 MaaFW 进程 */
    private queue: Promise<void> = Promise.resolve();

    constructor(private readonly extensionPath: string) {
        this.controller = vscode.tests.createTestController("maaNodeTest", "Maa 节点测试");
        this.controller.refreshHandler = () => this.refresh();

        // 只提供「运行」一种 profile，够用且不制造概念
        this.disposables.push(
            this.controller.createRunProfile("运行", vscode.TestRunProfileKind.Run, (request, token) =>
                this.enqueue(request, token),
            ),
        );

        const watcher = vscode.workspace.createFileSystemWatcher("**/tests/**/test_*.json*");
        this.disposables.push(
            watcher,
            watcher.onDidCreate(() => this.scheduleRefresh()),
            watcher.onDidChange(() => this.scheduleRefresh()),
            watcher.onDidDelete(() => this.scheduleRefresh()),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration("maaNodeTest")) this.scheduleRefresh();
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleRefresh()),
        );

        void this.refresh();
    }

    dispose(): void {
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        for (const disposable of this.disposables) disposable.dispose();
        this.controller.dispose();
    }

    /** 重新扫描所有测试文件。清空后重建，保证和磁盘一致 */
    async refresh(): Promise<void> {
        this.controller.items.replace([]);

        const workspaceRoot = resolveNodeTestWorkspace()?.workspaceRoot;
        if (!workspaceRoot) {
            // 没打开 MaaEnd 仓库时测试面板就是空的，不报错也不打扰
            return;
        }

        const seen = new Set<string>();
        for (const glob of TEST_FILE_GLOBS) {
            let uris: vscode.Uri[];
            try {
                uris = await vscode.workspace.findFiles(glob, "**/node_modules/**");
            } catch (error) {
                console.warn(`[maa-node-test] 扫描测试文件失败（${glob}）：${String(error)}`);
                continue;
            }
            for (const uri of uris) {
                if (uri.scheme !== "file" || seen.has(uri.fsPath)) continue;
                seen.add(uri.fsPath);
                await this.addFile(uri, workspaceRoot);
            }
        }
    }

    /** 一个测试文件 → 一个根节点 + 若干用例子节点 */
    private async addFile(uri: vscode.Uri, workspaceRoot: string): Promise<void> {
        const relativePath = toPosix(path.relative(workspaceRoot, uri.fsPath));
        if (!isTestFilePath(relativePath)) return;

        let document: vscode.TextDocument;
        try {
            document = await vscode.workspace.openTextDocument(uri);
        } catch (error) {
            console.warn(`[maa-node-test] 打不开 ${relativePath}：${String(error)}`);
            return;
        }

        const parsed = parseTestDocument(document.getText());
        if (parsed.problems.length > 0) {
            // 坏掉的 JSON 不进测试面板，但也不该把整个面板搞挂
            console.warn(`[maa-node-test] ${relativePath} 的 JSON 有语法错误，先跳过不显示`);
            return;
        }

        const fileNode = buildFileNode(parsed, uri.fsPath, relativePath);
        const fileItem = this.controller.createTestItem(fileNode.id, fileNode.label, uri);
        fileItem.description = fileNode.description;
        fileItem.range = new vscode.Range(document.positionAt(fileNode.start), document.positionAt(fileNode.end));
        fileItem.canResolveChildren = false;

        for (const caseNode of fileNode.cases) {
            const caseItem = this.controller.createTestItem(caseNode.id, caseNode.label, uri);
            caseItem.description = caseNode.description;
            caseItem.range = new vscode.Range(document.positionAt(caseNode.start), document.positionAt(caseNode.end));
            fileItem.children.add(caseItem);
        }

        this.controller.items.add(fileItem);
    }

    private scheduleRefresh(): void {
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined;
            void this.refresh();
        }, 300);
    }

    /** 串起来跑：前一次结束再跑下一次，用户连点几次也不会并发打架 */
    private enqueue(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> {
        const next = this.queue.then(() => this.execute(request, token));
        this.queue = next.catch(() => undefined);
        return next;
    }

    private async execute(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> {
        const testRun = this.controller.createTestRun(request);
        try {
            const workspace = resolveNodeTestWorkspace();
            if (!workspace) {
                await vscode.window.showWarningMessage(
                    "没有打开工作区文件夹：先把 MaaEnd 仓库作为工作区打开，再运行节点测试。",
                );
                return;
            }

            const allFiles = [...this.controller.items].map(
                ([
                    ,
                    item,
                ]) => item,
            );
            const targets = collectTargets(request, workspace.workspaceRoot, allFiles);
            if (targets.length === 0) {
                await vscode.window.showWarningMessage(
                    "测试面板里没有可运行的用例：确认 tests 目录下有 test_*.json，且 JSON 没有语法错误。",
                );
                return;
            }

            const config = readNodeTestConfig();
            for (const target of targets) {
                if (token.isCancellationRequested) {
                    testRun.skipped(target.item);
                    continue;
                }
                await this.runTarget(testRun, target, workspace, config, token);
            }
        } finally {
            testRun.end();
        }
    }

    /** 跑一个目标：整文件或单个用例 */
    private async runTarget(
        testRun: vscode.TestRun,
        target: RunTarget,
        workspace: NodeTestWorkspace,
        config: {nodePath: string; configPath: string},
        token: vscode.CancellationToken,
    ): Promise<void> {
        const title =
            target.caseIndex === undefined
                ? target.relativePath
                : `${target.relativePath} 第 ${target.caseIndex + 1} 个用例`;
        // 整文件跑时子用例也标成运行中，否则面板上会一直显示「未运行」
        const caseItems =
            target.caseIndex === undefined
                ? [...target.item.children].map(
                      ([
                          ,
                          item,
                      ]) => item,
                  )
                : [];
        const reportedItems = [
            target.item,
            ...caseItems,
        ];

        for (const item of reportedItems) testRun.started(item);
        testRun.appendOutput(`▶ ${title}\r\n`, undefined, target.item);

        const runRequest: RunRequest = {
            workspaceRoot: workspace.workspaceRoot,
            nodePath: config.nodePath,
            configPath: config.configPath,
            testFile: target.filePath,
            testFileRelativePath: target.relativePath,
            caseIndex: target.caseIndex,
        };

        testRun.appendOutput(`${describeCommand(runRequest, this.extensionPath)}\r\n`, undefined, target.item);

        const startedAt = Date.now();
        const process = startTestProcess(runRequest, this.extensionPath, {
            onOutput: (chunk) => testRun.appendOutput(toOutputChunk(chunk), undefined, target.item),
            onError: (error) => testRun.appendOutput(`✖ 进程没起来：${String(error)}\r\n`, undefined, target.item),
        });
        const cancellation = token.onCancellationRequested(() => process.cancel());
        const outcome = await process.done;
        cancellation.dispose();
        const duration = Date.now() - startedAt;

        if (outcome.cancelled) {
            for (const item of reportedItems) testRun.skipped(item);
            return;
        }

        if (outcome.code === 0) {
            for (const item of reportedItems) testRun.passed(item, duration);
            return;
        }

        const testMessage = new vscode.TestMessage(describeFailure(outcome.code, title));
        for (const item of reportedItems) {
            // 「跑完了但不通过」(1) 和「根本没跑起来」(2/3/null) 要区分开，排查方向完全不同
            if (outcome.code === 1) testRun.failed(item, testMessage, duration);
            else testRun.errored(item, testMessage, duration);
        }
    }
}

/** 退出码翻译成人话，直接显示在测试面板的失败信息里 */
export function describeFailure(code: number | null, title: string): string {
    if (code === 1) {
        return (
            `${title} 断言失败。具体是哪个节点没命中、还是识别框对不上，看测试输出里的红色组名，` +
            `或者工作区里的 tests/maatools/error_details.json。`
        );
    }
    if (code === 2) {
        return (
            `${title} 没跑起来（前置错误，不是用例失败）。常见原因：node 版本低于 22（改设置 maaNodeTest.nodePath）、` +
            `截图一张都不存在、maatools 配置加载失败、MaaFW 首次下载失败。测试输出里有具体原因。`
        );
    }
    if (code === 3) {
        return (
            `${title} 没有匹配到任何测试组。检查 configs.controller / configs.resource 是否都出现在 ` +
            `tests/scripts/loader.mts 的映射表里，以及用例的 image + hits 是否和展开结果对得上。`
        );
    }
    return `${title} 进程没有正常退出（退出码 ${code === null ? "无" : code}）。先检查设置 maaNodeTest.nodePath 指的 node 能不能用。`;
}

/**
 * 挑出这次测试运行要跑的目标：
 *   - 没有 include（Run All）→ 所有文件节点，每个文件跑一次；
 *   - include 里是文件节点 → 该文件跑一次；
 *   - include 里是用例节点 → 只跑那一条。
 * 同一个文件既要求整文件、又要求单用例时，整文件优先，避免同一批用例跑两遍。
 */
export function collectTargets(
    request: vscode.TestRunRequest,
    workspaceRoot: string,
    allFileItems: readonly vscode.TestItem[],
): RunTarget[] {
    const excluded = new Set((request.exclude ?? []).map((item) => item.id));
    const isExcluded = (item: vscode.TestItem): boolean =>
        excluded.has(item.id) || (item.parent ? excluded.has(item.parent.id) : false);

    const included = request.include?.length ? request.include : allFileItems;
    const fileTargets = new Map<string, RunTarget>();
    const caseTargets: RunTarget[] = [];

    for (const item of included) {
        if (isExcluded(item)) continue;
        const filePath = item.uri?.fsPath;
        if (!filePath) continue;
        const relativePath = toPosix(path.relative(workspaceRoot, filePath));

        const caseMatch = item.id.match(CASE_ID_PATTERN);
        if (caseMatch) {
            caseTargets.push({item, filePath, relativePath, caseIndex: Number(caseMatch[1])});
        } else if (!fileTargets.has(filePath)) {
            fileTargets.set(filePath, {item, filePath, relativePath});
        }
    }

    // 整文件已经覆盖到的用例不再单独跑
    const deduped = caseTargets.filter((target) => !fileTargets.has(target.filePath));
    return [
        ...fileTargets.values(),
        ...deduped,
    ];
}

/** TestRun.appendOutput 要求换行用 \r\n，否则测试输出面板里会挤成一坨 */
function toOutputChunk(chunk: string): string {
    return chunk.replace(/\r?\n/g, "\r\n");
}

function toPosix(target: string): string {
    return target.replace(/\\/g, "/");
}
