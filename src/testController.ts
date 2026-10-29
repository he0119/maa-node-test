import * as vscode from "vscode";
import {readNodeTestConfig, resolveNodeTestWorkspace} from "./config";
import type {NodeTestWorkspace} from "./config";
import {parseTestDocument} from "./core/document";
import {collectMissingImages, describeMissingImage, summarizeMissingImage} from "./core/missingImages";
import type {MissingImageWarning} from "./core/missingImages";
import {locateImage} from "./core/screenshots";
import {buildMessageMarkdown, planFileMarking, caseKeyOf, missingCaseVerdict} from "./core/testMarks";
import type {CaseOutcome, CaseVerdict, FileVerdict, VerdictText} from "./core/testMarks";
import {buildBatchRunTitle, buildRunSummary, buildRunTitle} from "./core/runSummary";
import type {SummaryFile, SummaryInput} from "./core/runSummary";
import {buildFileNode, collectRunTargets, folderSegments} from "./core/testTree";
import {adaptResultFiles, caseInfoToVerdict} from "./maatools/resultAdapter";
import {collectTests, type ListFileEntry} from "./maatools/collect";
import {displayPath, pathKey, resolveFromWorkspace} from "./core/paths";
import type {TestRunEvent} from "./maatools/protocol";
import {describeCommand, startTestRun} from "./testRunner";
import type {MaaToolsRunOutcome, RunRequest} from "./testRunner";

/**
 * 测试面板：调用 maa-tools 收集测试，按目录、文件、用例建树，再显示结构化运行结果。
 * 无排除项的文件合成一次运行；排除了部分用例的文件只运行剩余用例。
 * 识别结论由 maa-tools 提供，面板只检查所选用例是否都有结果。
 */

/** 命令面板里的「刷新测试面板」。测试面板自己也有刷新按钮，这个命令方便用快捷键触发 */
export const REFRESH_TESTS_COMMAND = "maaNodeTest.refreshTests";

/** 文件或用例节点的运行信息。 */
interface LeafInfo {
    /** 测试文件绝对路径 */
    filePath: string;
    /** 显示路径：仓库内为相对路径，仓库外保留绝对路径。 */
    relativePath: string;
    /** 有值表示这是某一条用例的节点 */
    caseIndex?: number;
    /** 收集失败的文件单独报错，不阻止其它文件运行。 */
    collectionError?: string;
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

/** 一次运行保存自己的节点和状态，不受运行期间刷新面板影响。 */
interface RunState {
    casesByTarget: Map<string, readonly TargetCase[]>;
    started: Set<string>;
    completed: Set<string>;
}

/** 收集到的测试文件：树以 maa-tools 的收集结果为准；本地解析只为缺图诊断 */
interface TestFileEntry {
    uri: vscode.Uri;
    /** 已由收集适配层归一化的显示路径。 */
    relativePath: string;
    /** maa-tools test --list --json 的收集结果 */
    collected: ListFileEntry;
    /** 以下两项只服务缺图诊断（画黄线要 image 值的精确偏移）；文件读不了或解析失败就没有 */
    document?: vscode.TextDocument;
    parsed?: ReturnType<typeof parseTestDocument>;
}

export class NodeTestExplorer implements vscode.Disposable {
    private readonly controller: vscode.TestController;
    private readonly disposables: vscode.Disposable[] = [];
    /** 节点 id → 叶子信息。运行时只认这张表，不再靠解析 id 字符串 */
    private readonly leaves = new Map<string, LeafInfo>();
    private refreshTimer: NodeJS.Timeout | undefined;
    /** 只有最新一次收集能更新面板，避免慢的旧请求覆盖新结果。 */
    private refreshSequence = 0;
    /** 插件销毁后，迟到的收集结果不再访问 VS Code 对象。 */
    private disposed = false;
    /** 串行执行：一次测试运行里的多个批次/目标逐个跑，避免同时起一堆 MaaFW 进程 */
    private queue: Promise<void> = Promise.resolve();
    /** 探测阶段就报缺图：写用例时在 image 值下面直接画黄线，不用等跑完 */
    private readonly diagnostics = vscode.languages.createDiagnosticCollection("maaNodeTest");

