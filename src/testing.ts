import * as path from "node:path";
import * as vscode from "vscode";
import {readNodeTestConfig, resolveNodeTestWorkspace} from "./config";
import type {NodeTestWorkspace} from "./config";
import {isTestFilePath, parseTestDocument} from "./core/document";
import {collectMissingImages, describeMissingImage, summarizeMissingImage} from "./core/missingImages";
import type {MissingImageWarning} from "./core/missingImages";
import {locateImage} from "./core/testset";
import {buildBatchRunTitle, buildRunTitle} from "./core/runnerArgs";
import {
    buildMessageMarkdown,
    planFileMarking,
    caseKeyOf,
    collectCaseVerdict,
    collectFileVerdict,
    describeVerdict,
    fallbackVerdict,
    verdictFromExitCode,
} from "./core/testResult";
import type {CaseOutcome, CaseVerdict, FileVerdict} from "./core/testResult";
import {buildRunSummary} from "./core/runSummary";
import type {SummaryCase, SummaryFile} from "./core/runSummary";
import {buildFileNode, folderSegments} from "./core/testExplorer";
import {describeCommand, startTestProcess} from "./runner";
import type {RunRequest} from "./runner";

/**
 * 把节点测试挂到 VS Code 的测试面板（Test Explorer）上：
 *   - 发现：扫 tests 目录下所有 test_*.json，按目录分组，每个文件一个节点、每个用例一个子节点；
 *   - 运行：点目录节点跑它下面所有文件，点文件节点跑整个文件，点用例节点只跑这一条；
 *   - 结果：逐文件结论翻译成通过 / 失败 / 未能运行。
 *
 * 两个关键取舍：
 *
 * 1. **多个文件合成一次进程**。MaaFW 初始化 + assets 加载是单次运行的固定大头（实测单文件 4~5 秒，
 *    真正的识别只占一小部分），一个文件一个进程等于把这份开销重复几十次。合成一批之后，runner 会为
 *    每个文件打印一行 `RESULT-FILE: <相对路径> pass|fail|error`，面板按它逐文件标记。
 * 2. **单条用例仍然各自一个进程**。runner 一次调用只回答整批的结果，说不出具体哪条用例失败；
 *    点单条用例时用独立进程，退出码就是这一条的结果，精确定位才有保障。
 */

/** 命令面板里的「刷新测试面板」。测试面板自己也有刷新按钮，这个命令方便用快捷键触发 */
export const REFRESH_TESTS_COMMAND = "maaNodeTest.refreshTests";

/** 测试文件的两条 glob：json 和 jsonc 各查一次，比花括号 glob 兼容性稳 */
const TEST_FILE_GLOBS = [
    "**/tests/**/test_*.json",
    "**/tests/**/test_*.jsonc",
];

/** 叶子节点（文件或用例）的元信息。面板运行时靠它把节点还原成 runner 参数 */
interface LeafInfo {
    /** 测试文件绝对路径 */
    filePath: string;
    /** 相对工作区根的路径，斜杠分隔 */
    relativePath: string;
    /** 有值表示这是某一条用例的节点 */
    caseIndex?: number;
}

interface RunTarget extends LeafInfo {
    /** 测试面板上要标记结果的节点：整文件跑时是文件节点，单用例跑时是用例节点 */
    item: vscode.TestItem;
}

/** 文件节点下的子用例 + runner 是否给了它逐用例结论（标记和结果块共用同一份） */
interface TargetCase {
    item: vscode.TestItem;
    info?: CaseVerdict;
    caseIndex?: number;
}

/** 扫描到的测试文件，解析结果在建树时复用，避免重复读盘 */
interface TestFileEntry {
    uri: vscode.Uri;
    document: vscode.TextDocument;
    parsed: ReturnType<typeof parseTestDocument>;
    relativePath: string;
}

export class NodeTestExplorer implements vscode.Disposable {
    private readonly controller: vscode.TestController;
    private readonly disposables: vscode.Disposable[] = [];
    /** 节点 id → 叶子信息。运行时只认这张表，不再靠解析 id 字符串 */
    private readonly leaves = new Map<string, LeafInfo>();
    private refreshTimer: NodeJS.Timeout | undefined;
    /** 插件已经销毁：迟到的事件（文件监听、300ms 防抖）不能再碰 vscode 对象，碰了会抛「已销毁」 */
    private disposed = false;
    /** 串行执行：一次测试运行里的多个批次/目标逐个跑，避免同时起一堆 MaaFW 进程 */
    private queue: Promise<void> = Promise.resolve();
    /** 探测阶段就报缺图：写用例时在 image 值下面直接画黄线，不用等跑完 */
    private readonly diagnostics = vscode.languages.createDiagnosticCollection("maaNodeTest");

