/**
 * 从 `tests/scripts/loader.mts` 里读出 controller / resource 的映射。
 *
 * 为什么需要它：测试文件里写的是**显示名**（`Win32-Front`、`官服`），截图目录用的是**目录名**
 * （`Win32`、`Official_CN`），两套名字由 loader 里的 `controllerMap` / `resourceMap` 对应。
 * 插件要做三件事都离不开这张表：
 * - 补全 `controller` / `resource` 时给出合法取值；
 * - 判断「声明的平台有没有截图」时把显示名换成目录名（否则 `Win32-Front` 会被误报成缺目录）；
 * - 悬浮预览时按目录名找图，但提示里要显示用户写的名字。
 */

/** 一条映射：测试文件里写的名字 → 截图目录名 */
export interface LoaderEntry {
    /** 测试文件里写的名字，例如 `Win32-Front`、`官服` */
    name: string;
    /** 对应的截图目录名，例如 `Win32`、`Official_CN`；loader 里写成空字符串时是 null（还没目录） */
    dir: string | null;
}

export interface LoaderMaps {
    controllers: LoaderEntry[];
    resources: LoaderEntry[];
}

/** 读不出来时的空表，调用方不用到处判空 */
export const EMPTY_LOADER_MAPS: LoaderMaps = {controllers: [], resources: []};

/**
 * 解析 loader 源码里的两张映射表。用正则而不是 TS 解析器：这里只要两个对象字面量的键值，
 * 引入一个 TypeScript 解析器来读 4KB 文件不值得。
 */
export function parseLoaderMaps(text: string): LoaderMaps {
    return {
        controllers: parseMapBody(objectBodyOf(text, "controllerMap")),
        resources: parseMapBody(objectBodyOf(text, "resourceMap")),
    };
}

/** 找 `xxxMap = { ... }` 的对象字面量正文，括号配对到对应的 `}` */
function objectBodyOf(text: string, variableName: string): string | null {
    const pattern = new RegExp(`(?:const|let|var)\\s+${variableName}\\b[^=]*=\\s*\\{`);
    const matched = pattern.exec(text);
    if (!matched) return null;

    const start = matched.index + matched[0].length;
    let depth = 1;
    for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (char === "{") depth += 1;
        else if (char === "}") {
            depth -= 1;
            if (depth === 0) return stripLineComments(text.slice(start, index));
        }
    }
    return null;
}

/** 去掉整行注释和行尾注释；注释里的条目（loader 里常用它占位）不应该出现在补全里 */
function stripLineComments(body: string): string {
    const kept: string[] = [];
    for (const line of body.split("\n")) {
        let cut = line.length;
        let quote: string | null = null;
        for (let index = 0; index < line.length; index += 1) {
            const char = line[index];
            if (quote) {
                if (char === quote) quote = null;
                continue;
            }
            if (char === '"' || char === "'") {
                quote = char;
                continue;
            }
            if (char === "/" && line[index + 1] === "/") {
                cut = index;
                break;
            }
        }
        kept.push(line.slice(0, cut));
    }
    return kept.join("\n");
}

/** 解析 `名称: '目录'` 这种条目，键和值都允许单引号、双引号或无引号 */
function parseMapBody(body: string | null): LoaderEntry[] {
    if (!body) return [];

    const entries: LoaderEntry[] = [];
    const pattern =
        // 键可能是 `官服` 这种中文，也可能带引号；值只认字符串字面量
        /(['"])((?:(?!\1).)*)\1\s*:\s*(['"])((?:(?!\3).)*)\3|([^\s:,'"{}]+)\s*:\s*(['"])((?:(?!\6).)*)\6/g;
    for (const matched of body.matchAll(pattern)) {
        const name = matched[2] ?? matched[5];
        const dir = matched[4] ?? matched[7];
        if (!name) continue;
        entries.push({name, dir: dir ? dir : null});
    }
    return entries;
}

/** 显示名 → 目录名；表里没有就原样返回（可能是用户自己写的、loader 没映射的名字） */
export function dirOf(entry: LoaderEntry): string {
    return entry.dir ?? entry.name;
}

/** 用 maps 把声明的 controller 名字换成截图目录名 */
export function resolveControllerDir(maps: LoaderMaps, controller: string): string {
    const hit = maps.controllers.find((entry) => entry.name === controller);
    return hit ? dirOf(hit) : controller;
}
