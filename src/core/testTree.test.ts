import {strict as assert} from "node:assert";
import {test} from "node:test";
import {
    type CollectedCase,
    type CollectedFile,
    buildFileNode,
    caseNodeId,
    collectRunTargets,
    describeCaseDescription,
    describeCaseLabel,
    describeFileDescription,
    fileNodeId,
    fileNameOf,
    folderSegments,
    toPosix,
} from "./testTree";

/** 原文样例：夹具里的字符偏移按它算，断言时能切出用例原文 */
const SAMPLE = `{
  // 测试面板用的样例
  "configs": {
    "name": "通用按钮",
    "resource": "官服",
    "controller": ["Win32", "ADB"],
  },
  "cases": [
    { "name": "大世界主页", "image": "帝江号_大世界.png", "hits": ["InWorld"] },
    { "image": "四号谷地_地区建设.png", "hits": ["InRegionalDevelopment", "InRegionalDevelopmentValleyIV"] },
    { "hits": [] },
  ],
}`;

/** 从 SAMPLE 里定位一个用例对象的字符区间（真实偏移由 maa-tools 收集时给出） */
function span(snippet: string): {start: number; end: number} {
    const start = SAMPLE.indexOf(`{ ${snippet}`);
    assert.notEqual(start, -1, `样例里找不到 ${snippet}`);
    return {start, end: start + SAMPLE.slice(start).indexOf("}") + 1};
}

const CASES: CollectedCase[] = [
    {index: 0, name: "大世界主页", image: "帝江号_大世界.png", hits: ["InWorld"], ...span('"name": "大世界主页"')},
    {
        index: 1,
        name: null,
        image: "四号谷地_地区建设.png",
        hits: [
            "InRegionalDevelopment",
            "InRegionalDevelopmentValleyIV",
        ],
        ...span('"image": "四号谷地_地区建设.png"'),
    },
    {index: 2, name: null, image: "", hits: [], ...span('"hits": []')},
];

const FILE: CollectedFile = {
    file: "tests/a/test_x.json",
    name: "通用按钮",
    controllers: [
        "Win32",
        "ADB",
    ],
    resources: ["官服"],
    cases: CASES,
};

test("用例标题：优先 name，其次图片名去扩展名，最后退化成序号", () => {
    assert.equal(describeCaseLabel(CASES[0]), "大世界主页");
    assert.equal(describeCaseLabel(CASES[1]), "四号谷地_地区建设");
    assert.equal(describeCaseLabel(CASES[2]), "第 3 个用例");
});

test("用例灰字：有 name 时带图片名，没有就只写命中情况，不再重复标题", () => {
    assert.equal(describeCaseDescription(CASES[0]), "帝江号_大世界.png · 命中 1 个节点");
    assert.equal(describeCaseDescription(CASES[1]), "命中 2 个节点");
    assert.equal(describeCaseDescription(CASES[2]), "没写 image · 负例（不该命中）");
});

test("文件灰字：组名 + 平台/资源矩阵", () => {
    assert.equal(describeFileDescription(FILE), "通用按钮 · Win32/ADB × 官服");

    const unnamed: CollectedFile = {
        file: "tests/a/test_x.json",
        name: null,
        controllers: [],
        resources: ["官服"],
        cases: [],
    };
    assert.match(describeFileDescription(unnamed), /未命名测试组（tests\/a\/test_x\.json）/);
    assert.match(describeFileDescription(unnamed), /未写 controller/);
});

test("节点 id 由绝对路径拼出来，同一文件刷新后不变", () => {
    const file = "C:/repo/tests/Common/Button/test_close_button.json";
    assert.equal(fileNodeId(file), `${file}#file`);
    assert.equal(caseNodeId(file, 0), `${file}#case-0`);
    assert.notEqual(caseNodeId(file, 0), caseNodeId(file, 1));
    assert.notEqual(fileNodeId(file), caseNodeId(file, 0));
});

test("建出来的文件节点：区间原样来自收集结果，能切出用例原文", () => {
    const node = buildFileNode(FILE, "/repo/tests/a/test_x.json");

    assert.equal(node.id, "/repo/tests/a/test_x.json#file");
    assert.equal(node.label, "test_x.json");
    assert.equal(node.cases.length, 3);
    assert.equal(node.cases[0].id, "/repo/tests/a/test_x.json#case-0");
    assert.deepEqual(
        node.cases.map((entry) => entry.caseIndex),
        [
            0,
            1,
            2,
        ],
    );

    for (const entry of node.cases) {
        const text = SAMPLE.slice(entry.start, entry.end);
        assert.ok(text.startsWith("{"), `用例区间应该从对象开头起：${text.slice(0, 20)}`);
        assert.ok(text.endsWith("}"), `用例区间应该包含到对象结尾：${text.slice(-20)}`);
    }
});

test("读取失败的文件：节点说明里带原因，没有用例子节点", () => {
    const node = buildFileNode(
        {file: "tests/a/test_bad.json", name: null, controllers: [], resources: [], cases: [], error: "JSON 解析失败"},
        "/repo/tests/a/test_bad.json",
    );
    assert.match(node.description, /读取失败：JSON 解析失败/);
    assert.equal(node.error, "JSON 解析失败");
    assert.equal(node.cases.length, 0);
});

