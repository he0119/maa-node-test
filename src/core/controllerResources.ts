import {findNodeAtLocation, parseTree} from "jsonc-parser";

/**
 * 控制器 → 它要加载哪些资源目录。
 *
 * 来源是 `assets/interface.json` 的 `controller[].attach_resource_path`。例如 CloudADB 会挂
 * `./resource_adb` 和 `./resource_cloud_adb`，所以那份测试文件跑的时候，这两个目录里的 pipeline
 * 也会加载 —— 补全和跳转就该只看这几个目录，别把别的平台的东西也列出来。
 */
export interface ControllerResources {
    /** 控制器名，和测试文件、loader 里写的是同一套名字 */
    name: string;
    /** 附加的资源目录名，例如 `resource_adb`；基础资源 `resource` 不在这里，它是默认加载的 */
    attachResources: string[];
}

/** 基础资源目录名：所有控制器都会加载 */
export const BASE_RESOURCE = "resource";

/** 解析 interface.json 里的控制器 → 资源目录映射；读不懂就当没有映射 */
export function parseControllerResources(text: string): ControllerResources[] {
    const root = parseTree(text);
    if (!root || root.type !== "object") return [];

    const controllers = findNodeAtLocation(root, ["controller"]);
    if (!controllers || controllers.type !== "array") return [];

    const result: ControllerResources[] = [];
    for (const entry of controllers.children ?? []) {
        if (entry.type !== "object") continue;

        const name = findNodeAtLocation(entry, ["name"]);
        if (typeof name?.value !== "string") continue;

        const attach = findNodeAtLocation(entry, ["attach_resource_path"]);
        const attachResources: string[] = [];
        for (const item of attach?.children ?? []) {
            if (typeof item.value !== "string") continue;
            const normalized = normalizeResourceName(item.value);
            if (normalized) attachResources.push(normalized);
        }
        result.push({name: name.value, attachResources});
    }
    return result;
}

/** `./resource_adb`、`resource_adb/` 之类都规整成 `resource_adb` */
export function normalizeResourceName(value: string): string {
    return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * 算出一份测试文件要扫哪些资源目录（按 `available` 里真实存在的挑）：
 * - 基础资源 `resource` 总是要扫；
 * - 加上声明控制器挂的目录；
 * - 声明了但映射表里没有的控制器（比如 `Win32` 在 interface.json 里叫 `Win32-Front`）就只多扫基础资源；
 * - 映射表根本没有（没装 interface.json）时退回「扫全部」，别让补全悄悄变空。
 */
export function resourcesForControllers(
    controllers: readonly string[],
    mapping: readonly ControllerResources[],
    available: readonly string[],
): string[] {
    if (mapping.length === 0) return [...available];

    const wanted = new Set<string>();
    if (available.includes(BASE_RESOURCE)) wanted.add(BASE_RESOURCE);

    for (const controller of controllers) {
        const entry = mapping.find((item) => item.name === controller);
        for (const resource of entry?.attachResources ?? []) {
            if (available.includes(resource)) wanted.add(resource);
        }
    }

    // 一个都没匹配到也要给基础资源，否则补全里一个节点都没有
    if (wanted.size === 0 && available.includes(BASE_RESOURCE)) wanted.add(BASE_RESOURCE);
    return [...wanted];
}
