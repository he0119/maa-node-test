// 测试发现调用 maa-tools test --list --json 获取结构化清单，并使用与运行相同的配置。
// 上游返回实际加载的文件、原始用例下标和源码偏移；扩展检查完整结构后转换显示路径。

import {DEFAULT_CONFIG, buildMaaToolsArgs} from "./command";
import {MaaToolsLoadError, findMaaToolsCli, requireSupportedMaaTools} from "./installation";
import {runChild} from "./process";
import {displayPath} from "../core/paths";
import {ResultFormatError, validateListDocument, type ListDocument} from "./protocol";

export type {ListCase, ListDocument, ListFileEntry} from "./protocol";

export interface TestCollectionRequest {
    workspaceRoot: string;
    nodePath: string;
    configPath?: string;
    files?: readonly string[];
    onOutput?: (chunk: string) => void;
}

export async function collectTests(
    request: TestCollectionRequest,
): Promise<{doc: ListDocument | null; stderr: string}> {
    let cli;
    try {
        cli = findMaaToolsCli(request.workspaceRoot);
        requireSupportedMaaTools(cli.source);
    } catch (error) {
        if (error instanceof MaaToolsLoadError) return {doc: null, stderr: error.message};
        throw error;
    }
    const args = buildMaaToolsArgs({
        cliPath: cli.cliPath,
        configPath: request.configPath ?? DEFAULT_CONFIG,
        testFiles: request.files ?? [],
        mode: "list",
    });
    const run = await runChild(request.workspaceRoot, request.nodePath, args, (chunk) => request.onOutput?.(chunk));
    if (run.spawnError) return {doc: null, stderr: `maa-tools 收集进程无法启动：${String(run.spawnError)}`};
    if (run.signal) return {doc: null, stderr: `maa-tools 收集进程被信号 ${run.signal} 终止`};
    try {
        const parsed = validateListDocument(run.parsed);
        if (parsed.errorCode) {
            return {
                doc: null,
                stderr: `maa-tools 收集失败（${parsed.errorCode}）：${parsed.reason ?? "未提供原因"}\n${run.stderr}`,
            };
        }
        if (run.exitCode !== 0)
            return {doc: null, stderr: `maa-tools 收集进程退出码为 ${String(run.exitCode)}\n${run.stderr}`};
        return {
            doc: {
                ...parsed,
                files: parsed.files.map((file) => ({...file, file: displayPath(request.workspaceRoot, file.file)})),
            },
            stderr: run.stderr,
        };
    } catch (error) {
        if (!(error instanceof ResultFormatError)) throw error;
        return {
            doc: null,
            stderr: `maa-tools 收集结果不符合约定：${error.message}\n${run.stderr.trim() || run.stdout.trim() || "（没有任何输出）"}`,
        };
    }
}