test("Windows目录分隔符转正斜杠，其他系统保留文件名中的反斜杠", () => {
    assert.equal(
        toPosix("tests\\Common\\Button\\test_x.json"),
        process.platform === "win32" ? "tests/Common/Button/test_x.json" : "tests\\Common\\Button\\test_x.json",
    );
    assert.equal(toPosix("tests/Common/test_x.json"), "tests/Common/test_x.json");
});

test("fileNameOf 取路径最后一段", () => {
    assert.equal(fileNameOf("tests/Common/Button/test_close_button.json"), "test_close_button.json");
    assert.equal(fileNameOf("test_x.json"), "test_x.json");
    assert.equal(
        fileNameOf("tests\\Windows\\test_x.json"),
        process.platform === "win32" ? "test_x.json" : "tests\\Windows\\test_x.json",
    );
});

test("folderSegments：去掉文件名和开头的 tests 段，给出面板分组层级", () => {
    assert.deepEqual(folderSegments("tests/Common/Button/test_close_button.json"), [
        "Common",
        "Button",
    ]);
    assert.deepEqual(folderSegments("tests/test_root.json"), []);
    assert.deepEqual(folderSegments("tests/AutoDelivery/test_x.json"), ["AutoDelivery"]);
    // 不在 tests 下的文件名不该被误删
    assert.deepEqual(folderSegments("dev/other/test_x.json"), [
        "dev",
        "other",
    ]);
});

interface TreeItem {
    id: string;
    parent?: TreeItem;
    children: Map<string, TreeItem>;
}

function selectionTree() {
    const item = (id: string, parent?: TreeItem): TreeItem => {
        const result = {id, parent, children: new Map<string, TreeItem>()};
        parent?.children.set(id, result);
        return result;
    };
    const root = item("root");
    const folder = item("folder", root);
    const file = item("file", folder);
    // 收集可只包含配置选中的原始下标，不能把数组位置当下标。
    const cases = [
        item("case0", file),
        item("case3", file),
        item("case7", file),
    ];
    const bad = item("bad", folder);
    const leaves = new Map<string, {filePath: string; caseIndex?: number; collectionError?: string}>([
        [
            file.id,
            {filePath: "/repo/test_good.json"},
        ],
        [
            bad.id,
            {filePath: "/repo/test_bad.json", collectionError: "JSON 解析失败"},
        ],
        ...cases.map((entry, index): [string, {filePath: string; caseIndex: number}] => [
            entry.id,
            {
                filePath: "/repo/test_good.json",
                caseIndex: [
                    0,
                    3,
                    7,
                ][index],
            },
        ]),
    ]);
    return {root, folder, file, cases, bad, leaves};
}

test("运行全部：完整文件保留为批量目标，坏文件仍可单独报错", () => {
    const {root, file, bad, leaves} = selectionTree();
    const targets = collectRunTargets({}, [root], leaves);
    assert.deepEqual(
        targets.map((target) => target.item.id),
        [
            file.id,
            bad.id,
        ],
    );
    assert.equal(targets[1].collectionError, "JSON 解析失败");
});

test("运行全部排除单条：仅展开该文件的剩余原始下标，其它完整文件仍批量", () => {
    const {root, cases, bad, leaves} = selectionTree();
    const targets = collectRunTargets({exclude: [cases[1]]}, [root], leaves);
    assert.deepEqual(
        targets.map((target) => [
            target.item.id,
            target.caseIndex,
        ]),
        [
            [
                bad.id,
                undefined,
            ],
            [
                cases[0].id,
                0,
            ],
            [
                cases[2].id,
                7,
            ],
        ],
    );
});

test("整文件运行排除单条同样生效，不会把被排除项传给CLI", () => {
    const {root, file, cases, leaves} = selectionTree();
    const targets = collectRunTargets({include: [file], exclude: [cases[1]]}, [root], leaves);
    assert.deepEqual(
        targets.map((target) => target.caseIndex),
        [
            0,
            7,
        ],
    );
});

test("排除文件全部用例：该文件不再产生整文件目标", () => {
    const {root, file, cases, leaves} = selectionTree();
    assert.deepEqual(collectRunTargets({include: [file], exclude: cases}, [root], leaves), []);
});

test("直接选择深层用例但排除了祖先目录：不运行该用例", () => {
    const {root, cases, leaves} = selectionTree();
    assert.deepEqual(collectRunTargets({include: [cases[0]], exclude: [root]}, [root], leaves), []);
});

test("目录、文件、单条重复选择时，每条用例只运行一次", () => {
    const {root, folder, file, cases, leaves} = selectionTree();
    const targets = collectRunTargets(
        {
            include: [
                folder,
                file,
                cases[0],
                cases[0],
            ],
            exclude: [cases[1]],
        },
        [root],
        leaves,
    );
    assert.deepEqual(
        targets.filter((target) => target.caseIndex !== undefined).map((target) => target.caseIndex),
        [
            0,
            7,
        ],
    );
    const complete = collectRunTargets(
        {
            include: [
                file,
                cases[0],
                file,
            ],
        },
        [root],
        leaves,
    );
    assert.deepEqual(
        complete.map((target) => target.item.id),
        [file.id],
    );
});
