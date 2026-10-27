#!/usr/bin/env node
// 只跑 Maa 节点测试的一个文件（或其中一个用例）。
//
// @nekosu/maa-tools 只提供全量 `maa-tools test`，没有过滤参数。这里走同一套库函数：
//   1. loadConfig 加载 maatools.config.mts（会连带执行 tests/scripts/loader.mts 的 fetchCases）；
//   2. 把 cfg.test.cases 换成包装函数，用 lib/filter.mjs 只留下目标文件的组和用例；
//   3. 自己做截图存在性预检（maa-tools 遇到不存在的图只打印 ignored 就跳过，会让「一张图都没有」也判通过）；
//   4. 调 runTest(cfg)，把结果翻译成「RESULT 行 + 退出码」这套固定接口。
//
// 参数与退出码见 lib/args.mjs 的 USAGE。

import {closeSync, existsSync, openSync, readFileSync, readSync, statSync} from "node:fs";
import path from "node:path";

import {DEFAULT_CONFIG, USAGE, UsageError, parseArgs} from "./lib/args.mjs";
import {caseKey, hitNodeNames} from "./lib/case-key.mjs";
import {filterGroups, groupLabel, groupName} from "./lib/filter.mjs";
import {countImages, scanImages} from "./lib/images.mjs";
import {MaaToolsLoadError, describeMaaToolsSource, importMaaTools} from "./lib/maa-tools.mjs";
import {displayPath, resolveFromWorkspace, toPosix} from "./lib/paths.mjs";
import {readPngSize} from "./lib/png.mjs";
import {printResult} from "./lib/report.mjs";
import {
    CaseIndexOutOfRangeError,
    TestFileError,
    buildTarget,
    normalizeTestFile,
    parseTestFile,
} from "./lib/test-file.mjs";

/** 前置错误（退出码 2）。message 直接打给用户看，所以要写人话。 */
class FatalError extends Error {
    constructor(message) {
        super(message);
        this.name = "FatalError";
    }
}

