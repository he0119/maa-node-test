import assert from "node:assert/strict";
import {test} from "node:test";

import {filterGroups, filterGroupsForFiles, groupLabel, groupName} from "./filter.mjs";

/** 造一个「loader.mts 展开后」的组：组名是 `(controller-resource)name`，cases 里 hits 已规整。 */
function makeGroup({controller, resource, name, cases}) {
    return {
        configs: {
            name: `(${controller}-${resource})${name ?? "<unnamed>"}`,
            controller,
            resource,
            imageRoot: `${controller}/Official_CN`,
        },
        cases,
    };
}

const target = (overrides) => ({
    controllers: ["Win32"],
    resources: ["官服"],
    name: null,
    caseKeys: [],
    ...overrides,
});

test("命中：保留 controller/resource 对得上的组，并只留目标用例", () => {
    const win32 = makeGroup({
        controller: "Win32",
        resource: "官服",
        name: "按钮",
        cases: [
            {image: "a.png", hits: ["CloseButton"]},
            {image: "b.png", hits: ["InWorld"]},
        ],
    });
    const adb = makeGroup({
        controller: "ADB",
        resource: "官服",
        name: "按钮",
        cases: [{image: "a.png", hits: ["CloseButton"]}],
    });

    const result = filterGroups(
        [
            win32,
            adb,
        ],
        target({caseKeys: ["a.png|CloseButton"]}),
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].configs.controller, "Win32");
    assert.deepEqual(result[0].cases, [{image: "a.png", hits: ["CloseButton"]}]);
});

test("不就地修改传入的组和用例数组", () => {
    const group = makeGroup({
        controller: "Win32",
        resource: "官服",
        cases: [
            {image: "a.png", hits: ["A"]},
            {image: "b.png", hits: ["B"]},
        ],
    });
    const groups = [group];
    const result = filterGroups(groups, target({caseKeys: ["a.png|A"]}));

    assert.equal(group.cases.length, 2, "原组的 cases 不能被裁剪");
    assert.notEqual(result[0], group, "返回的应该是新组对象");
    assert.notEqual(result[0].cases, group.cases, "返回的应该是新 cases 数组");
});

test("controller 不在声明列表里 → 丢弃", () => {
    const group = makeGroup({controller: "ADB", resource: "官服", cases: [{image: "a.png", hits: []}]});
    assert.deepEqual(filterGroups([group], target({caseKeys: ["a.png|"]})), []);
});

test("resource 不在声明列表里 → 丢弃", () => {
    const group = makeGroup({controller: "Win32", resource: "B服", cases: [{image: "a.png", hits: []}]});
    assert.deepEqual(filterGroups([group], target({caseKeys: ["a.png|"]})), []);
});

test("声明了 configs.name 时，组名必须以 `)<name>` 结尾", () => {
    const matched = makeGroup({
        controller: "Win32",
        resource: "官服",
        name: "按钮",
        cases: [{image: "a.png", hits: []}],
    });
    const other = makeGroup({
        controller: "Win32",
        resource: "官服",
        name: "通用按钮",
        cases: [{image: "a.png", hits: []}],
    });
    const result = filterGroups(
        [
            matched,
            other,
        ],
        target({name: "按钮", caseKeys: ["a.png|"]}),
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].configs.name, "(Win32-官服)按钮");
});

test("没声明 configs.name 时不校验组名后缀", () => {
    const group = makeGroup({
        controller: "Win32",
        resource: "官服",
        name: "随便什么名字",
        cases: [{image: "a.png", hits: []}],
    });
    const result = filterGroups([group], target({name: null, caseKeys: ["a.png|"]}));
    assert.equal(result.length, 1);
});

test("组内一个目标用例都没有 → 整组丢弃（这是区分同 controller/resource 的其它文件的关键）", () => {
    const otherFile = makeGroup({
        controller: "Win32",
        resource: "官服",
        name: "按钮",
        cases: [{image: "别人的图.png", hits: ["CloseButton"]}],
    });
    assert.deepEqual(filterGroups([otherFile], target({name: "按钮", caseKeys: ["a.png|CloseButton"]})), []);
});

test("hits 写成 {node, box} 的用例同样能命中", () => {
    const group = makeGroup({
        controller: "Win32",
        resource: "官服",
        cases: [
            {
                image: "a.png",
                hits: [
                    {
                        node: "SpecialButton",
                        box: [
                            1,
                            2,
                            3,
                            4,
                        ],
                    },
                    "InWorld",
                ],
            },
        ],
    });
    const keys = ["a.png|InWorld,SpecialButton"];
    const result = filterGroups([group], target({caseKeys: keys}));
    assert.equal(result.length, 1);
    assert.equal(result[0].cases.length, 1);
});

