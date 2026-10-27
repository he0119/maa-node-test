import {caseKey} from "./case-key.mjs";

// 从「maa-tools 展开后的全部测试组」里，只留下属于目标测试文件的组和用例。
//
// ── 为什么不能只看组名 ─────────────────────────────────────────────
// maa-tools 只有全量 test，它把整个 tests/ 目录交给配置里的 test.cases（这里是
// tests/scripts/loader.mts 的 fetchCases）。fetchCases 把每个文件按 controller × resource 展开成若干组，
// 组对象里只剩 configs 和 cases —— 「这个组来自哪个文件」的信息已经丢了。
// 组名也只有 `(controller-resource)name` 两段（name 来自 configs.name，可能重名）。
//
// 所以这里用三个条件一起收窄，缺一不可：
//   1. 组的 configs.controller 必须出现在目标文件声明的 controller 列表里；
//   2. 组的 configs.resource 必须出现在目标文件声明的 resource 列表里；
//   3. 组内用例的键（image + 期望命中的节点集合）必须命中目标文件的用例键集合。
// 第 3 条是关键：同一个 controller/resource 下往往有几十个测试文件，只靠 1、2 会直接把别人的用例
// 一起跑掉；靠第 3 条把这些用例滤掉后，别人的组会变成空组，被整组丢弃。
//
// 另外，如果本文件声明了 configs.name，还要求组名以 `)<name>` 结尾：
// loader.mts 里组名就是 `${(controller-resource)}${name ?? '<unnamed>'}`，
// 加这一条是为了在同 controller/resource 且用例键恰好也相同（复用同一批截图）时进一步区分。

/** 组的显示名，和 maa-tools 打印组名的方式保持一致。 */
export function groupName(group) {
    const configs = group?.configs ?? {};
    return configs.name ?? `${configs.controller}:${configs.resource}`;
}

/** 组的简称，例如 `Win32-官服`，用于人话日志。 */
export function groupLabel(group) {
    const configs = group?.configs ?? {};
    return `${configs.controller}-${configs.resource}`;
}

/**
 * 过滤测试组。返回新数组、新组对象、新 cases 数组，绝不就地修改传入的对象 ——
 * 调用方（包括 runTest 内部）可能还拿着原对象，就地改会很难排查。
 */
export function filterGroups(groups, target) {
    if (!Array.isArray(groups)) return [];

    const controllers = new Set(target?.controllers ?? []);
    const resources = new Set(target?.resources ?? []);
    const caseKeys = new Set(target?.caseKeys ?? []);
    // 目标文件没写 configs.name 就不校验组名后缀：此时组名是 `(controller-resource)<unnamed>`，不该拿来比。
    const nameSuffix = target?.name ? `)${target.name}` : null;

    const kept = [];
    for (const group of groups) {
        const configs = group?.configs ?? {};

        if (!controllers.has(configs.controller)) continue;
        if (!resources.has(configs.resource)) continue;
        if (nameSuffix !== null && !(typeof configs.name === "string" && configs.name.endsWith(nameSuffix))) continue;

        const cases = Array.isArray(group.cases) ? group.cases : [];
        const matchedCases = cases.filter((testCase) => caseKeys.has(caseKey(testCase)));
        if (matchedCases.length === 0) continue;

        kept.push({...group, cases: matchedCases});
    }
    return kept;
}