    constructor(
        private readonly extensionPath: string,
        /** controller 显示名 → 截图目录名（loader 的别名映射）；不传就按同名处理 */
        private readonly resolveController: (controller: string) => string = (controller) => controller,
        /** 发现测试文件后，把它们的控制器组合交出去（用于后台预热节点索引） */
        private readonly onScopesDiscovered: (scopes: readonly (readonly string[])[]) => void = () => {},
    ) {
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
        this.disposed = true;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = undefined;
        this.diagnostics.dispose();
        for (const disposable of this.disposables) disposable.dispose();
        this.controller.dispose();
    }

    /** 重新扫描所有测试文件。清空后重建，保证和磁盘一致 */
    async refresh(): Promise<void> {
        if (this.disposed) return;
        this.controller.items.replace([]);
        this.leaves.clear();

        const workspaceRoot = resolveNodeTestWorkspace()?.workspaceRoot;
        if (!workspaceRoot) {
            // 没打开被测仓库时测试面板就是空的，不报错也不打扰
            return;
        }

        const entries = await this.collectTestFiles(workspaceRoot);
        // 扫盘期间插件被销毁（窗口关掉、扩展停用）就别接着往下建树了
        if (this.disposed) return;
        // 按路径排序，目录和文件的顺序才稳定（VS Code 不会帮我们排）
        entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

        const missing = this.reportMissingImages(entries);

        const dirItems = new Map<string, vscode.TestItem>();
        const dirCounts = new Map<string, number>();
        for (const entry of entries) this.addTestFile(entry, dirItems, dirCounts, missing.get(entry.relativePath));

        for (const [
            dirPath,
            item,
        ] of dirItems) {
            item.description = `含 ${dirCounts.get(dirPath) ?? 0} 个测试文件`;
        }

        // 顺手把这些文件声明的控制器组合交出去，让后台预热节点索引（不然第一次补全要等 350ms）
        this.onScopesDiscovered(entries.map((entry) => entry.parsed.configs.controller));
    }