    constructor(
        /** controller 显示名 → 截图目录名（loader 的别名映射）；不传就按同名处理 */
        private readonly resolveController: (controller: string) => string = (controller) => controller,
        /** 发现测试文件后，把它们的控制器组合交出去（用于后台预热节点索引） */
        private readonly onScopesDiscovered: (scopes: readonly (readonly string[])[]) => void = () => {},
    ) {
        // 显示名跟扩展在商店里的名字用同一个：面板这一行就是「这批节点是哪个插件加的」，
        // 名字不一致时用户拿着它去扩展列表里对不上号
        this.controller = vscode.tests.createTestController("maaNodeTest", "Maa Node Test");
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
        this.refreshSequence++;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = undefined;
        this.diagnostics.dispose();
        for (const disposable of this.disposables) disposable.dispose();
        this.controller.dispose();
    }

    /** 按当前配置重新收集测试并重建面板，只应用最新一次收集结果。 */
    async refresh(): Promise<void> {
        if (this.disposed) return;
        const sequence = ++this.refreshSequence;
        this.controller.items.replace([]);
        this.leaves.clear();
        this.diagnostics.clear();

        const workspaceRoot = resolveNodeTestWorkspace()?.workspaceRoot;
        if (!workspaceRoot) {
            // 没打开被测仓库时测试面板就是空的，不报错也不打扰
            return;
        }

        const entries = await this.collectTestFiles(workspaceRoot, sequence);
        if (!this.isCurrentRefresh(sequence)) return;
        // 按路径排序，目录和文件的顺序才稳定（VS Code 不会帮我们排）
        entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

        const missing = this.reportMissingImages(entries);

        for (const entry of entries) this.addTestFile(entry, missing.get(entry.relativePath));

        // 顺手把这些文件声明的控制器组合交出去，让后台预热节点索引（不然第一次补全要等 350ms）
        this.onScopesDiscovered(entries.map((entry) => entry.collected.controllers));
    }

    /**
     * 发现测试时调用 maa-tools test --list --json，并传入与运行相同的配置路径。
     * 本地解析只为编辑时的缺图提示，不决定能运行哪些测试。
     */
    private async collectTestFiles(workspaceRoot: string, sequence: number): Promise<TestFileEntry[]> {
        const config = readNodeTestConfig();
        const {doc, stderr} = await collectTests({
            workspaceRoot,
            nodePath: config.nodePath,
            configPath: config.configPath,
        });
        if (!this.isCurrentRefresh(sequence)) return [];
        if (!doc) {
            console.warn(`[maa-node-test] 测试收集失败：${stderr}`);
            const firstLine = stderr.trim().split(/\r?\n/, 1)[0] || "maa-tools 未提供错误说明";
            const reason = firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
            void vscode.window.showWarningMessage(
                `节点测试收集失败：${reason}。请检查 maaNodeTest.configPath 和被测仓库的依赖。`,
            );
            return [];
        }

        const entries: TestFileEntry[] = [];
        for (const file of doc.files) {
            if (!this.isCurrentRefresh(sequence)) return [];
            const entry: TestFileEntry = {
                uri: vscode.Uri.file(resolveFromWorkspace(workspaceRoot, file.file)),
                relativePath: file.file,
                collected: file,
            };
            if (!file.error) {
                try {
                    const document = await vscode.workspace.openTextDocument(entry.uri);
                    if (!this.isCurrentRefresh(sequence)) return [];
                    const parsed = parseTestDocument(document.getText());
                    if (parsed.problems.length === 0) {
                        entry.document = document;
                        entry.parsed = parsed;
                    }
                } catch (error) {
                    console.warn(`[maa-node-test] 打不开 ${file.file}：${String(error)}`);
                }
            }
            entries.push(entry);
        }
        return entries;
    }