test("多组时顺序保持，空数组返回空数组", () => {
    const first = makeGroup({controller: "Win32", resource: "官服", cases: [{image: "a.png", hits: []}]});
    const second = makeGroup({
        controller: "Win32",
        resource: "官服",
        cases: [
            {image: "a.png", hits: []},
            {image: "b.png", hits: []},
        ],
    });
    const result = filterGroups(
        [
            first,
            second,
        ],
        target({caseKeys: ["a.png|"]}),
    );
    assert.equal(result.length, 2);
    assert.equal(result[1].cases.length, 1);
    assert.deepEqual(filterGroups([], target({})), []);
    assert.deepEqual(filterGroups(undefined, target({})), []);
});

test("groupName / groupLabel 按 loader 的组名格式与简写给出", () => {
    const group = makeGroup({controller: "Win32", resource: "官服", name: "按钮", cases: []});
    assert.equal(groupName(group), "(Win32-官服)按钮");
    assert.equal(groupLabel(group), "Win32-官服");
    assert.equal(groupLabel({configs: {controller: "ADB", resource: "官服"}}), "ADB-官服");
});

test("批量：一个组只被一个文件命中时，owners 只记那个文件", () => {
    const group = makeGroup({
        controller: "Win32",
        resource: "官服",
        name: "按钮",
        cases: [{image: "a.png", hits: ["CloseButton"]}],
    });
    const entries = [
        {key: "tests/a/test_a.json", target: target({caseKeys: ["a.png|CloseButton"]})},
        {key: "tests/b/test_b.json", target: target({caseKeys: ["b.png|InWorld"]})},
    ];

    const {groups, owners} = filterGroupsForFiles([group], entries);
    assert.equal(groups.length, 1);
    assert.deepEqual([...owners.get(groupName(group))], ["tests/a/test_a.json"]);
});

test("批量：两个文件命中同一个组时，owners 记两份、用例取并集", () => {
    const group = makeGroup({
        controller: "Win32",
        resource: "官服",
        name: "复用截图",
        cases: [
            {image: "shared.png", hits: ["A"]},
            {image: "shared.png", hits: ["B"]},
        ],
    });
    const entries = [
        {key: "tests/a/test_a.json", target: target({name: "复用截图", caseKeys: ["shared.png|A"]})},
        {key: "tests/b/test_b.json", target: target({name: "复用截图", caseKeys: ["shared.png|B"]})},
    ];

    const {groups, owners} = filterGroupsForFiles([group], entries);
    assert.equal(groups[0].cases.length, 2);
    assert.deepEqual([...owners.get(groupName(group))].sort(), [
        "tests/a/test_a.json",
        "tests/b/test_b.json",
    ]);
});

test("批量：命中组名条件但一条用例都不属于它的文件，不算这个组的负责人", () => {
    const group = makeGroup({
        controller: "Win32",
        resource: "官服",
        name: "按钮",
        cases: [{image: "a.png", hits: ["CloseButton"]}],
    });
    const entries = [
        {key: "tests/a/test_a.json", target: target({name: "按钮", caseKeys: ["a.png|CloseButton"]})},
        // 这个文件也声明了同名同 controller/resource，但用例键完全不同 → 不该背这个组的结论
        {key: "tests/c/test_c.json", target: target({name: "按钮", caseKeys: ["z.png|Other"]})},
    ];

    const {groups, owners} = filterGroupsForFiles([group], entries);
    assert.equal(groups.length, 1);
    assert.deepEqual([...owners.get(groupName(group))], ["tests/a/test_a.json"]);
});

test("批量：不同 controller 的文件各拿各的组", () => {
    const win32 = makeGroup({
        controller: "Win32",
        resource: "官服",
        name: "按钮",
        cases: [{image: "a.png", hits: ["X"]}],
    });
    const adb = makeGroup({controller: "ADB", resource: "官服", name: "按钮", cases: [{image: "a.png", hits: ["X"]}]});
    const entries = [
        {key: "tests/win/test_w.json", target: target({caseKeys: ["a.png|X"]})},
        {key: "tests/adb/test_a.json", target: target({controllers: ["ADB"], caseKeys: ["a.png|X"]})},
    ];

    const {groups, owners} = filterGroupsForFiles(
        [
            win32,
            adb,
        ],
        entries,
    );
    assert.equal(groups.length, 2);
    assert.deepEqual([...owners.get(groupName(win32))], ["tests/win/test_w.json"]);
    assert.deepEqual([...owners.get(groupName(adb))], ["tests/adb/test_a.json"]);
});
