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

/** 这个组是否可能属于该 target（controller / resource / 组名后缀三条） */
export function groupMatchesTarget(group, target) {
    const configs = group?.configs ?? {};
    if (!target.controllers.includes(configs.controller)) return false;
    if (!target.resources.includes(configs.resource)) return false;
    // 目标文件没写 configs.name 就不校验组名后缀：此时组名是 `(controller-resource)<unnamed>`，不该拿来比。
    if (target.name && !(typeof configs.name === "string" && configs.name.endsWith(`)${target.name}`))) return false;
    return true;
}

/**
 * 批量过滤：一张组表，多个目标文件。
 *
 * entries 形如 [{ key, target }]，key 用来在结果里区分是哪个文件（入口传相对路径）。
 * 返回：
 *   groups —— 过滤后的组（新对象、新 cases 数组，绝不就地修改入参）
 *   owners —— 组名 → 这个组覆盖了哪些目标文件（跑完之后按组判定结果时用）
 *
 * 一个组可能同时被多个目标文件命中（它们复用了同一批截图，controller/resource/name 又恰好相同），
 * 这时组里的用例是两份的并集，owners 也记两边的 key —— 判定结果时两个文件一起承担。
 */
export function filterGroupsForFiles(groups, entries) {
    const safeGroups = Array.isArray(groups) ? groups : [];
    const safeEntries = Array.isArray(entries) ? entries : [];
    const owners = new Map();
    const kept = [];

    for (const group of safeGroups) {
        const matched = safeEntries.filter((entry) => groupMatchesTarget(group, entry.target));
        if (matched.length === 0) continue;

        const keys = new Set();
        for (const entry of matched) for (const key of entry.target.caseKeys) keys.add(key);

        const cases = Array.isArray(group.cases) ? group.cases.filter((testCase) => keys.has(caseKey(testCase))) : [];
        if (cases.length === 0) continue;

        // 只有真正贡献了用例的文件才算这个组的「负责人」：
        // 若某个文件命中组名条件但一条用例都没留下，说明这个组其实是别人的。
        const caseKeys = cases.map((testCase) => caseKey(testCase));
        const contributing = matched.filter((entry) => caseKeys.some((key) => entry.target.caseKeys.includes(key)));
        if (contributing.length === 0) continue;

        kept.push({...group, cases});
        const name = groupName(group);
        if (!owners.has(name)) owners.set(name, new Set());
        for (const entry of contributing) owners.get(name).add(entry.key);
    }

    return {groups: kept, owners};
}

/**
 * 单个文件的过滤，返回过滤后的组。等价于只有一个 entry 的 filterGroupsForFiles。
 * 保留这个签名是为了让调用方和单测读起来更直白。
 */
export function filterGroups(groups, target) {
    return filterGroupsForFiles(groups, [{key: null, target}]).groups;
}
