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