    /** 扫出所有测试文件并解析；坏掉的 JSON 跳过并留一句警告，不影响整个面板 */
    private async collectTestFiles(workspaceRoot: string): Promise<TestFileEntry[]> {
        const entries: TestFileEntry[] = [];
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

                const relativePath = toPosix(path.relative(workspaceRoot, uri.fsPath));
                if (!isTestFilePath(relativePath)) continue;

                let document: vscode.TextDocument;
                try {
                    document = await vscode.workspace.openTextDocument(uri);
                } catch (error) {
                    console.warn(`[maa-node-test] 打不开 ${relativePath}：${String(error)}`);
                    continue;
                }

                const parsed = parseTestDocument(document.getText());
                if (parsed.problems.length > 0) {
                    console.warn(`[maa-node-test] ${relativePath} 的 JSON 有语法错误，先跳过不显示`);
                    continue;
                }

                entries.push({uri, document, parsed, relativePath});
            }
        }

        return entries;
    }

    /**
     * 探测阶段检查每个文件的截图是否齐全，并把结果画成诊断 + 返回给建树用。
     *
     * 为什么要在这儿做：`maa-tools` 遇到缺图只打印跳过、跳过即通过，等跑完看到的是绿的；
     * 写用例的时候在 image 值下面画一条黄线，比跑完再猜有效得多。
     */
    private reportMissingImages(entries: readonly TestFileEntry[]): Map<string, MissingImageWarning[]> {
        this.diagnostics.clear();
        const byFile = new Map<string, MissingImageWarning[]>();

        const workspace = resolveNodeTestWorkspace();
        if (!workspace) return byFile;

        // 同一个图片名在一批文件里反复出现，扫描结果缓存一下，别每个用例都去 readdir
        const cache = new Map<string, ReturnType<typeof locateImage>>();
        const locate = (image: string): ReturnType<typeof locateImage> => {
            const hit = cache.get(image);
            if (hit) return hit;
            const scanned = locateImage(workspace.testsetRoot, image);
            cache.set(image, scanned);
            return scanned;
        };

        for (const entry of entries) {
            const warnings = collectMissingImages({
                cases: entry.parsed.cases,
                controllers: entry.parsed.configs.controller,
                locate,
                resolvePlatform: this.resolveController,
            });
            if (warnings.length === 0) continue;

            byFile.set(entry.relativePath, warnings);
            this.diagnostics.set(
                entry.uri,
                warnings.map(
                    (warning) =>
                        new vscode.Diagnostic(
                            new vscode.Range(
                                entry.document.positionAt(warning.offset),
                                entry.document.positionAt(warning.offset + warning.length),
                            ),
                            describeMissingImage(warning),
                            vscode.DiagnosticSeverity.Warning,
                        ),
                ),
            );
        }

        return byFile;
    }

    /** 一个测试文件 → 目录节点（按需创建）+ 文件节点 + 用例节点 */
    private addTestFile(
        entry: TestFileEntry,
        dirItems: Map<string, vscode.TestItem>,
        dirCounts: Map<string, number>,
        missingImages?: readonly MissingImageWarning[],
    ): void {
        const segments = folderSegments(entry.relativePath);

        let parent: vscode.TestItemCollection = this.controller.items;
        let dirPath = "";
        for (const segment of segments) {
            dirPath = dirPath ? `${dirPath}/${segment}` : segment;
            dirCounts.set(dirPath, (dirCounts.get(dirPath) ?? 0) + 1);

            let dirItem = dirItems.get(dirPath);
            if (!dirItem) {
                dirItem = this.controller.createTestItem(`maaNodeTest#dir:${dirPath}`, segment);
                dirItem.canResolveChildren = false;
                dirItems.set(dirPath, dirItem);
                parent.add(dirItem);
            }
            parent = dirItem.children;
        }

        const fileNode = buildFileNode(entry.parsed, entry.uri.fsPath, entry.relativePath);
        const fileItem = this.controller.createTestItem(fileNode.id, fileNode.label, entry.uri);
        fileItem.description = missingImages?.length
            ? `${fileNode.description} · ${missingImages.length} 条用例缺图`
            : fileNode.description;
        fileItem.range = new vscode.Range(
            entry.document.positionAt(fileNode.start),
            entry.document.positionAt(fileNode.end),
        );
        fileItem.canResolveChildren = false;
        this.leaves.set(fileItem.id, {filePath: entry.uri.fsPath, relativePath: entry.relativePath});

        for (const caseNode of fileNode.cases) {
            const caseItem = this.controller.createTestItem(caseNode.id, caseNode.label, entry.uri);
            // 探测阶段就把缺图写进节点，跑之前一眼能看到
            const warning = missingImages?.find((item) => item.caseIndex === caseNode.caseIndex);
            caseItem.description = warning
                ? `${caseNode.description} · ${summarizeMissingImage(warning)}`
                : caseNode.description;
            caseItem.range = new vscode.Range(
                entry.document.positionAt(caseNode.start),
                entry.document.positionAt(caseNode.end),
            );
            fileItem.children.add(caseItem);
            this.leaves.set(caseItem.id, {
                filePath: entry.uri.fsPath,
                relativePath: entry.relativePath,
                caseIndex: caseNode.caseIndex,
            });
        }

        parent.add(fileItem);
    }

    private scheduleRefresh(): void {
        if (this.disposed) return;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        // 这里只能 clear，不能 dispose：诊断集合一旦 dispose 就永久作废，之后的 clear / set 都会抛
        // 「illegal state - object is disposed」，refresh 断在半路，面板被清空后建不回来。
        // dispose 归 dispose() 管，那是插件的生命周期终点。
        this.diagnostics.clear();
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
                    "没有打开工作区文件夹：先把放了 maatools.config.mts 的仓库作为工作区打开，再运行节点测试。",
                );
                return;
            }

            const roots = [...this.controller.items].map(
                ([
                    ,
                    item,
                ]) => item,
            );
            const targets = collectTargets(request, roots, this.leaves);
            if (targets.length === 0) {
                await vscode.window.showWarningMessage(
                    "测试面板里没有可运行的用例：确认 tests 目录下有 test_*.json，且 JSON 没有语法错误。",
                );
                return;
            }

            const config = readNodeTestConfig();
            const fileTargets = targets.filter((target) => target.caseIndex === undefined);
            const caseTargets = targets.filter((target) => target.caseIndex !== undefined);

            // 文件级目标合成一次进程（只有一个也是批）；单条用例仍然各自一个进程，保住精确判定
            if (fileTargets.length > 0) {
                if (token.isCancellationRequested) {
                    for (const target of fileTargets) testRun.skipped(target.item);
                } else {
                    await this.runFileBatch(testRun, fileTargets, workspace, config, token);
                }
            }

            for (const target of caseTargets) {
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

    /**
     * 一批文件级目标：一次进程跑完，再按 RESULT-FILE 行逐文件标记。
     * 只有一条用例级目标时才用 runTarget（那才有精确的单一结果）。
     */
    private async runFileBatch(
        testRun: vscode.TestRun,
        targets: readonly RunTarget[],
        workspace: NodeTestWorkspace,
        config: {nodePath: string; configPath: string},
        token: vscode.CancellationToken,
    ): Promise<void> {
        const relativePaths = targets.map((target) => target.relativePath);
        const title = relativePaths.length === 1 ? buildRunTitle(relativePaths[0]) : buildBatchRunTitle(relativePaths);
        const anchor = targets[0].item;

        // 文件节点和它的子用例都标成运行中，否则面板上会一直显示「未运行」
        const reportedItems = targets.flatMap((target) => [
            target.item,
            ...[...target.item.children].map(
                ([
                    ,
                    item,
                ]) => item,
            ),
        ]);
        for (const item of reportedItems) testRun.started(item);
        testRun.appendOutput(`▶ ${title}\r\n`, undefined, anchor);

        const runRequest: RunRequest = {
            workspaceRoot: workspace.workspaceRoot,
            nodePath: config.nodePath,
            configPath: config.configPath,
            testFile: targets[0].filePath,
            testFileRelativePath: targets[0].relativePath,
            testFiles: relativePaths.length > 1 ? targets.map((target) => target.filePath) : undefined,
            testFileRelativePaths: relativePaths.length > 1 ? relativePaths : undefined,
        };
        testRun.appendOutput(`${describeCommand(runRequest, this.extensionPath)}\r\n`, undefined, anchor);
        testRun.appendOutput(toOutputChunk(`${RAW_LOG_BANNER}\n`), undefined, anchor);

        const startedAt = Date.now();
        const verdicts = new Map<string, FileVerdict>();
        const caseVerdicts = new Map<string, CaseVerdict>();
        let pending = "";

        const process = startTestProcess(runRequest, this.extensionPath, {
            onOutput: (chunk) => {
                testRun.appendOutput(toOutputChunk(chunk), undefined, anchor);
                pending += chunk;
                const lines = pending.split("\n");
                pending = lines.pop() ?? "";
                for (const line of lines) {
                    collectFileVerdict(line, verdicts);
                    collectCaseVerdict(line, caseVerdicts);
                }
            },
            onError: (error) => testRun.appendOutput(`✖ 进程没起来：${String(error)}\r\n`, undefined, anchor),
        });
        const cancellation = token.onCancellationRequested(() => process.cancel());
        const outcome = await process.done;
        cancellation.dispose();
        collectFileVerdict(pending, verdicts);
        collectCaseVerdict(pending, caseVerdicts);
        const duration = Date.now() - startedAt;

        if (outcome.cancelled) {
            for (const item of reportedItems) testRun.skipped(item);
            appendRunSummary(testRun, anchor, {files: [], durationMs: duration, cancelled: true});
            return;
        }

        const summaryFiles: SummaryFile[] = [];
        for (const target of targets) {
            const verdict = verdicts.get(target.relativePath) ?? fallbackVerdict(outcome.code);
            const cases = this.casesOfTarget(target, caseVerdicts);
            summaryFiles.push({
                relativePath: target.relativePath,
                verdict,
                caseCount: cases.length,
                cases: problemCases(cases),
            });
            this.markFileTarget(testRun, target, verdict, duration, cases);
        }

        appendRunSummary(testRun, anchor, {files: summaryFiles, durationMs: duration});
    }

    /** 文件节点下的子用例 → 用例下标 + runner 给的结论；标记和结果块共用这一份 */
    private casesOfTarget(target: RunTarget, caseVerdicts: ReadonlyMap<string, CaseVerdict>): TargetCase[] {
        return [...target.item.children].map(
            ([
                id,
                item,
            ]) => {
                const leaf = this.leaves.get(id);
                const info =
                    leaf?.caseIndex === undefined
                        ? undefined
                        : caseVerdicts.get(caseKeyOf(target.relativePath, leaf.caseIndex));
                return {item, info, caseIndex: leaf?.caseIndex};
            },
        );
    }

    /**
     * 按文件结论标记。子用例优先用 runner 给的逐用例结论（带具体原因），没有就跟随文件结论。
     */
    private markFileTarget(
        testRun: vscode.TestRun,
        target: RunTarget,
        verdict: FileVerdict,
        duration: number,
        cases: readonly TargetCase[],
    ): void {
        // 标记规则在 core 里（纯函数，可单测）：文件通过不代表每条用例都验证过
        const marking = planFileMarking(
            target.relativePath,
            verdict,
            cases.map((entry) => ({caseIndex: entry.caseIndex, info: entry.info})),
        );

        applyMark(testRun, target.item, marking.file.verdict, marking.file.text, duration);
        for (const entry of cases) {
            const caseMark = marking.cases.find((candidate) => candidate.caseIndex === entry.caseIndex);
            if (!caseMark) {
                testRun.skipped(entry.item);
                continue;
            }
            applyMark(testRun, entry.item, caseMark.verdict, caseMark.text, duration);
        }
    }

    /** 跑单个用例：一次进程，退出码就是这一条的结果 */
    private async runTarget(
        testRun: vscode.TestRun,
        target: RunTarget,
        workspace: NodeTestWorkspace,
        config: {nodePath: string; configPath: string},
        token: vscode.CancellationToken,
    ): Promise<void> {
        const title = buildRunTitle(target.relativePath, target.caseIndex);
        testRun.started(target.item);
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
        testRun.appendOutput(toOutputChunk(`${RAW_LOG_BANNER}\n`), undefined, target.item);

        const startedAt = Date.now();
        const caseVerdicts = new Map<string, CaseVerdict>();
        let pending = "";
        const process = startTestProcess(runRequest, this.extensionPath, {
            onOutput: (chunk) => {
                testRun.appendOutput(toOutputChunk(chunk), undefined, target.item);
                pending += chunk;
                const lines = pending.split("\n");
                pending = lines.pop() ?? "";
                for (const line of lines) collectCaseVerdict(line, caseVerdicts);
            },
            onError: (error) => testRun.appendOutput(`✖ 进程没起来：${String(error)}\r\n`, undefined, target.item),
        });
        const cancellation = token.onCancellationRequested(() => process.cancel());
        const outcome = await process.done;
        cancellation.dispose();
        collectCaseVerdict(pending, caseVerdicts);
        const duration = Date.now() - startedAt;

        if (outcome.cancelled) {
            testRun.skipped(target.item);
            appendRunSummary(testRun, target.item, {files: [], durationMs: duration, cancelled: true});
            return;
        }

        const verdict = verdictFromExitCode(outcome.code);
        const known = caseVerdicts.get(caseKeyOf(target.relativePath, target.caseIndex ?? 0));
        if (verdict === "pass") {
            testRun.passed(target.item, duration);
        } else {
            // 单条用例跑时 runner 也会给逐用例结论，原因比通用话术有用得多
            const fallback = describeVerdict(verdict, title);
            const message = buildTestMessage(known?.title ?? fallback.title, known?.detail ?? fallback.detail);
            if (verdict === "fail") testRun.failed(target.item, message, duration);
            else testRun.errored(target.item, message, duration);
        }

        // 单条用例也补一块结果：形状和整文件跑一致，用户不用记两套读法
        appendRunSummary(testRun, target.item, {
            files: [
                {
                    relativePath: target.relativePath,
                    verdict,
                    caseCount: 1,
                    cases:
                        known && known.verdict !== "pass"
                            ? [{caseIndex: target.caseIndex, verdict: known.verdict, title: known.title}]
                            : [],
                },
            ],
            durationMs: duration,
        });
    }
}

