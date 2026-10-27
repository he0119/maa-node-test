import {strict as assert} from "node:assert";
import {test} from "node:test";
import {normalizeResourceName, parseControllerResources, resourcesForControllers} from "./resources";

/** 照 MaaEnd 的 interface.json 抄的片段：不同控制器挂不同资源目录 */
const INTERFACE_TEXT = `{
    "interface_version": 2,
    "controller": [
        {"name": "Win32-Front", "type": "Win32"},
        {"name": "ADB", "type": "Adb", "attach_resource_path": ["./resource_adb"]},
        {
            "name": "CloudADB",
            "type": "Adb",
            "attach_resource_path": ["./resource_adb", "./resource_cloud_adb"]
        },
        {"name": "MacOS-Front", "attach_resource_path": ["./resource_macos"]},
    ]
}`;

test("控制器资源映射：读 attach_resource_path，没挂的算空", () => {
    const mapping = parseControllerResources(INTERFACE_TEXT);
    assert.deepEqual(mapping, [
        {name: "Win32-Front", attachResources: []},
        {name: "ADB", attachResources: ["resource_adb"]},
        {
            name: "CloudADB",
            attachResources: [
                "resource_adb",
                "resource_cloud_adb",
            ],
        },
        {name: "MacOS-Front", attachResources: ["resource_macos"]},
    ]);
});

test("控制器资源映射：路径写法规整", () => {
    assert.equal(normalizeResourceName("./resource_adb"), "resource_adb");
    assert.equal(normalizeResourceName("resource_adb/"), "resource_adb");
    assert.equal(normalizeResourceName("/resource_adb"), "resource_adb");
    assert.equal(normalizeResourceName(".\\resource_adb"), "resource_adb");
});

test("要扫的资源：基础资源 + 声明控制器挂的目录", () => {
    const mapping = parseControllerResources(INTERFACE_TEXT);
    const available = [
        "resource",
        "resource_adb",
        "resource_cloud_adb",
        "resource_macos",
    ];

    // Win32：只在基础资源里
    assert.deepEqual(resourcesForControllers(["Win32"], mapping, available), ["resource"]);
    // ADB：基础 + resource_adb
    assert.deepEqual(resourcesForControllers(["ADB"], mapping, available), [
        "resource",
        "resource_adb",
    ]);
    // CloudADB：基础 + resource_adb + resource_cloud_adb
    assert.deepEqual(resourcesForControllers(["CloudADB"], mapping, available), [
        "resource",
        "resource_adb",
        "resource_cloud_adb",
    ]);
    // 多个控制器取并集，不重复
    assert.deepEqual(
        resourcesForControllers(
            [
                "ADB",
                "MacOS-Front",
            ],
            mapping,
            available,
        ),
        [
            "resource",
            "resource_adb",
            "resource_macos",
        ],
    );
});

test("要扫的资源：映射里查不到的控制器只扫基础资源，没有映射就扫全部", () => {
    const mapping = parseControllerResources(INTERFACE_TEXT);
    const available = [
        "resource",
        "resource_adb",
    ];

    // `Win32` 在 interface.json 里叫 `Win32-Front`，查不到 → 只有基础资源
    assert.deepEqual(resourcesForControllers(["Win32"], mapping, available), ["resource"]);
    // 没装 interface.json（映射为空）→ 全扫，别让补全悄悄变空
    assert.deepEqual(resourcesForControllers(["Win32"], [], available), [
        "resource",
        "resource_adb",
    ]);
});

test("控制器资源映射：坏文件返回空，不抛异常", () => {
    assert.deepEqual(parseControllerResources("not json"), []);
    assert.deepEqual(parseControllerResources("{}"), []);
    assert.deepEqual(parseControllerResources(""), []);
});
