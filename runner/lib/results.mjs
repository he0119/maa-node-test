// 把 maa-tools 自己的输出翻译成「每个文件过没过」。
//
// 为什么需要这一层：runTest 只返回一个布尔值（整批有没有失败），说不出是哪一条用例。
// 但它会把每个测试组名打印出来（通过绿色、失败红色），失败时紧接着打印明细行（行首两个空格）。
// 批量跑多个文件时，我们靠「组名 → 属于哪些文件」的映射把结论分发回每个文件。
//
// 注意 chalk 在管道里不上色，所以组名行就是干净的组名；万一输出带 ANSI（比如在 TTY 里手跑），
// 这里会先剥掉转义序列再比较。

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

/** 去掉 ANSI 颜色转义 */
export function stripAnsi(text) {
    return String(text).replace(ANSI_PATTERN, "");
}

/**
 * 逐行判断每个测试组的结论。
 * 返回 Map<组名, "pass" | "fail" | "unknown">；没打印过组名的组是 unknown（说明压根没执行）。
 */
export function attributeGroupResults(lines, groupNames) {
    const known = new Set(groupNames);
    const verdicts = new Map();
    for (const name of known) verdicts.set(name, "unknown");

    let current = null;
    for (const raw of Array.isArray(lines) ? lines : []) {
        const line = stripAnsi(raw).replace(/\r$/, "");
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;

        if (known.has(trimmed)) {
            current = trimmed;
            if (verdicts.get(current) !== "fail") verdicts.set(current, "pass");
            continue;
        }

        // 失败明细行行首固定两个空格（maa-tools 的 putError 就是 `  xxx`），
        // 且一定跟在组名行后面。
        if (current !== null && /^ {2}\S/.test(line)) verdicts.set(current, "fail");
    }

    return verdicts;
}

/** 本批里是否至少有一个组真的被执行了（用来区分「跑失败」和「根本没跑起来」） */
export function hasAnyAttributedGroup(verdicts) {
    for (const verdict of verdicts.values()) {
        if (verdict !== "unknown") return true;
    }
    return false;
}

/**
 * 按文件汇总：一个文件只要它名下有一个组失败，这个文件就算失败。
 * 返回 Map<文件 key, "pass" | "fail" | "unknown">。
 */
export function aggregateFileResults(owners, verdicts, fileKeys) {
    const merged = new Map();
    for (const key of fileKeys) merged.set(key, "unknown");

    for (const [
        group,
        keys,
    ] of owners) {
        const verdict = verdicts.get(group) ?? "unknown";
        for (const key of keys) merged.set(key, pickWorse(merged.get(key) ?? "unknown", verdict));
    }

    return merged;
}

/** 把 aggregateFileResults 给的 unknown 统一改写成 error：对外只说 pass / fail / error 三种 */
export function normalizeFileResults(fileResults) {
    const normalized = new Map();
    for (const [
        key,
        verdict,
    ] of fileResults)
        normalized.set(key, verdict === "unknown" ? "error" : verdict);
    return normalized;
}

/**
 * 逐用例结论行：JSON 载荷，调用方（VS Code 扩展）按前缀解析。
 * 用 JSON 而不是「空格分隔」是因为失败原因里本来就带空格和逗号。
 */
export const CASE_RESULT_PREFIX = "RESULT-CASE: ";

/**
 * 拼一行逐用例结论。
 * title 是面板节点上显示的那一行（短），detail 是展开后的列表项。
 */
export function formatCaseResultLine(fileKey, caseIndex, verdict, title, detail) {
    return (
        CASE_RESULT_PREFIX +
        JSON.stringify({
            file: fileKey,
            case: caseIndex,
            verdict,
            title,
            detail: Array.isArray(detail) ? detail : [],
        })
    );
}