    /** 编辑时按 testsetDir 目录约定检查缺图，提前提示；实际运行路径以 maa-tools 结果为准。 */
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
            if (!entry.parsed || !entry.document) continue;
            const {parsed, document} = entry;
            const warnings = collectMissingImages({
                cases: parsed.cases,
                controllers: parsed.configs.controller,
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
                                document.positionAt(warning.offset),
                                document.positionAt(warning.offset + warning.length),
                            ),
                            describeMissingImage(warning),
                            vscode.DiagnosticSeverity.Warning,
                        ),
                ),
            );
        }

        return byFile;
    }

    /**
     * 一个测试文件 → 目录节点（按需创建）+ 文件节点 + 用例节点。
     * 目录节点只写目录名，不加「含 N 个测试文件」的灰字：图标已经能看出有没有测试，
     * 灰字只会把一行行目录挤长，信息却没有用。
     */
    private addTestFile(entry: TestFileEntry, missingImages?: readonly MissingImageWarning[]): void {
        const segments = folderSegments(entry.relativePath);

        let parent: vscode.TestItemCollection = this.controller.items;
        let dirPath = "";
        for (const segment of segments) {
            dirPath = dirPath ? `${dirPath}/${segment}` : segment;

            // 目录节点 id 只由层级路径决定，所以直接在父节点里按 id 找，不用另外记一张表
            const dirId = `maaNodeTest#dir:${pathKey(dirPath)}`;
            let dirItem = parent.get(dirId);
            if (!dirItem) {
                dirItem = this.controller.createTestItem(dirId, segment);
                dirItem.canResolveChildren = false;
                parent.add(dirItem);
            }
            parent = dirItem.children;
        }

        const fileNode = buildFileNode(entry.collected, entry.uri.fsPath);
        // 收集结果的偏移要靠 TextDocument 映射成行列；打不开文档就退化成文件开头
        const toRange = (start: number, end: number) =>
            entry.document
                ? new vscode.Range(entry.document.positionAt(start), entry.document.positionAt(end))
                : new vscode.Range(0, 0, 0, 0);
        const fileItem = this.controller.createTestItem(fileNode.id, fileNode.label, entry.uri);
        fileItem.description = [
            fileNode.description,
            missingImages?.length ? `${missingImages.length} 条用例缺图` : "",
        ]
            .filter(Boolean)
            .join(" · ");
        fileItem.range = toRange(fileNode.start, fileNode.end);
        fileItem.canResolveChildren = false;
        fileItem.error = fileNode.error;
        this.leaves.set(fileItem.id, {
            filePath: entry.uri.fsPath,
            relativePath: entry.relativePath,
            collectionError: fileNode.error,
        });

        for (const caseNode of fileNode.cases) {
            const caseItem = this.controller.createTestItem(caseNode.id, caseNode.label, entry.uri);
            // 探测阶段就把缺图写进节点，跑之前一眼能看到
            const warning = missingImages?.find((item) => item.caseIndex === caseNode.caseIndex);
            caseItem.description = [
                caseNode.description,
                warning ? summarizeMissingImage(warning) : "",
            ]
                .filter(Boolean)
                .join(" · ");
            caseItem.range = toRange(caseNode.start, caseNode.end);
            fileItem.children.add(caseItem);
            this.leaves.set(caseItem.id, {
                filePath: entry.uri.fsPath,
                relativePath: entry.relativePath,
                caseIndex: caseNode.caseIndex,
            });
        }

        parent.add(fileItem);
    }

    private isCurrentRefresh(sequence: number): boolean {
        return !this.disposed && sequence === this.refreshSequence;
    }

    private scheduleRefresh(): void {
        if (this.disposed) return;
        this.refreshSequence++;
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
            const targets = collectRunTargets(request, roots, this.leaves);
            if (targets.length === 0) {
                await vscode.window.showWarningMessage(
                    "当前选择没有可运行的测试。请检查排除项，并刷新测试面板确认配置收集到了所需文件和用例。",
                );
                return;
            }

            const state = this.prepareRun(testRun, targets);
            if (token.isCancellationRequested) {
                skipUnfinished(
                    testRun,
                    targets.flatMap((target) => targetItems(target, state)),
                    state,
                );
                appendRunSummary(testRun, targets[0].item, {files: [], durationMs: 0, cancelled: true});
                return;
            }
            const config = readNodeTestConfig();
            const fileTargets = targets.filter((target) => target.caseIndex === undefined);
            const caseTargets = targets.filter((target) => target.caseIndex !== undefined);

            // 完整文件合并运行；单条选择和排除后剩余的用例逐条运行。
            if (fileTargets.length > 0) {
                if (token.isCancellationRequested) {
                    skipUnfinished(
                        testRun,
                        fileTargets.flatMap((target) => targetItems(target, state)),
                        state,
                    );
                } else {
                    await this.runFileBatch(testRun, fileTargets, workspace, config, token, state);
                }
            }

            for (const target of caseTargets) {
                if (token.isCancellationRequested) {
                    skipUnfinished(testRun, [target.item], state);
                    continue;
                }
                await this.runTarget(testRun, target, workspace, config, token, state);
            }
        } finally {
            testRun.end();
        }
    }

    private prepareRun(testRun: vscode.TestRun, targets: readonly RunTarget[]): RunState {
        const state: RunState = {casesByTarget: new Map(), started: new Set(), completed: new Set()};
        const queued = new Set<string>();
        for (const target of targets) {
            const cases =
                target.caseIndex === undefined
                    ? [...target.item.children].map(
                          ([
                              id,
                              item,
                          ]) => ({item, caseIndex: this.leaves.get(id)?.caseIndex}),
                      )
                    : [];
            state.casesByTarget.set(target.item.id, cases);
            for (const item of targetItems(target, state)) {
                if (queued.has(item.id)) continue;
                testRun.enqueued(item);
                queued.add(item.id);
            }
        }
        return state;
    }

    /** 只接收适配层已经校验的进度；用例快照不能提前结束整个文件。 */
    private reportProgress(
        testRun: vscode.TestRun,
        targets: readonly RunTarget[],
        workspaceRoot: string,
        state: RunState,
        event: TestRunEvent,
    ): void {
        if (this.disposed) return;
        const file = event.type === "file-result" ? event.file : event.origin.file;
        const key = pathKey(displayPath(workspaceRoot, file));
        const target = targets.find((candidate) => pathKey(candidate.relativePath) === key);
        if (!target) return;
        if (event.type === "case-started") {
            const item =
                target.caseIndex === undefined
                    ? state.casesByTarget.get(target.item.id)?.find((entry) => entry.caseIndex === event.origin.case)
                          ?.item
                    : target.item;
            if (item) {
                startItem(testRun, target.item, state);
                startItem(testRun, item, state);
            }
            return;
        }
        const adapted = adaptResultFiles(event.result, workspaceRoot);
        const caseVerdicts = buildCaseVerdicts(adapted);
        if (event.type === "file-result" && target.caseIndex === undefined) {
            const verdict = adapted.fileResults.get(key) ?? "error";
            this.markFileTarget(
                testRun,
                target,
                verdict,
                this.casesOfTarget(target, caseVerdicts, state),
                state,
                reasonText(adapted.fileReasons.get(key), verdict),
            );
        } else {
            this.markKnownCases(testRun, target, caseVerdicts, state);
        }
    }

    /** 取消时也保留已校验的完成结果，其它节点才标跳过。 */
    private markCompletedResults(
        testRun: vscode.TestRun,
        targets: readonly RunTarget[],
        outcome: MaaToolsRunOutcome,
        state: RunState,
    ): void {
        const caseVerdicts = buildCaseVerdicts(outcome);
        for (const target of targets) {
            const verdict = fileVerdictOf(outcome, target.relativePath);
            if (target.caseIndex === undefined && verdict !== undefined) {
                this.markFileTarget(
                    testRun,
                    target,
                    verdict,
                    this.casesOfTarget(target, caseVerdicts, state),
                    state,
                    reasonText(outcome.fileReasons.get(pathKey(target.relativePath)), verdict),
                );
            } else {
                this.markKnownCases(testRun, target, caseVerdicts, state);
            }
        }
    }

    private markKnownCases(
        testRun: vscode.TestRun,
        target: RunTarget,
        verdicts: ReadonlyMap<string, CaseVerdict>,
        state: RunState,
    ): void {
        const cases =
            target.caseIndex === undefined
                ? this.casesOfTarget(target, verdicts, state)
                : [
                      {
                          item: target.item,
                          caseIndex: target.caseIndex,
                          info: verdicts.get(caseKeyOf(target.relativePath, target.caseIndex)),
                      },
                  ];
        for (const entry of cases) {
            if (entry.info)
                completeItem(testRun, entry.item, entry.info.verdict, entry.info, entry.info.durationMs, state);
        }
    }

    /** 收集失败的文件单独报错，其它完整文件合成一次运行，再逐文件和用例显示结果。 */
    private async runFileBatch(
        testRun: vscode.TestRun,
        targets: readonly RunTarget[],
        workspace: NodeTestWorkspace,
        config: {nodePath: string; configPath: string},
        token: vscode.CancellationToken,
        state: RunState,
    ): Promise<void> {
        const startedAt = Date.now();
        const anchor = targets[0].item;
        const summaryFiles: SummaryFile[] = [];
        const runnable = targets.filter((target) => !target.collectionError);
        for (const target of targets) {
            if (!target.collectionError) continue;
            const text = {title: "读取测试文件失败", detail: [target.collectionError]};
            testRun.appendOutput(`✖ ${target.relativePath}：${target.collectionError}\r\n`, undefined, target.item);
            summaryFiles.push(
                this.markFileTarget(
                    testRun,
                    target,
                    "error",
                    this.casesOfTarget(target, new Map(), state),
                    state,
                    text,
                ),
            );
        }
        if (runnable.length === 0) {
            appendRunSummary(testRun, anchor, {files: summaryFiles, durationMs: Date.now() - startedAt});
            return;
        }

        const relativePaths = runnable.map((target) => target.relativePath);
        const title = relativePaths.length === 1 ? buildRunTitle(relativePaths[0]) : buildBatchRunTitle(relativePaths);
        const reportedItems = runnable.flatMap((target) => targetItems(target, state));
        testRun.appendOutput(`▶ ${title}\r\n`, undefined, anchor);

        const runRequest: RunRequest = {
            workspaceRoot: workspace.workspaceRoot,
            nodePath: config.nodePath,
            configPath: config.configPath,
            testFiles: relativePaths,
            expectedCases: new Map(
                runnable.map((target) => [
                    target.relativePath,
                    this.casesOfTarget(target, new Map(), state).flatMap((entry) =>
                        entry.caseIndex === undefined ? [] : [entry.caseIndex],
                    ),
                ]),
            ),
        };
        testRun.appendOutput(`${describeCommand(runRequest)}\r\n`, undefined, anchor);
        testRun.appendOutput(toOutputChunk(`${RAW_LOG_BANNER}\n`), undefined, anchor);

        const process = startTestRun(runRequest, {
            onOutput: (chunk) => testRun.appendOutput(toOutputChunk(chunk), undefined, anchor),
            onError: (error) => testRun.appendOutput(`✖ 进程没起来：${String(error)}\r\n`, undefined, anchor),
            onProgress: (event) => this.reportProgress(testRun, runnable, workspace.workspaceRoot, state, event),
        });
        const cancellation = token.onCancellationRequested(() => process.cancel());
        const outcome = await process.done;
        cancellation.dispose();
        const duration = Date.now() - startedAt;

        const invalidResult = outcome.errorCode === "invalid-result";
        if (outcome.cancelled && !invalidResult) {
            this.markCompletedResults(testRun, runnable, outcome, state);
            skipUnfinished(testRun, reportedItems, state);
            appendRunSummary(testRun, anchor, {files: [], durationMs: duration, cancelled: true});
            return;
        }

        const caseVerdicts = invalidResult ? new Map<string, CaseVerdict>() : buildCaseVerdicts(outcome);
        for (const target of runnable) {
            const knownVerdict = invalidResult ? undefined : fileVerdictOf(outcome, target.relativePath);
            const verdict = knownVerdict ?? "error";
            const cases = this.casesOfTarget(target, caseVerdicts, state);
            const reason =
                outcome.fileReasons.get(pathKey(target.relativePath)) ??
                (knownVerdict === undefined ? (outcome.error ?? outcome.empty) : undefined);
            summaryFiles.push(
                this.markFileTarget(testRun, target, verdict, cases, state, reasonText(reason, verdict), invalidResult),
            );
        }

        appendRunSummary(testRun, anchor, {
            files: summaryFiles,
            durationMs: duration,
            error: outcome.error,
        });
    }

    /** 用运行开始时保存的节点和原始下标，匹配已校验的用例结果。 */
    private casesOfTarget(
        target: RunTarget,
        caseVerdicts: ReadonlyMap<string, CaseVerdict>,
        state: RunState,
    ): TargetCase[] {
        return (state.casesByTarget.get(target.item.id) ?? []).map((entry) => ({
            ...entry,
            info:
                entry.caseIndex === undefined
                    ? undefined
                    : caseVerdicts.get(caseKeyOf(target.relativePath, entry.caseIndex)),
        }));
    }

    /**
     * 文件和用例都使用各自的结果；缺少用例结果时报 error。
     * 节点显示识别耗时，文件耗时为子用例之和；整次运行的墙钟时间只在结果摘要中显示。
     */
    private markFileTarget(
        testRun: vscode.TestRun,
        target: RunTarget,
        verdict: FileVerdict,
        cases: readonly TargetCase[],
        state: RunState,
        fileText?: VerdictText,
        invalidate = false,
    ): SummaryFile {
        const marking = planFileMarking(
            target.relativePath,
            verdict,
            cases.map((entry) => ({caseIndex: entry.caseIndex, info: entry.info})),
            fileText,
        );

        const recoDurationMs = cases.reduce((sum, entry) => sum + (entry.info?.durationMs ?? 0), 0);
        completeItem(testRun, target.item, marking.file.verdict, marking.file.text, recoDurationMs, state, invalidate);
        for (const entry of cases) {
            const caseMark = marking.cases.find((candidate) => candidate.caseIndex === entry.caseIndex);
            const text = caseMark?.text ?? missingCaseVerdict(target.relativePath, entry.caseIndex);
            completeItem(
                testRun,
                entry.item,
                caseMark?.verdict ?? "error",
                text,
                entry.info?.durationMs ?? 0,
                state,
                invalidate,
            );
        }
        return {
            relativePath: target.relativePath,
            verdict: marking.file.verdict,
            caseCount: cases.length,
            cases: marking.cases.map((entry) => ({
                caseIndex: entry.caseIndex,
                verdict: entry.verdict,
                title: entry.text.title,
            })),
            reason: fileText?.detail.join("；"),
        };
    }

    /** 跑单个用例：单独起一次 maa-tools，只跑这一条 */
    private async runTarget(
        testRun: vscode.TestRun,
        target: RunTarget,
        workspace: NodeTestWorkspace,
        config: {nodePath: string; configPath: string},
        token: vscode.CancellationToken,
        state: RunState,
    ): Promise<void> {
        const title = buildRunTitle(target.relativePath, target.caseIndex);
        testRun.appendOutput(`▶ ${title}\r\n`, undefined, target.item);

        const runRequest: RunRequest = {
            workspaceRoot: workspace.workspaceRoot,
            nodePath: config.nodePath,
            configPath: config.configPath,
            testFiles: [target.relativePath],
            caseIndex: target.caseIndex,
            expectedCases: new Map([
                [
                    target.relativePath,
                    target.caseIndex === undefined ? [] : [target.caseIndex],
                ],
            ]),
        };
        testRun.appendOutput(`${describeCommand(runRequest)}\r\n`, undefined, target.item);
        testRun.appendOutput(toOutputChunk(`${RAW_LOG_BANNER}\n`), undefined, target.item);

        const startedAt = Date.now();
        const process = startTestRun(runRequest, {
            onOutput: (chunk) => testRun.appendOutput(toOutputChunk(chunk), undefined, target.item),
            onError: (error) => testRun.appendOutput(`✖ 进程没起来：${String(error)}\r\n`, undefined, target.item),
            onProgress: (event) => this.reportProgress(testRun, [target], workspace.workspaceRoot, state, event),
        });
        const cancellation = token.onCancellationRequested(() => process.cancel());
        const outcome = await process.done;
        cancellation.dispose();
        const duration = Date.now() - startedAt;

        const invalidResult = outcome.errorCode === "invalid-result";
        if (outcome.cancelled && !invalidResult) {
            this.markCompletedResults(testRun, [target], outcome, state);
            skipUnfinished(testRun, [target.item], state);
            appendRunSummary(testRun, target.item, {files: [], durationMs: duration, cancelled: true});
            return;
        }

        const known = invalidResult
            ? undefined
            : buildCaseVerdicts(outcome).get(caseKeyOf(target.relativePath, target.caseIndex ?? 0));
        const reason = outcome.error ?? outcome.empty;
        const info = known ?? missingCaseVerdict(target.relativePath, target.caseIndex, reasonText(reason));
        completeItem(testRun, target.item, info.verdict, info, info.durationMs, state, invalidResult);

        // 用例可以跳过，而文件仍为 error（例如全缺图）；两层结论分别显示上游原值。
        appendRunSummary(testRun, target.item, {
            files: [
                {
                    relativePath: target.relativePath,
                    verdict: known ? (fileVerdictOf(outcome, target.relativePath) ?? "error") : "error",
                    caseCount: 1,
                    cases: [{caseIndex: target.caseIndex, verdict: info.verdict, title: info.title}],
                    reason: reason ?? outcome.fileReasons.get(pathKey(target.relativePath)),
                },
            ],
            durationMs: duration,
            error: reason,
        });
    }
}

