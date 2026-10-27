// 用例键：把一条测试用例压成一个字符串，用来在 maa-tools 展开出来的测试组里找回「我这一条」。
//
// 键 = `<image>|<命中的节点名按字典序用逗号连接>`
//
// 为什么用 image + 命中节点：maa-tools 拿到的是 loader.mts 展开后的组，组对象里只剩
// configs 和 cases，没有来源文件名。同一张截图 + 同一组期望命中的节点，就是同一个测试场景，
// 用它当键足够区分不同用例。

/** hits 里的一个元素可能是字符串，也可能是 { node, box }。这里统一取出节点名。 */
export function hitNodeName(hit) {
    if (typeof hit === "string") return hit;
    if (hit && typeof hit === "object" && typeof hit.node === "string") return hit.node;
    return null;
}

/** 取出 hits 里所有节点名，保持书写顺序。 */
export function hitNodeNames(hits) {
    if (!Array.isArray(hits)) return [];
    const names = [];
    for (const hit of hits) {
        const name = hitNodeName(hit);
        if (name !== null) names.push(name);
    }
    return names;
}

/**
 * 算用例键。
 * - 排序：hits 的书写顺序不代表语义，同一张图换个顺序还是同一个场景。
 * - 去重：同一个节点重复写两遍不构成新场景。
 * - 空 hits（负例）得到 `<image>|`，同样是合法且需要区分的键。
 */
export function caseKey(testCase) {
    const image = typeof testCase?.image === "string" ? testCase.image : "";
    const nodes = [...new Set(hitNodeNames(testCase?.hits))].sort();
    return `${image}|${nodes.join(",")}`;
}