async function run() {
    let args;
    try {
        args = parseArgs(process.argv.slice(2));
    } catch (error) {
        if (error instanceof UsageError) throw new FatalError(`参数错误：${error.message}\n\n${USAGE}`);
        throw error;
    }

    const workspace = path.resolve(args.workspace);
    if (!isDirectory(workspace)) throw new FatalError(`--workspace 不是一个存在的目录：${workspace}`);

    const configPath = resolveFromWorkspace(workspace, args.config);
    if (!existsSync(configPath)) {
        throw new FatalError(
            `找不到 maatools 配置文件：${configPath}\n` +
                `--config 是相对仓库根的路径，默认 ${DEFAULT_CONFIG}；请检查 --workspace 是否指对了仓库根。`,
        );
    }

    const filePath = resolveFromWorkspace(workspace, args.file);
    if (!existsSync(filePath)) throw new FatalError(`找不到测试文件：${filePath}`);

    // 先读目标文件再做重量级的配置加载：文件写错时能立刻报错，不用等十几秒。
    let testFile;
    try {
        testFile = normalizeTestFile(parseTestFile(readFileSync(filePath, "utf8")));
    } catch (error) {
        if (error instanceof TestFileError) {
            throw new FatalError(`${displayPath(workspace, filePath)}：${error.message}`);
        }
        throw error;
    }

    let target;
    try {
        target = buildTarget(testFile, args.caseIndex);
    } catch (error) {
        if (error instanceof CaseIndexOutOfRangeError) {
            // 用例下标合法但文件里没有这一条 —— 按「过滤后没有可跑用例」处理（退出码 3）。
            console.error(`${displayPath(workspace, filePath)}：${error.message}`);
            console.error("没有可运行的用例，什么也没做。");
            return "empty";
        }
        throw error;
    }

    let maaTools;
    let maaToolsSource;
    try {
        ({module: maaTools, source: maaToolsSource} = await importMaaTools(workspace));
    } catch (error) {
        if (error instanceof MaaToolsLoadError) throw new FatalError(error.message);
        throw error;
    }
    const {loadConfig, runTest} = maaTools;

    let cfg;
    try {
        cfg = await loadConfig(configPath);
    } catch (error) {
        throw new FatalError(`加载配置文件失败：${configPath}\n${errorText(error)}`);
    }
    if (!cfg || typeof cfg !== "object") {
        throw new FatalError(
            `加载配置文件失败：${configPath}\n` +
                `上面是 maa-tools / jiti 打印的原始错误。常见原因：配置语法错误，或配置里 import 的文件` +
                `（如 tests/scripts/loader.mts）不存在、依赖没装。可先在仓库根执行 pnpm install。`,
        );
    }
    if (!cfg.test || typeof cfg.test !== "object" || !cfg.test.cases) {
        throw new FatalError(`配置文件 ${configPath} 里没有 test.cases，无法运行节点测试。`);
    }

    // maa-tools 内部一律用 cfg.cwd ?? process.cwd() 拼路径。扩展拉起本脚本时工作目录不一定在仓库根，
    // 这里钉成绝对路径，保证截图、日志、错误详情都落在 --workspace 指的那份仓库里。
    cfg.cwd = path.resolve(workspace, cfg.cwd ?? ".");
    // stdio 才会输出普通文本；github 模式会走 @actions/core 的分组日志，不适合本地扩展解析。
    cfg.mode = "stdio";

    // 包装 cfg.test.cases：maa-tools 调它拿全量组，我们在这里就地过滤。
    // 结果缓存一份：这个函数要扫一遍整个 tests/ 目录（几十个文件、上百条用例），
    // 我们判断是否有匹配要用一次，runTest 内部还要用一次，不缓存就白扫两遍。
    const originalCases = cfg.test.cases;
    let cachedGroups = null;
    cfg.test.cases = async () => {
        if (cachedGroups === null) {
            cachedGroups = (async () => {
                const resolved = typeof originalCases === "function" ? await originalCases() : originalCases;
                return filterGroups(Array.isArray(resolved) ? resolved : [], target);
            })();
        }
        return cachedGroups;
    };

    let groups;
    try {
        groups = await cfg.test.cases();
    } catch (error) {
        throw new FatalError(`按目标文件过滤测试组时出错（配置里的 test.cases 执行失败）：\n${errorText(error)}`);
    }

    const relativeFile = displayPath(workspace, filePath);
    const caseText =
        args.caseIndex === null
            ? `全部用例，共 ${testFile.cases.length} 个`
            : `用例下标 ${args.caseIndex}（第 ${args.caseIndex + 1} 个），共 ${testFile.cases.length} 个`;
    console.log(`运行 ${relativeFile}（${caseText}）`);
    console.log(`配置 ${displayPath(workspace, configPath)}`);
    console.log(`库：${describeMaaToolsSource(maaToolsSource, workspace)}`);

    if (groups.length === 0) {
        console.error(
            `没有匹配到任何测试组：${relativeFile} 里声明的 controller/resource/用例，在 maa-tools 展开的结果里一组都没对上。\n` +
                `常见原因：configs.controller 或 configs.resource 写错（必须是 tests/scripts/loader.mts 里映射过的值）、` +
                `用例键（image + hits）在展开后被改变。`,
        );
        return "empty";
    }

    console.log(`匹配到 ${groups.length} 组：${groups.map((group) => groupLabel(group)).join("、")}`);

    const scan = scanImages(cfg, groups);
    const stats = countImages(scan);

    if (args.dryRun) {
        printPlan(scan, testFile.cases, args.caseIndex);
    } else {
        for (const entry of scan) {
            for (const item of entry.images) {
                console.log(`  截图：${imageRef(entry.group, item.image)} ${item.exists ? "✓" : "✗ 文件不存在"}`);
            }
        }
    }

    // 一张截图都不存在时必须直接失败。否则 maa-tools 会把所有用例当成
    // 「xxx not exists, ignored」跳过，一个识别都不跑，最后返回 true —— 假阳性。
    if (stats.existing === 0) {
        console.error(
            `本次要跑的 ${stats.total} 张截图一张都找不到，maa-tools 会把它们全部跳过并判为通过，` +
                `所以这里直接判为前置错误。尝试过的路径：`,
        );
        for (const entry of scan) {
            for (const item of entry.images) console.error(`  ${item.path}`);
        }
        console.error(
            `截图根目录是 ${path.resolve(cfg.cwd, cfg.test.casesCwd ?? ".")}，` +
                "请确认截图已放到对应 controller/resource 目录下。",
        );
        return "error";
    }

    if (stats.missing > 0) {
        console.warn(
            `警告：${stats.missing}/${stats.total} 张截图不存在，这些用例会被 maa-tools 跳过（跳过即视为通过，等于没验证）：`,
        );
        for (const entry of scan) {
            for (const item of entry.images) if (!item.exists) console.warn(`  缺失：${item.path}`);
        }
    }

    if (args.dryRun) {
        console.log("");
        console.log("dry-run 结束：只做了解析、过滤和截图检查，没有加载 MaaFW，也没有执行识别。");
        return "pass";
    }

    const detailsPath = cfg.test.errorDetailsPath ? path.resolve(cfg.cwd, cfg.test.errorDetailsPath) : null;
    const detailsMtimeBefore = mtimeMs(detailsPath);

    console.log("");
    console.log("开始运行，下面是 maa-tools 自己的输出（进度百分比会混在里面）：");

    // maa-tools 在 setupMaa 失败 / assets/interface.json 加载失败时同样返回 false，而且不打印任何组名；
    // 真正的测试失败一定会打印出组名（失败的组红色、通过的组绿色）。用这一点把「没跑起来」和「跑失败」分开。
    const knownGroupNames = groups.map((group) => groupName(group));
    let sawGroupLine = false;
    const originalLog = console.log;
    console.log = (...items) => {
        if (!sawGroupLine) {
            const line = items.map((item) => String(item)).join(" ");
            for (const name of knownGroupNames) {
                if (line.includes(name)) {
                    sawGroupLine = true;
                    break;
                }
            }
        }
        originalLog(...items);
    };

    let ok;
    try {
        ok = await runTest(cfg);
    } catch (error) {
        throw new FatalError(`运行测试时抛出异常：\n${errorText(error)}`);
    } finally {
        console.log = originalLog;
    }

    if (detailsPath && existsSync(detailsPath)) {
        const changed = mtimeMs(detailsPath) !== detailsMtimeBefore;
        console.log(`错误详情：${detailsPath}${changed ? "" : "（本次运行没有更新它，可能是更早一次运行留下的）"}`);
    }

    if (ok === true) return "pass";

    if (!sawGroupLine) {
        throw new FatalError(
            "maa-tools 没有执行任何用例（没有打印出任何测试组名），不是「用例失败」而是「根本没跑起来」。\n" +
                "常见原因：MaaFW 准备失败（首次运行需要联网下载到 ~/.maa-tools，可看上面 maa-tools 的 prepare 日志）、" +
                "或 assets/interface.json 加载失败。",
        );
    }

    return "fail";
}