/**
 * 挑出这次测试运行要跑的目标：
 *   - 没有 include（Run All）→ 所有根节点下的叶子；
 *   - include 是目录节点 → 它下面所有文件；
 *   - include 是文件节点 → 该文件；
 *   - include 是用例节点 → 只跑那一条。
 * 同一个文件既要求整文件、又要求单用例时，整文件优先，避免同一批用例跑两遍。
 */
export function collectTargets(
    request: vscode.TestRunRequest,
    rootItems: readonly vscode.TestItem[],
    leaves: ReadonlyMap<string, LeafInfo>,
): RunTarget[] {
    const excludedIds = new Set((request.exclude ?? []).map((item) => item.id));
    const isExcluded = (item: vscode.TestItem): boolean =>
        excludedIds.has(item.id) || (item.parent ? excludedIds.has(item.parent.id) : false);

    const included = request.include?.length ? request.include : rootItems;
    const fileTargets = new Map<string, RunTarget>();
    const caseTargets: RunTarget[] = [];

    const visit = (item: vscode.TestItem): void => {
        if (isExcluded(item)) return;

        const leaf = leaves.get(item.id);
        if (leaf) {
            if (leaf.caseIndex === undefined) {
                if (!fileTargets.has(leaf.filePath)) fileTargets.set(leaf.filePath, {...leaf, item});
            } else {
                caseTargets.push({...leaf, item});
            }
            return;
        }

        for (const [
            ,
            child,
        ] of item.children)
            visit(child);
    };

    for (const item of included) visit(item);

    // 整文件已经覆盖到的用例不再单独跑
    const deduped = caseTargets.filter((target) => !fileTargets.has(target.filePath));
    return [
        ...fileTargets.values(),
        ...deduped,
    ];
}

