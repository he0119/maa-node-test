import {existsSync, realpathSync} from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

import {readNodeTestConfig, resolveNodeTestWorkspace} from "./config";
import {describeToolStatus, isToolVersion, type ToolLocation, type ToolStatus} from "./core/toolStatus";
import {
    MIN_MAA_TOOLS_VERSION,
    findMaaToolsCli,
    isMaaToolsVersionSupported,
    queryMaaToolsVersion,
    workspaceMaaToolsCli,
} from "./maatools/installation";

export const REFRESH_TOOL_VERSION_COMMAND = "maaNodeTest.refreshToolVersion";
const REFRESH_DELAY_MS = 250;

/** 始终显示当前被测仓库的版本；版本显示和兼容提示共用一次查询。 */
export class MaaToolsVersionStatus implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private readonly disposables: vscode.Disposable[] = [];
    private watchers: vscode.Disposable[] = [];
    private refreshTimer: NodeJS.Timeout | undefined;
    private sequence = 0;
    private disposed = false;
    private lastNotice = "";

    constructor(
        private readonly output: vscode.OutputChannel,
        private readonly queryVersion: typeof queryMaaToolsVersion = queryMaaToolsVersion,
    ) {
        this.item = vscode.window.createStatusBarItem("maaNodeTest.toolVersion", vscode.StatusBarAlignment.Left);
        this.item.name = "maa-tools 版本";
        this.item.command = REFRESH_TOOL_VERSION_COMMAND;
        this.disposables.push(
            vscode.commands.registerCommand(REFRESH_TOOL_VERSION_COMMAND, () => this.refresh()),
            vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (
                    event.affectsConfiguration("maaNodeTest.nodePath") ||
                    event.affectsConfiguration("maaNodeTest.configPath")
                ) {
                    void this.refresh();
                }
            }),
        );
        void this.refresh();
    }

    async refresh(): Promise<void> {
        if (this.disposed) return;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = undefined;
        const sequence = ++this.sequence;
        const workspace = resolveNodeTestWorkspace();
        const config = workspace ?? readNodeTestConfig();
        this.watchDependencies(workspace?.workspaceRoot, config.configPath);
        if (!workspace) {
            this.item.hide();
            return;
        }

        const cliPath = workspaceMaaToolsCli(workspace.workspaceRoot);
        const packageRoot = path.dirname(path.dirname(cliPath));
        // JSON 语言激活也会发生在普通项目中；没有被测配置或工具包时不占用状态栏。
        if (!existsSync(path.resolve(workspace.workspaceRoot, config.configPath)) && !existsSync(packageRoot)) {
            this.item.hide();
            return;
        }
        const location: ToolLocation = {
            workspaceRoot: workspace.workspaceRoot,
            cliPath,
            resolvedCliPath: actualPath(cliPath),
            nodePath: config.nodePath,
            configPath: config.configPath,
        };
        let installed;
        try {
            installed = findMaaToolsCli(workspace.workspaceRoot);
        } catch (error) {
            this.publish({kind: "missing", location, reason: error instanceof Error ? error.message : String(error)});
            return;
        }
        this.publish({kind: "checking", location});
        let queried: string | null = null;
        try {
            queried = await this.queryVersion(config.nodePath, cliPath);
        } catch {
            // 查询失败与旧 CLI 不支持 --version 一样，保留安装包版本供排错。
        }
        if (this.disposed || sequence !== this.sequence) return;

        const cliVersion = isToolVersion(queried) ? queried : undefined;
        const fromCli = cliVersion !== undefined;
        const version = cliVersion ?? (isToolVersion(installed.source.version) ? installed.source.version : undefined);
        const versionSource = fromCli ? "cli" : "package";
        const reason = fromCli
            ? undefined
            : "命令行版本查询失败，请检查 Node 路径及依赖是否完整；安装包声明的版本不代表命令可正常运行。";
        const kind = version && !isMaaToolsVersionSupported(version) ? "outdated" : fromCli ? "ready" : "unknown";
        this.publish({kind, location, version, versionSource, reason});
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        ++this.sequence;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = undefined;
        for (const watcher of this.watchers) watcher.dispose();
        this.watchers = [];
        for (const disposable of this.disposables) disposable.dispose();
        this.item.dispose();
    }

    private publish(status: ToolStatus): void {
        if (this.disposed) return;
        const presentation = describeToolStatus(status, MIN_MAA_TOOLS_VERSION);
        this.item.text = presentation.text;
        this.item.tooltip = presentation.tooltip;
        this.item.show();
        if (status.kind === "checking") return;
        const notice = JSON.stringify(status);
        if (notice === this.lastNotice) return;
        this.lastNotice = notice;
        this.output.appendLine(`${presentation.text.replace(/\$\([^)]*\)\s*/g, "")}\n${presentation.tooltip}`);
        if (status.kind === "outdated") {
            void vscode.window.showWarningMessage(
                `maa-tools ${status.version} 版本太旧，节点测试需要 ${MIN_MAA_TOOLS_VERSION} 及以上。请检查并更新被测仓库的 @nekosu/maa-tools 依赖版本和锁文件，再执行 pnpm install。`,
            );
        }
    }

    private scheduleRefresh(): void {
        if (this.disposed) return;
        // 防抖等待期间也使旧查询失效，避免依赖已变却显示迟到的旧版本。
        ++this.sequence;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined;
            void this.refresh();
        }, REFRESH_DELAY_MS);
    }

    private watchDependencies(workspaceRoot: string | undefined, configPath: string): void {
        for (const watcher of this.watchers) watcher.dispose();
        this.watchers = [];
        const files = new Set<string>();
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            if (folder.uri.scheme === "file") files.add(path.resolve(folder.uri.fsPath, configPath));
        }
        if (workspaceRoot) {
            for (const file of [
                "package.json",
                "pnpm-lock.yaml",
                "pnpm-workspace.yaml",
                "package-lock.json",
                "yarn.lock",
                "node_modules",
                "node_modules/.modules.yaml",
                "node_modules/.pnpm/lock.yaml",
                "node_modules/@nekosu",
                "node_modules/@nekosu/maa-tools",
            ])
                files.add(path.join(workspaceRoot, file));
            const cliPath = workspaceMaaToolsCli(workspaceRoot);
            const packageRoot = path.dirname(path.dirname(cliPath));
            for (const root of new Set([
                packageRoot,
                actualPath(packageRoot),
            ])) {
                if (!root) continue;
                for (const file of [
                    "package.json",
                    "bin",
                    "bin/maa-tools",
                    "dist",
                    "dist/index.mjs",
                ])
                    files.add(path.join(root, file));
            }
            const realCli = actualPath(cliPath);
            if (realCli) files.add(realCli);
        }
        // 精确监听文件及安装目录本身；不使用可能被 node_modules 排除规则忽略的递归 glob。
        for (const file of files) {
            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(path.dirname(file), path.basename(file)),
            );
            this.watchers.push(
                watcher,
                watcher.onDidCreate(() => this.scheduleRefresh()),
                watcher.onDidChange(() => this.scheduleRefresh()),
                watcher.onDidDelete(() => this.scheduleRefresh()),
            );
        }
    }
}

function actualPath(file: string): string | undefined {
    try {
        return realpathSync(file);
    } catch {
        return undefined;
    }
}