/** 解析一行逐用例结论；不是这类行就返回 null */
export function parseCaseResultLine(line) {
    const trimmed = stripAnsi(String(line)).replace(/\r$/, "");
    if (!trimmed.startsWith(CASE_RESULT_PREFIX)) return null;
    try {
        const payload = JSON.parse(trimmed.slice(CASE_RESULT_PREFIX.length));
        if (typeof payload?.file !== "string" || !Number.isInteger(payload?.case)) return null;
        if (
            ![
                "pass",
                "fail",
                "error",
            ].includes(payload?.verdict)
        )
            return null;
        return {
            file: payload.file,
            case: payload.case,
            verdict: payload.verdict,
            title: typeof payload.title === "string" ? payload.title : "",
            detail: Array.isArray(payload.detail) ? payload.detail.filter((item) => typeof item === "string") : [],
        };
    } catch {
        return null;
    }
}

/** 实际识别框是否完整落在期望矩形里（和 maa-tools 的 checkRect 同一套判定） */
export function boxInside(expected, actual) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return false;
    if (expected.length !== 4 || actual.length !== 4) return false;
    return (
        actual[0] >= expected[0] &&
        actual[1] >= expected[1] &&
        actual[0] + actual[2] <= expected[0] + expected[2] &&
        actual[1] + actual[3] <= expected[1] + expected[3]
    );
}

/** 取出 hits 里挂在某个节点上的期望框；没写框就返回 null */
function expectedBoxOf(testCase, node) {
    for (const hit of Array.isArray(testCase?.hits) ? testCase.hits : []) {
        if (hit && typeof hit === "object" && hit.node === node && Array.isArray(hit.box) && hit.box.length === 4) {
            return hit.box;
        }
    }
    return null;
}

/** hits 里是否写了这个节点 */
function expectsNode(testCase, node) {
    for (const hit of Array.isArray(testCase?.hits) ? testCase.hits : []) {
        if (typeof hit === "string" && hit === node) return true;
        if (hit && typeof hit === "object" && hit.node === node) return true;
    }
    return false;
}

/**
 * 判断 maa-tools 的一条错误明细落在某条用例上时，这条用例是过还是不过，以及结构化原因。
 *
 * maa-tools 的 error_details.json 每条形如：
 *   { imagePath, imagePathRaw, node, hit, detail: { algorithm, hit, box, ... } }
 * 它是「跑完之后判定为失败」的条目，但一条明细可能只对部分用例成立（同一张图被两个文件复用、
 * 一个期望命中、一个期望不命中），所以这里按用例自己的期望重新对一遍。
 *
 * 返回 {ok: true} 或 {ok: false, node, reason, algorithm, expectedBox, actualBox}：
 * 拆成字段而不是拼好的句子，是因为面板那边要按「标题 / 列表项」重新排版。
 */
export function classifyErrorEntry(entry, testCase) {
    const node = typeof entry?.node === "string" ? entry.node : "";
    if (!node) return {ok: true};

    const expects = expectsNode(testCase, node);

    // 识别没返回详细信息（maa-tools 会打 “missing detail.”），这种情况给不出框
    if (!entry?.detail || typeof entry.detail !== "object") {
        if (!expects && entry?.hit !== true) return {ok: true};
        return {ok: false, node, reason: "识别没有返回详情（missing detail），可能是算法异常", algorithm: null};
    }

    const algorithm = typeof entry.detail.algorithm === "string" ? entry.detail.algorithm : null;
    const actualBox = Array.isArray(entry.detail.box) ? entry.detail.box : null;

    if (entry.hit === false) {
        if (!expects) return {ok: true};
        return {ok: false, node, reason: "这张图上没识别到该节点", algorithm};
    }

    if (!expects) {
        return {ok: false, node, reason: "这条用例不期望它命中，但图上识别到了", algorithm};
    }

    const expectedBox = expectedBoxOf(testCase, node);
    if (expectedBox && !actualBox) {
        return {
            ok: false,
            node,
            reason: `识别到了但没有返回识别框，无法和期望 ${JSON.stringify(expectedBox)} 比对`,
            algorithm,
        };
    }
    if (expectedBox && actualBox && !boxInside(expectedBox, actualBox)) {
        return {
            ok: false,
            node,
            reason: `识别框不对：期望 ${JSON.stringify(expectedBox)}，实际 ${JSON.stringify(actualBox)}`,
            algorithm,
        };
    }

    return {ok: true};
}