/**
 * 按结论把节点标成通过 / 失败 / 跳过。
 *
 * `skipped` 给「缺图没验证到」的用例用：这类情况不该把整次运行染红，标成灰色的跳过更贴近事实，
 * 具体原因在探测阶段就写进节点描述了。「哪几条因缺图跳过」由运行末尾的结果块统一列出，
 * 这里不再往每个通过节点上各追加一遍 —— 那会把测试输出刷成流水账。
 */
function applyMark(
    testRun: vscode.TestRun,
    item: vscode.TestItem,
    verdict: CaseOutcome,
    text: {title: string; detail: readonly string[]},
    duration: number,
): void {
    if (verdict === "skipped") {
        testRun.skipped(item);
        return;
    }
    if (verdict === "pass") {
        // VS Code 的 TestRun.passed 不接受消息；带明细的通过（缺图跳过）靠结果块说清楚
        testRun.passed(item, duration);
        return;
    }
    const message = buildTestMessage(text.title, text.detail);
    if (verdict === "fail") testRun.failed(item, message, duration);
    else testRun.errored(item, message, duration);
}

/** 原始日志前面的一条分隔：末尾才是结果块，中间这一大段是排错用的原始输出 */
const RAW_LOG_BANNER = "──── 原始日志（maa-tools 的输出，排错看这里） ────";

