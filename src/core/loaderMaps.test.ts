import {strict as assert} from "node:assert";
import {test} from "node:test";
import {EMPTY_LOADER_MAPS, parseLoaderMaps, resolveControllerDir} from "./loaderMaps";

/** 照 MaaEnd 的 tests/scripts/loader.mts 抄的片段：注释掉的条目、单引号、空值都出现了 */
const LOADER_TEXT = `
export async function fetchCases(): Promise<TestCases[]> {
  const resourceMap: Record<string, string> = {
    官服: 'Official_CN',
    // 'B 服': '',
    // Global: '',
  }
  const controllerMap: Record<string, string> = {
    Win32: 'Win32',
    'Win32-Front': 'Win32',
    ADB: 'ADB',
    CloudADB: 'CloudADB',
    // 'PlayCover': '',
  }
  return []
}
`;

test("loader 映射：读出 controller 和 resource，注释掉的条目不算", () => {
    const maps = parseLoaderMaps(LOADER_TEXT);

    assert.deepEqual(
        maps.controllers.map((entry) => [
            entry.name,
            entry.dir,
        ]),
        [
            [
                "Win32",
                "Win32",
            ],
            [
                "Win32-Front",
                "Win32",
            ],
            [
                "ADB",
                "ADB",
            ],
            [
                "CloudADB",
                "CloudADB",
            ],
        ],
    );
    assert.deepEqual(
        maps.resources.map((entry) => [
            entry.name,
            entry.dir,
        ]),
        [
            [
                "官服",
                "Official_CN",
            ],
        ],
    );
});

test("loader 映射：值是空字符串时算「没有目录」，不是空名字", () => {
    const maps = parseLoaderMaps(`const controllerMap = { PlayCover: '' }`);
    assert.deepEqual(maps.controllers, [{name: "PlayCover", dir: null}]);
});

test("loader 映射：文件里没有映射表就返回空", () => {
    assert.deepEqual(parseLoaderMaps("export function nothing() {}"), EMPTY_LOADER_MAPS);
    assert.deepEqual(parseLoaderMaps(""), EMPTY_LOADER_MAPS);
});

test("loader 映射：显示名换成目录名，别名指向同一个目录", () => {
    const maps = parseLoaderMaps(LOADER_TEXT);
    assert.equal(resolveControllerDir(maps, "Win32-Front"), "Win32");
    assert.equal(resolveControllerDir(maps, "CloudADB"), "CloudADB");
    // loader 里没登记的名字原样返回，别把它变成空
    assert.equal(resolveControllerDir(maps, "Switch"), "Switch");
});