/** dry-run 的计划：每组、每个用例、截图与命中节点都列清楚。 */
function printPlan(scan, fileCases, caseIndex) {
    // 用例编号用「文件里的下标」（也就是 --case 的取值），不是组内序号，免得带 --case 时显示成 0 让人误会。
    // 没传 --case 时按用例键反查它在文件里的位置；同一文件里键重复时取第一次出现的位置。
    const indexByKey = new Map();
    if (caseIndex === null) {
        fileCases.forEach((testCase, index) => {
            const key = caseKey(testCase);
            if (!indexByKey.has(key)) indexByKey.set(key, index);
        });
    }

    console.log("");
    console.log("运行计划（dry-run：只解析、过滤、检查截图，不加载 MaaFW，不执行识别）：");
    for (const entry of scan) {
        const group = entry.group;
        console.log(`  组：${groupName(group)}`);
        console.log(
            `      controller=${group.configs.controller}  resource=${group.configs.resource}  ` +
                `imageRoot=${group.configs.imageRoot ?? "."}`,
        );
        group.cases.forEach((testCase, index) => {
            const fileIndex = caseIndex === null ? (indexByKey.get(caseKey(testCase)) ?? index) : caseIndex;
            const item = entry.images[index];
            const nodes = hitNodeNames(testCase.hits);
            const hitsText = nodes.length === 0 ? "负例，不期望命中任何节点" : nodes.join(", ");
            const mark = item.exists ? `✓${imageSizeText(item.path)}` : "✗ 文件不存在";
            console.log(`    用例 ${fileIndex}：image=${item.image}`);
            console.log(`        hits=${hitsText}`);
            console.log(`        截图：${imageRef(group, item.image)} ${mark}`);
            if (!item.exists) console.log(`        期望路径：${item.path}`);
        });
    }
}

/** 截图在日志里的显示路径：相对 casesCwd 的 imageRoot/image。 */
function imageRef(group, image) {
    return toPosix(path.join(group.configs.imageRoot ?? ".", image));
}

/** PNG 尺寸，例如「（1280x720）」；读不出来就给个说明，不影响流程。 */
function imageSizeText(file) {
    if (path.extname(file).toLowerCase() !== ".png") return "（非 PNG，未读尺寸）";
    try {
        const buffer = Buffer.alloc(24);
        const fd = openSync(file, "r");
        try {
            const read = readSync(fd, buffer, 0, 24, 0);
            const size = readPngSize(read >= 24 ? buffer : buffer.subarray(0, read));
            if (!size) return "（尺寸未知）";
            const note = size.width === 1280 && size.height === 720 ? "" : "，不是基准分辨率 1280x720";
            return `（${size.width}x${size.height}${note}）`;
        } finally {
            closeSync(fd);
        }
    } catch {
        return "（尺寸读取失败）";
    }
}

function isDirectory(target) {
    try {
        return statSync(target).isDirectory();
    } catch {
        return false;
    }
}

function mtimeMs(file) {
    if (!file) return null;
    try {
        return statSync(file).mtimeMs;
    } catch {
        return null;
    }
}

function errorText(error) {
    if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
    return String(error);
}

try {
    printResult(await run());
} catch (error) {
    if (error instanceof FatalError) console.error(error.message);
    else console.error(`运行失败：\n${errorText(error)}`);
    printResult("error");
}
