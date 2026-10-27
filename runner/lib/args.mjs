// 命令行参数解析：只认固定接口里那几个参数，其它一律报错。
// 手写而不是引第三方库，是因为参数就 5 个，而且错误提示要说人话。

export const DEFAULT_CONFIG = "maatools.config.mts";

export const USAGE = `用法：
  node runner/run-single-test.mjs --workspace <仓库根绝对路径> [--config <相对仓库根的配置路径>] --file <测试 json> [--case <下标>] [--dry-run]

参数：
  --workspace  仓库根目录。maa-tools 配置、tests/、assets/ 都相对它解析（必填）
  --config     maatools 配置路径，相对仓库根，默认 ${DEFAULT_CONFIG}
  --file       测试 json 文件，可以写绝对路径，也可以写相对仓库根的路径（必填）
  --case       只跑 cases 数组里的第几个用例，下标从 0 开始；不传就跑该文件全部用例
  --dry-run    只解析、过滤、打印计划，不加载 MaaFW、不执行识别

退出码：0 通过 / 1 测试失败 / 2 前置错误 / 3 过滤后没有可跑用例`;

/** 命令行参数不合法。入口把它当作「前置错误」，退出码 2。 */
export class UsageError extends Error {
    constructor(message) {
        super(message);
        this.name = "UsageError";
    }
}

/**
 * 解析 argv（不含 node 与脚本路径本身）。
 * 返回 { workspace, config, file, caseIndex, dryRun }，字符串原样返回，不做绝对化 ——
 * 绝对化要依赖工作目录，留给入口用仓库根去解析，便于单测。
 */
export function parseArgs(argv) {
    const parsed = {
        workspace: null,
        config: DEFAULT_CONFIG,
        file: null,
        caseIndex: null,
        dryRun: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === "--dry-run") {
            parsed.dryRun = true;
            continue;
        }

        if (arg === "--workspace" || arg === "--config" || arg === "--file" || arg === "--case") {
            const value = readValue(argv, index, arg);
            index += 1;
            if (arg === "--workspace") parsed.workspace = value;
            else if (arg === "--config") parsed.config = value;
            else if (arg === "--file") parsed.file = value;
            else parsed.caseIndex = parseCaseIndex(value);
            continue;
        }

        if (arg.startsWith("-")) throw new UsageError(`不认识的参数：${arg}`);
        throw new UsageError(`不认识的参数：${arg}（本脚本没有位置参数，路径要跟在 --workspace / --file 后面）`);
    }

    if (!parsed.workspace) throw new UsageError("缺少 --workspace（仓库根目录）");
    if (!parsed.file) throw new UsageError("缺少 --file（要跑的测试 json）");

    return parsed;
}

/** 取参数后面那个值。缺值、或者后面紧跟另一个 -- 参数时直接报错，不猜。 */
function readValue(argv, index, flag) {
    const value = argv[index + 1];
    if (value === undefined) throw new UsageError(`${flag} 后面缺少取值`);
    if (value.startsWith("--")) throw new UsageError(`${flag} 后面缺少取值，紧跟着的是另一个参数 ${value}`);
    return value;
}

/**
 * --case 只接受非负整数。
 * 注意这里拒绝负数和非数字（那是写法错误，退出码 2）；
 * 而「数字合法但超出该文件的用例数量」属于「没有可跑用例」，由 lib/test-file.mjs 判成退出码 3。
 */
function parseCaseIndex(raw) {
    if (!/^\d+$/.test(raw)) {
        throw new UsageError(`--case 只能写从 0 开始的整数（非负、不含正负号或其它字符），收到 "${raw}"`);
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) throw new UsageError(`--case 数值太大，无法当作下标：${raw}`);
    return value;
}