function targetItems(target: RunTarget, state: RunState): vscode.TestItem[] {
    return [
        target.item,
        ...(state.casesByTarget.get(target.item.id) ?? []).map((entry) => entry.item),
    ];
}

function startItem(testRun: vscode.TestRun, item: vscode.TestItem, state: RunState): void {
    if (state.completed.has(item.id) || state.started.has(item.id)) return;
    testRun.started(item);
    state.started.add(item.id);
}

/** 已完成的节点不重复标记；协议错误时才覆盖先前结果。 */
function completeItem(
    testRun: vscode.TestRun,
    item: vscode.TestItem,
    verdict: CaseOutcome,
    text: {title: string; detail: readonly string[]},
    duration: number,
    state: RunState,
    invalidate = false,
): void {
    if (!invalidate && state.completed.has(item.id)) return;
    applyMark(testRun, item, verdict, text, duration);
    state.completed.add(item.id);
}

function skipUnfinished(testRun: vscode.TestRun, items: readonly vscode.TestItem[], state: RunState): void {
    for (const item of items) completeItem(testRun, item, "skipped", {title: "已取消", detail: []}, 0, state);
}

/** 把结构化结论转成 VS Code 标记；跳过原因在结果摘要中列出。 */
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

/** 在测试输出末尾补一块「结果」：结论一行、计数、耗时，然后只列有问题的地方 */
function appendRunSummary(testRun: vscode.TestRun, anchor: vscode.TestItem, input: SummaryInput): void {
    const lines = buildRunSummary(input);
    testRun.appendOutput(toOutputChunk(`${lines.join("\n")}\n`), undefined, anchor);
}