/**
 * 把 error_details.json 的条目分发到「哪个文件的第几条用例」，并统计这条用例在各平台上的情况。
 *
 * 归属方式：错误条目带绝对图片路径 + 节点名；对每个保留下来的组，用它自己的 imageRoot 拼出
 * 预期图片路径，和条目里的 imagePath 对上，再看这个组属于哪些文件（owners），最后用用例自己的
 * 期望（是否写了这个节点、框是多少）判断这条用例到底过没过。
 *
 * 一条用例通常会在多个平台（controller × resource）上各跑一遍，所以这里同时记下
 * 「它在哪些平台跑过、哪些平台失败、哪些平台缺图」，输出时才能说清「只有 CloudADB 失败」。
 *
 * 返回 Map<`${fileKey}#${index}`, {platforms, failures, missing}>。
 */
export function locateCaseFailures({
    errorDetails,
    groups,
    entries,
    owners,
    resolveImage,
    isImageMissing = () => false,
}) {
    const result = new Map();
    const details = Array.isArray(errorDetails) ? errorDetails : [];

    const slotOf = (key) => {
        if (!result.has(key)) result.set(key, {platforms: [], failures: [], missing: []});
        return result.get(key);
    };

    for (const group of groups) {
        const name = groupNameOf(group);
        const ownerKeys = owners.get(name) ?? new Set();
        if (ownerKeys.size === 0) continue;

        const platform = `${group?.configs?.controller ?? "?"}-${group?.configs?.resource ?? "?"}`;

        for (const testCase of group.cases) {
            const imagePath = resolveImage(group, testCase.image);
            const missing = isImageMissing(group, testCase);

            for (const ownerKey of ownerKeys) {
                const ownerEntry = entries.find((candidate) => candidate.key === ownerKey);
                if (!ownerEntry) continue;
                const index = ownerEntry.testFile.cases.findIndex((candidate) => sameCaseShape(candidate, testCase));
                if (index < 0) continue;

                const slot = slotOf(`${ownerKey}#${index}`);
                if (!slot.platforms.includes(platform)) slot.platforms.push(platform);

                if (missing) {
                    if (!slot.missing.some((item) => item.platform === platform)) {
                        slot.missing.push({platform, image: testCase.image, path: imagePath});
                    }
                    continue;
                }

                for (const detail of details) {
                    if (detail?.imagePath !== imagePath) continue;
                    const verdict = classifyErrorEntry(detail, testCase);
                    if (verdict.ok) continue;
                    const duplicated = slot.failures.some(
                        (item) =>
                            item.platform === platform && item.node === verdict.node && item.reason === verdict.reason,
                    );
                    if (duplicated) continue;
                    slot.failures.push({
                        platform,
                        node: verdict.node,
                        reason: verdict.reason,
                        algorithm: verdict.algorithm ?? null,
                        image: testCase.image,
                    });
                }
            }
        }
    }

    // 只留下有问题的用例：全绿的不必报，省得调用方还得自己筛
    for (const [
        key,
        info,
    ] of result) {
        if (!hasCaseProblem(info)) result.delete(key);
    }

    return result;
}

/**
 * 一条用例的失败文案，拆成「短标题」和「展开后的列表项」两块：
 *   title —— 面板节点上就显示这一行，越短越好（哪个平台失败）
 *   lines —— 展开测试结果后看到的明细列表（哪个节点、什么原因、哪张截图、哪些平台是好的）
 */