/** 文件节点下的子用例里，有问题的那几条才进结果块；通过的只计入数字 */
function problemCases(cases: readonly TargetCase[]): SummaryCase[] {
    const collected: SummaryCase[] = [];
    for (const entry of cases) {
        const info = entry.info;
        if (!info || info.verdict === "pass") continue;
        collected.push({caseIndex: entry.caseIndex, verdict: info.verdict, title: info.title});
    }
    return collected;
}

/** 在测试输出末尾补一块「结果」：结论一行、计数、耗时，然后只列有问题的地方 */
function appendRunSummary(
    testRun: vscode.TestRun,
    anchor: vscode.TestItem,
    input: {files: readonly SummaryFile[]; durationMs: number; cancelled?: boolean},
): void {
    const lines = buildRunSummary(input);
    testRun.appendOutput(toOutputChunk(`${lines.join("\n")}\n`), undefined, anchor);
}

/** 面板里的失败信息：标题用粗体一行，明细用列表（MarkdownString 才会按 Markdown 渲染） */
function buildTestMessage(title: string, detail: readonly string[]): vscode.TestMessage {
    return new vscode.TestMessage(new vscode.MarkdownString(buildMessageMarkdown(title, detail)));
}

/** TestRun.appendOutput 要求换行用 \r\n，否则测试输出面板里会挤成一坨 */
function toOutputChunk(chunk: string): string {
    return chunk.replace(/\r?\n/g, "\r\n");
}

function toPosix(target: string): string {
    return target.replace(/\\/g, "/");
}
