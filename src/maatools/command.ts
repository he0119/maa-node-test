/** maa-tools 配置文件的默认名（相对仓库根） */
export const DEFAULT_CONFIG = "maatools.config.mts";

export interface MaaToolsArgsInput {
    /** maa-tools 命令行入口绝对路径：<仓库根>/node_modules/@nekosu/maa-tools/bin/maa-tools */
    cliPath: string;
    /** maa-tools 配置路径，相对仓库根；不是默认值时作为位置参数传给 maa-tools */
    configPath: string;
    /** 测试文件路径（相对仓库根；maa-tools 按 --file 过滤） */
    testFiles: readonly string[];
    /** 用例下标，从 0 开始。不传就是跑整个文件 */
    caseIndex?: number;
    /** list = 收集测试文件与用例清单；run = 真跑 */
    mode: "list" | "run";
}

/**
 * 拼出交给 `node` 的完整参数数组（第 0 项是 maa-tools 命令行入口）。
 * 参数顺序固定为 test / --list --json 或 --jsonl / 若干 --file / --case / 配置路径，方便对着日志排查。
 */
export function buildMaaToolsArgs(input: MaaToolsArgsInput): string[] {
    const flags =
        input.mode === "list"
            ? [
                  "--list",
                  "--json",
              ]
            : ["--jsonl"];
    const args = [
        input.cliPath,
        "test",
        ...flags,
    ];
    for (const file of input.testFiles) {
        args.push("--file", file);
    }
    if (input.caseIndex !== undefined) {
        args.push("--case", String(input.caseIndex));
    }
    // 收集与运行加载相同配置；默认文件名由 maa-tools 自己处理。
    if (input.configPath !== DEFAULT_CONFIG) {
        args.push(input.configPath);
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