export function formatCaseFailure(info) {
    const failedPlatforms = unique(info.failures.map((item) => item.platform));
    const missingPlatforms = unique(info.missing.map((item) => item.platform)).filter(
        (item) => !failedPlatforms.includes(item),
    );
    const passedPlatforms = info.platforms.filter(
        (item) => !failedPlatforms.includes(item) && !missingPlatforms.includes(item),
    );

    const title =
        failedPlatforms.length > 0
            ? `${failedPlatforms.join("、")} 失败`
            : `${missingPlatforms.join("、") || "全部平台"} 没验证到`;

    const lines = [];
    for (const item of info.failures) {
        const algorithm = item.algorithm ? `（算法 ${item.algorithm}）` : "";
        // 多个平台同时失败时，每条前面点明是哪个平台，免得看完标题还要猜
        const prefix = failedPlatforms.length > 1 ? `${item.platform}：` : "";
        lines.push(`${prefix}节点 \`${item.node}\` ${item.reason}${algorithm}`);
        lines.push(`截图 \`${item.image}\`（${item.platform}）`);
    }
    for (const item of info.missing) {
        if (!missingPlatforms.includes(item.platform)) continue;
        lines.push(`截图不存在 \`${item.path}\`，这条用例在这个平台上被跳过`);
    }

    if (passedPlatforms.length > 0) lines.push(`通过：${passedPlatforms.join("、")}`);
    else if (failedPlatforms.length > 0) lines.push(`所有能跑的平台都失败：${failedPlatforms.join("、")}`);

    if (failedPlatforms.length === 0 && info.missing.length > 0) {
        lines.push(`这条用例没有真正验证：缺图的平台是 ${missingPlatforms.join("、")}`);
    }

    return {title, lines};
}

/** 去重但保留顺序 */
function unique(items) {
    return [...new Set(items)];
}

/** 一条用例是否需要报出来（有失败或缺图） */
export function hasCaseProblem(info) {
    return info.failures.length > 0 || info.missing.length > 0;
}

/** 组名要和 lib/filter.mjs 的 groupName 完全一致（避免循环 import，这里抄一份等价实现） */
function groupNameOf(group) {
    const configs = group?.configs ?? {};
    return configs.name ?? `${configs.controller}:${configs.resource}`;
}

/** 两条用例是不是同一个场景：图片名 + 命中节点集合一致即可（供入口判「截图缺失」时复用） */
export function sameCaseShape(left, right) {
    if (left?.image !== right?.image) return false;
    const leftNodes = nodeNamesOf(left).sort().join(",");
    const rightNodes = nodeNamesOf(right).sort().join(",");
    return leftNodes === rightNodes;
}

function nodeNamesOf(testCase) {
    const names = [];
    for (const hit of Array.isArray(testCase?.hits) ? testCase.hits : []) {
        if (typeof hit === "string") names.push(hit);
        else if (hit && typeof hit === "object" && typeof hit.node === "string") names.push(hit.node);
    }
    return [...new Set(names)];
}

/** 结果行的固定格式，调用方（VS Code 扩展）按前缀解析 */
export function formatFileResultLine(fileKey, verdict) {
    return `RESULT-FILE: ${fileKey} ${verdict}`;
}

/**
 * 整批的结论：有失败就是 fail；有没能跑的文件就是 error；全都跑过且通过才是 pass。
 * 优先级 error > fail 因为「没跑起来」比「跑了但不通过」更需要人看。
 */
export function overallVerdict(fileResults) {
    const verdicts = [...fileResults.values()];
    if (verdicts.length === 0) return "empty";
    if (verdicts.includes("error") || verdicts.includes("unknown")) return "error";
    if (verdicts.includes("fail")) return "fail";
    return "pass";
}

/** fail 比 pass 严重，pass 比 unknown 严重 */
function pickWorse(left, right) {
    const order = {unknown: 0, pass: 1, fail: 2};
    return (order[right] ?? 0) > (order[left] ?? 0) ? right : left;
}
