export interface RunnerArgsInput {
    /** runner 脚本绝对路径：<扩展安装目录>/runner/run-single-test.mjs */
    runnerScriptPath: string;
    /** 仓库根绝对路径 */
    workspaceRoot: string;
    /** maatools 配置路径，相对仓库根 */
    configPath: string;
    /** 测试文件，绝对路径或相对仓库根都行，这里原样传下去 */
    testFile: string;
    /** 用例下标，从 0 开始。不传就是跑整个文件 */
    caseIndex?: number;
    /** 只打印计划，不真正执行 */
    dryRun?: boolean;
}

/**
 * 拼出交给 `node` 的完整参数数组（第 0 项是 runner 脚本路径）。
 * 参数顺序固定成 --workspace / --config / --file / --case / --dry-run，方便对着日志排查。
 */
export function buildRunnerArgs(input: RunnerArgsInput): string[] {
    const args = [
        input.runnerScriptPath,
        "--workspace",
        input.workspaceRoot,
        "--config",
        input.configPath,
        "--file",
        input.testFile,
    ];
    if (input.caseIndex !== undefined) {
        args.push("--case", String(input.caseIndex));
    }
    if (input.dryRun) {
        args.push("--dry-run");
    }
    return args;
}

/** 带空格的参数用双引号包起来，只为了日志里能看清，不影响真正执行 */
export function quoteArgument(argument: string): string {
    if (argument.length === 0) return '""';
    if (!/[\s"]/.test(argument)) return argument;
    return `"${argument.replace(/"/g, '\\"')}"`;
}

/** 把可执行文件和参数拼成一行给人看的命令行 */
export function formatCommandLine(executable: string, args: readonly string[]): string {
    return [
        executable,
        ...args,
    ]
        .map(quoteArgument)
        .join(" ");
}

/**
 * 用户看到的标题：相对工作区根的文件路径，跑单个用例时补上「第 N 个用例」。
 * 例：`tests/Common/Button/test_close_button.json 第 2 个用例`
 */
export function buildRunTitle(testFileRelativePath: string, caseIndex?: number): string {
    const normalized = testFileRelativePath.replace(/\\/g, "/");
    if (caseIndex === undefined) return normalized;
    return `${normalized} 第 ${caseIndex + 1} 个用例`;
}