/** 面板里的失败信息：标题用粗体一行，明细用列表（MarkdownString 才会按 Markdown 渲染） */
function buildTestMessage(title: string, detail: readonly string[]): vscode.TestMessage {
    return new vscode.TestMessage(new vscode.MarkdownString(buildMessageMarkdown(title, detail)));
}

/** 逐用例显示文案；键已由 adapter 统一成相对路径和原始下标。 */
function buildCaseVerdicts(outcome: Pick<MaaToolsRunOutcome, "caseResults">): Map<string, CaseVerdict> {
    return new Map(
        [...outcome.caseResults].map(
            ([
                key,
                info,
            ]) => [
                key,
                caseInfoToVerdict(info),
            ],
        ),
    );
}

function reasonText(reason: string | undefined, verdict: FileVerdict = "error"): VerdictText | undefined {
    if (!reason) return undefined;
    return {
        title:
            verdict === "fail"
                ? "断言失败"
                : verdict === "pass"
                  ? "通过"
                  : verdict === "skipped"
                    ? "筛选跳过"
                    : "没有完成验证",
        detail: [reason],
    };
}

/** 文件键口径：相对路径统一正斜杠，和归位结果的键对齐 */
function fileVerdictOf(outcome: MaaToolsRunOutcome, relativePath: string): FileVerdict | undefined {
    return outcome.fileResults.get(pathKey(relativePath));
}

function toOutputChunk(chunk: string): string {
    return chunk.replace(/\r?\n/g, "\r\n");
}
