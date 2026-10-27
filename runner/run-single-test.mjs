#!/usr/bin/env node
// 只跑 Maa 节点测试里指定的一批文件（或其中一个用例）。
//
// @nekosu/maa-tools 只提供全量 `maa-tools test`，没有过滤参数。这里走同一套库函数：
//   1. loadConfig 加载 maatools.config.mts（会连带执行 tests/scripts/loader.mts 的 fetchCases）；
//   2. 把 cfg.test.cases 换成包装函数，用 lib/filter.mjs 只留下目标文件的组和用例；
//   3. 自己做截图存在性预检（maa-tools 遇到不存在的图只打印 ignored 就跳过，「一张图都没有」也会判通过）；
//   4. 调 runTest(cfg)，把结果翻译成「RESULT-FILE 逐文件结论 + RESULT 整批结论 + 退出码」这套固定接口。
//
// 为什么允许一次给多个 --file：MaaFW 初始化和 assets 加载占了单次运行的大头（实测单文件 4~5 秒，
// 真正的识别只占其中一小部分）。一个文件一个进程等于把这份固定开销重复几十次；批量跑只付一次。
// 代价是 runTest 只返回整批的一个布尔值，所以逐文件结论靠解析它打印的组名（见 lib/results.mjs）。
//
// 参数与退出码见 lib/args.mjs 的 USAGE。

import {closeSync, existsSync, openSync, readFileSync, readSync, statSync} from "node:fs";
import path from "node:path";

import {USAGE, UsageError, parseArgs} from "./lib/args.mjs";
import {caseKey, hitNodeNames} from "./lib/case-key.mjs";
import {filterGroupsForFiles, groupLabel, groupName} from "./lib/filter.mjs";
import {countImages, resolveImagePath, scanImages} from "./lib/images.mjs";
import {MaaToolsLoadError, describeMaaToolsSource, importMaaTools} from "./lib/maa-tools.mjs";
import {displayPath, resolveFromWorkspace, toPosix} from "./lib/paths.mjs";
import {readPngSize} from "./lib/png.mjs";
import {printResult} from "./lib/report.mjs";
import {
    aggregateFileResults,
    attributeGroupResults,
    formatCaseFailure,
    formatCaseResultLine,
    formatFileResultLine,
    hasAnyAttributedGroup,
    locateCaseFailures,
    normalizeFileResults,
    overallVerdict,
    summarizePlatforms,
} from "./lib/results.mjs";
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
                `--config 是相对仓库根的路径，默认 maatools.config.mts；请检查 --workspace 是否指对了仓库根。`,
        );
    }

    // 先把目标文件全读一遍再做重量级的配置加载：文件写错时能立刻报错，不用等十几秒。
    const entries = [];
    for (const rawFile of args.files) {
        const filePath = resolveFromWorkspace(workspace, rawFile);
        if (!existsSync(filePath)) throw new FatalError(`找不到测试文件：${filePath}`);

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

        entries.push({key: displayPath(workspace, filePath), filePath, testFile, target});
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
    // 结果缓存一份，避免「我们调一次、runTest 再调一次」重复扫描整个 tests/ 目录（每次几百毫秒到几秒）。
    const originalCases = cfg.test.cases;
    let filtered = null;
    cfg.test.cases = async () => {
        if (filtered === null) {
            filtered = (async () => {
                const resolved = typeof originalCases === "function" ? await originalCases() : originalCases;
                return filterGroupsForFiles(Array.isArray(resolved) ? resolved : [], entries);
            })();
        }
        const result = await filtered;
        return result.groups;
    };

    let selection;
    try {
        // 触发一次全量扫描 + 过滤：结果被缓存进 filtered，runTest 里再调就是同一份。
        await cfg.test.cases();
        selection = await filtered;
    } catch (error) {
        throw new FatalError(`按目标文件过滤测试组时出错（配置里的 test.cases 执行失败）：\n${errorText(error)}`);
    }

    const {groups, owners} = selection;
    const singleFile = entries.length === 1;
    const caseText = singleFile
        ? args.caseIndex === null
            ? `全部用例，共 ${entries[0].testFile.cases.length} 个`
            : `用例下标 ${args.caseIndex}（第 ${args.caseIndex + 1} 个），共 ${entries[0].testFile.cases.length} 个`
        : "各自全部用例";
    console.log(
        singleFile ? `运行 ${entries[0].key}（${caseText}）` : `批量运行 ${entries.length} 个测试文件（${caseText}）`,
    );
    console.log(`配置 ${displayPath(workspace, configPath)}`);
    console.log(`库：${describeMaaToolsSource(maaToolsSource, workspace)}`);

    if (groups.length === 0) {
        console.error(
            `没有匹配到任何测试组：这些文件里声明的 controller/resource/用例，在 maa-tools 展开的结果里一组都没对上。\n` +
                `常见原因：configs.controller 或 configs.resource 写错（必须是 tests/scripts/loader.mts 里映射过的值）、` +
                `用例键（image + hits）在展开后被改变。`,
        );
        return "empty";
    }

    console.log(`匹配到 ${groups.length} 组：${groups.map((group) => groupLabel(group)).join("、")}`);

    const scan = scanImages(cfg, groups);
    const stats = countImages(scan);
    const perFile = summarizePerFile(scan, owners, entries);

    printPlatformCoverage(scan, groups, entries);

    if (args.dryRun) {
        printPlan(scan);
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
            `截图根目录是 ${path.resolve(cfg.cwd, cfg.test.casesCwd ?? ".")}，请确认截图已放到对应 controller/resource 目录下。`,
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
        console.log(`本次会跑 ${groups.length} 组、${stats.total} 张截图（${entries.length} 个文件）`);
        return "pass";
    }

    const detailsPath = cfg.test.errorDetailsPath ? path.resolve(cfg.cwd, cfg.test.errorDetailsPath) : null;
    const detailsMtimeBefore = mtimeMs(detailsPath);

    console.log("");
    console.log("开始运行，下面是 maa-tools 自己的输出（进度百分比会混在里面）：");

    // 边跑边把 stdout 抄一份：跑完之后按组名把结论分发回每个文件（runTest 只给整批一个布尔值）。
    const captured = [];
    const originalLog = console.log;
    console.log = (...items) => {
        captured.push(items.map((item) => String(item)).join(" "));
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

    const groupNames = groups.map((group) => groupName(group));
    const verdicts = attributeGroupResults(captured, groupNames);
    const fileResults = normalizeFileResults(
        aggregateFileResults(
            owners,
            verdicts,
            entries.map((entry) => entry.key),
        ),
    );

    // 截图一张都没有的文件、以及压根没匹配到组的文件，结果都不可信，统一按 error 报，别让它显示成「通过」。
    for (const entry of entries) {
        const summary = perFile.get(entry.key);
        if (!summary || summary.total === 0 || summary.existing === 0) fileResults.set(entry.key, "error");
    }

    if (ok !== true && !hasAnyAttributedGroup(verdicts)) {
        throw new FatalError(
            "maa-tools 没有执行任何用例（没有打印出任何测试组名），不是「用例失败」而是「根本没跑起来」。\n" +
                "常见原因：MaaFW 准备失败（首次运行需要联网下载到 ~/.maa-tools，可看上面 maa-tools 的 prepare 日志）、" +
                "或 assets/interface.json 加载失败。",
        );
    }

    // 逐用例原因：失败明细来自 maa-tools 自己写的 error_details.json（结构化，比解析文本可靠），
    // 只有本次运行确实更新了它才算数 —— 否则会把上一次运行留下的失败张冠李戴。
    const errorDetails = readFreshErrorDetails(detailsPath, detailsMtimeBefore);
    const caseResults = locateCaseFailures({
        errorDetails,
        groups,
        entries,
        owners,
        resolveImage: (group, image) => resolveImagePath(cfg, group, image),
        isImageMissing: (group, testCase) => !existsSync(resolveImagePath(cfg, group, testCase.image)),
    });

    // 有失败的用例报 fail（顺便说明哪些平台是好的），只缺图的报 error
    const caseFailures = new Map();
    const caseSkipped = new Map();
    for (const [
        key,
        info,
    ] of caseResults) {
        if (info.failures.length > 0) caseFailures.set(key, formatCaseFailure(info));
        else if (info.missing.length > 0) caseSkipped.set(key, formatCaseFailure(info));
    }

    // 有明确的用例级失败，文件结论一定是失败（万一组名归因漏了，这里补上）
    for (const key of caseFailures.keys()) {
        const fileKey = key.slice(0, key.lastIndexOf("#"));
        if (fileResults.get(fileKey) === "pass") fileResults.set(fileKey, "fail");
    }

    console.log("");
    console.log("按文件结果：");
    for (const entry of entries) {
        const verdict = fileResults.get(entry.key) ?? "error";
        console.log(`  ${verdictMark(verdict)} ${entry.key}`);
    }

    if (caseFailures.size > 0) {
        console.log("");
        console.log("逐用例失败原因：");
        for (const [
            key,
            text,
        ] of caseFailures) {
            const [
                fileKey,
                indexText,
            ] = splitCaseKey(key);
            console.log(`  ✗ ${fileKey} 第 ${Number(indexText) + 1} 个用例：${text.title}`);
            for (const line of text.lines) console.log(`      · ${line}`);
        }
    }

    if (caseSkipped.size > 0) {
        console.log("");
        console.log("被跳过的用例（截图不存在，等于没验证）：");
        for (const [
            key,
            text,
        ] of caseSkipped) {
            const [
                fileKey,
                indexText,
            ] = splitCaseKey(key);
            console.log(`  ！ ${fileKey} 第 ${Number(indexText) + 1} 个用例：${text.title}`);
            for (const line of text.lines) console.log(`      · ${line}`);
        }
    }

    for (const [
        key,
        text,
    ] of caseFailures) {
        const [
            fileKey,
            indexText,
        ] = splitCaseKey(key);
        console.log(formatCaseResultLine(fileKey, Number(indexText), "fail", text.title, text.lines));
    }
    for (const [
        key,
        text,
    ] of caseSkipped) {
        const [
            fileKey,
            indexText,
        ] = splitCaseKey(key);
        console.log(formatCaseResultLine(fileKey, Number(indexText), "error", text.title, text.lines));
    }

    for (const entry of entries) {
        console.log(formatFileResultLine(entry.key, fileResults.get(entry.key) ?? "error"));
    }

    return overallVerdict(fileResults);
}

/** 读 error_details.json，只认本次运行更新的那一份 */
function readFreshErrorDetails(detailsPath, mtimeBefore) {
    if (!detailsPath || !existsSync(detailsPath)) return [];
    if (mtimeMs(detailsPath) === mtimeBefore) return [];
    try {
        const parsed = JSON.parse(readFileSync(detailsPath, "utf8"));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        // 明细文件坏了不该让整次运行失败：逐用例原因缺失而已，文件级结论仍然有效
        return [];
    }
}

/** caseFailures 的 key 是 `<文件>#<下标>`，文件名里理论上可能有 #，所以从最后一个切 */
function splitCaseKey(key) {
    const index = key.lastIndexOf("#");
    return [
        key.slice(0, index),
        key.slice(index + 1),
    ];
}

/** 每个文件一共涉及几张截图、其中几张真的存在（用于判断这个文件到底有没有被验证到） */
function summarizePerFile(scan, owners, entries) {
    const summary = new Map(
        entries.map((entry) => [
            entry.key,
            {total: 0, existing: 0},
        ]),
    );

    for (const item of scan) {
        const ownerKeys = owners.get(groupName(item.group)) ?? new Set();
        item.group.cases.forEach((testCase, index) => {
            const image = item.images[index];
            for (const entry of entries) {
                if (!ownerKeys.has(entry.key)) continue;
                if (!entry.target.caseKeys.includes(caseKey(testCase))) continue;
                const slot = summary.get(entry.key);
                slot.total += 1;
                if (image.exists) slot.existing += 1;
            }
        });
    }

    return summary;
}

/**
 * 平台覆盖：每个平台这次涉及多少张截图、缺几张；以及声明了却没有匹配到组的 controller。
 * 缺图这件事必须让人一眼看到 —— maa-tools 会把缺图的用例跳过并当作通过。
 */
function printPlatformCoverage(scan, groups, entries) {
    const summary = summarizePlatforms({
        groups,
        entries,
        isImageMissing: (group, testCase) => {
            const item = scan.find((entry) => entry.group === group);
            const index = group.cases.indexOf(testCase);
            return item ? !item.images[index].exists : false;
        },
    });

    if (summary.platforms.length === 0) return;

    console.log("");
    console.log("平台覆盖：");
    for (const item of summary.platforms) {
        const state = item.missing === 0 ? "全部存在" : `缺 ${item.missing} 张（这些用例在这个平台上跳过，等于没验证）`;
        console.log(`  ${item.label}：${item.images} 张截图，${state}`);
    }

    if (summary.unmatched.length > 0) {
        console.log("");
        console.log("声明了但没有匹配到测试组的平台（这些平台一条用例都没跑）：");
        for (const item of summary.unmatched) {
            console.log(`  ${item.controller}（${item.file}）—— 检查 tests/scripts/loader.mts 里 controller 的映射`);
        }
    }
}

/** dry-run 的计划：每组、每个用例、截图与命中节点都列清楚。 */
function printPlan(scan) {
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
            const item = entry.images[index];
            const nodes = hitNodeNames(testCase.hits);
            const hitsText = nodes.length === 0 ? "负例，不期望命中任何节点" : nodes.join(", ");
            const mark = item.exists ? `✓${imageSizeText(item.path)}` : "✗ 文件不存在";
            console.log(`    用例 ${index}：image=${item.image}`);
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

function verdictMark(verdict) {
    if (verdict === "pass") return "✓";
    if (verdict === "fail") return "✗";
    return "！";
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
