import {strict as assert} from "node:assert";
import {test} from "node:test";

import {
    aggregateFileResults,
    caseOutcome,
    classifyErrorEntry,
    formatCaseFailure,
    formatCaseResultLine,
    locateCaseFailures,
    parseCaseResultLine,
    summarizePlatforms,
    attributeGroupResults,
    formatFileResultLine,
    hasAnyAttributedGroup,
    normalizeFileResults,
    overallVerdict,
    stripAnsi,
} from "./results.mjs";

const FAILED_OUTPUT = [
    "use latest version 5.15.0-beta.1",
    "(Win32-官服)通用按钮，测试关闭按钮",
    "  帝江号_大世界.png CloseButtonType1 should hit but missed",
    "  四号谷地_地区建设.png CloseButtonType1 box mismatch. Expect [223,32,32,19], hit [220,30,34,20]",
    "(ADB-官服)通用按钮，测试关闭按钮",
    "",
];

test("按组名切分：有明细行的组算失败，只有组名行的算通过", () => {
    const verdicts = attributeGroupResults(FAILED_OUTPUT, [
        "(Win32-官服)通用按钮，测试关闭按钮",
        "(ADB-官服)通用按钮，测试关闭按钮",
        "(CloudADB-官服)通用按钮，测试关闭按钮",
    ]);

    assert.equal(verdicts.get("(Win32-官服)通用按钮，测试关闭按钮"), "fail");
    assert.equal(verdicts.get("(ADB-官服)通用按钮，测试关闭按钮"), "pass");
    assert.equal(verdicts.get("(CloudADB-官服)通用按钮，测试关闭按钮"), "unknown");
});

test("组名带 ANSI 颜色也能认出来（在终端里手跑时会带颜色）", () => {
    const verdicts = attributeGroupResults(
        [
            "\u001b[32m(Win32-官服)某组\u001b[39m",
            "  a.png X should hit but missed",
        ],
        ["(Win32-官服)某组"],
    );
    assert.equal(verdicts.get("(Win32-官服)某组"), "fail");
    assert.equal(stripAnsi("\u001b[31m红\u001b[39m"), "红");
});

test("同一组名重复出现时，只要有一次失败就算失败", () => {
    const verdicts = attributeGroupResults(
        [
            "(Win32-官服)某组",
            "  a.png X should hit but missed",
            "(Win32-官服)某组",
        ],
        ["(Win32-官服)某组"],
    );
    assert.equal(verdicts.get("(Win32-官服)某组"), "fail");
});

test("行首只有一个空格的无关行不会把组判失败", () => {
    const verdicts = attributeGroupResults(
        [
            " (Win32-官服)某组不是组名",
            "(Win32-官服)某组",
        ],
        ["(Win32-官服)某组"],
    );
    assert.equal(verdicts.get("(Win32-官服)某组"), "pass");
});

test("hasAnyAttributedGroup：全都是 unknown 说明一个组都没执行", () => {
    assert.equal(
        hasAnyAttributedGroup(
            new Map([
                [
                    "a",
                    "unknown",
                ],
            ]),
        ),
        false,
    );
    assert.equal(
        hasAnyAttributedGroup(
            new Map([
                [
                    "a",
                    "pass",
                ],
            ]),
        ),
        true,
    );
});

test("按文件汇总：文件名下任意一组失败，这个文件就失败", () => {
    const owners = new Map([
        [
            "(Win32-官服)组一",
            new Set(["tests/a/test_a.json"]),
        ],
        [
            "(ADB-官服)组一",
            new Set(["tests/a/test_a.json"]),
        ],
        [
            "(Win32-官服)组二",
            new Set(["tests/b/test_b.json"]),
        ],
    ]);
    const verdicts = new Map([
        [
            "(Win32-官服)组一",
            "pass",
        ],
        [
            "(ADB-官服)组一",
            "fail",
        ],
        [
            "(Win32-官服)组二",
            "pass",
        ],
    ]);

    const files = aggregateFileResults(owners, verdicts, [
        "tests/a/test_a.json",
        "tests/b/test_b.json",
    ]);
    assert.equal(files.get("tests/a/test_a.json"), "fail");
    assert.equal(files.get("tests/b/test_b.json"), "pass");
});

test("没有归因到任何组的文件是 unknown，对外统一成 error", () => {
    const files = aggregateFileResults(new Map(), new Map(), ["tests/a/test_a.json"]);
    assert.equal(files.get("tests/a/test_a.json"), "unknown");

    const normalized = normalizeFileResults(files);
    assert.equal(normalized.get("tests/a/test_a.json"), "error");
});

test("整批结论：error 优先于 fail，全通过才是 pass", () => {
    assert.equal(overallVerdict(new Map()), "empty");
    assert.equal(
        overallVerdict(
            new Map([
                [
                    "a",
                    "pass",
                ],
            ]),
        ),
        "pass",
    );
    assert.equal(
        overallVerdict(
            new Map([
                [
                    "a",
                    "pass",
                ],
                [
                    "b",
                    "fail",
                ],
            ]),
        ),
        "fail",
    );
    assert.equal(
        overallVerdict(
            new Map([
                [
                    "a",
                    "fail",
                ],
                [
                    "b",
                    "error",
                ],
            ]),
        ),
        "error",
    );
});

test("RESULT-FILE 行格式固定，扩展按前缀解析", () => {
    assert.equal(formatFileResultLine("tests/a/test_a.json", "pass"), "RESULT-FILE: tests/a/test_a.json pass");
    assert.match(formatFileResultLine("tests/a/test_a.json", "error"), /^RESULT-FILE: .+ error$/);
});

const GROUP = {
    configs: {
        name: "(CloudADB-官服)环境监测拍照",
        controller: "CloudADB",
        resource: "官服",
        imageRoot: "CloudADB/Official_CN",
    },
    cases: [
        {
            image: "武陵_拍照模式_画面设置.png",
            hits: [
                "Tab",
                {
                    node: "Opened",
                    box: [
                        10,
                        10,
                        100,
                        50,
                    ],
                },
            ],
        },
        {image: "武陵_拍照模式_画面设置.png", hits: []},
    ],
};

const resolveImage = (group, image) => `/repo/tests/MaaEndTestset/${group.configs.imageRoot}/${image}`;
const imagePath = "/repo/tests/MaaEndTestset/CloudADB/Official_CN/武陵_拍照模式_画面设置.png";

test("classifyErrorEntry：期望命中却没命中 → 失败并说明算法", () => {
    const verdict = classifyErrorEntry(
        {
            node: "Opened",
            hit: false,
            detail: {
                algorithm: "ColorMatch",
                box: [
                    0,
                    0,
                    0,
                    0,
                ],
            },
        },
        GROUP.cases[0],
    );
    assert.equal(verdict.ok, false);
    assert.equal(verdict.node, "Opened");
    assert.equal(verdict.algorithm, "ColorMatch");
    assert.match(verdict.reason, /没识别到该节点/);
});

test("classifyErrorEntry：负例上「不该命中却命中」→ 失败", () => {
    const verdict = classifyErrorEntry(
        {
            node: "Opened",
            hit: true,
            detail: {
                algorithm: "ColorMatch",
                box: [
                    1,
                    2,
                    3,
                    4,
                ],
            },
        },
        GROUP.cases[1],
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /不期望它命中/);
});

test("classifyErrorEntry：命中但框超出期望 → 失败并给出两个框", () => {
    const verdict = classifyErrorEntry(
        {
            node: "Opened",
            hit: true,
            detail: {
                algorithm: "TemplateMatch",
                box: [
                    200,
                    200,
                    40,
                    40,
                ],
            },
        },
        GROUP.cases[0],
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /识别框不对/);
    assert.match(verdict.reason, /\[10,10,100,50\]/);
    assert.match(verdict.reason, /\[200,200,40,40\]/);
});

test("classifyErrorEntry：命中且框在期望范围内 → 这条用例其实是通过的", () => {
    const verdict = classifyErrorEntry(
        {
            node: "Opened",
            hit: true,
            detail: {
                algorithm: "TemplateMatch",
                box: [
                    20,
                    20,
                    30,
                    20,
                ],
            },
        },
        GROUP.cases[0],
    );
    assert.equal(verdict.ok, true);
});

test("classifyErrorEntry：不是这条用例关心的节点 → 不归罪于它", () => {
    const verdict = classifyErrorEntry({node: "Other", hit: false, detail: {algorithm: "ColorMatch"}}, GROUP.cases[0]);
    assert.equal(verdict.ok, true);
});

test("classifyErrorEntry：识别没返回详情 → 明说 missing detail", () => {
    const verdict = classifyErrorEntry({node: "Opened", hit: false, detail: null}, GROUP.cases[0]);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /missing detail/);
});

test("locateCaseFailures：按图片路径和用例期望把明细分发到具体用例下标", () => {
    const entries = [
        {
            key: "tests/environment/test_photo.json",
            testFile: {cases: GROUP.cases},
            target: {caseKeys: []},
        },
    ];
    const owners = new Map([
        [
            "(CloudADB-官服)环境监测拍照",
            new Set(["tests/environment/test_photo.json"]),
        ],
    ]);

    const failures = locateCaseFailures({
        errorDetails: [
            {
                imagePath,
                imagePathRaw: "武陵_拍照模式_画面设置.png",
                node: "Opened",
                hit: false,
                detail: {algorithm: "ColorMatch"},
            },
        ],
        groups: [GROUP],
        entries,
        owners,
        resolveImage,
    });

    assert.deepEqual([...failures.keys()], ["tests/environment/test_photo.json#0"]);
    const info = failures.get("tests/environment/test_photo.json#0");
    assert.equal(info.failures.length, 1);
    assert.equal(info.failures[0].platform, "CloudADB-官服");
    assert.equal(info.failures[0].node, "Opened");
    assert.match(info.failures[0].reason, /没识别到该节点/);
});

test("locateCaseFailures：图片路径对不上（别的 controller）就不硬套", () => {
    const entries = [{key: "tests/a.json", testFile: {cases: GROUP.cases}, target: {caseKeys: []}}];
    const owners = new Map([
        [
            "(CloudADB-官服)环境监测拍照",
            new Set(["tests/a.json"]),
        ],
    ]);

    const failures = locateCaseFailures({
        errorDetails: [{imagePath: "/other/Win32/Official_CN/x.png", node: "Opened", hit: false, detail: {}}],
        groups: [GROUP],
        entries,
        owners,
        resolveImage,
    });

    assert.equal(failures.size, 0);
});

test("逐用例结论行的 JSON 载荷能原样解回来", () => {
    const line = formatCaseResultLine("tests/a b/test.json", 2, "fail", "CloudADB-官服 失败", [
        "节点 `X` 这张图上没识别到该节点（算法 ColorMatch）",
        "通过：Win32-官服",
    ]);
    const parsed = parseCaseResultLine(line);
    assert.deepEqual(parsed, {
        file: "tests/a b/test.json",
        case: 2,
        verdict: "fail",
        title: "CloudADB-官服 失败",
        detail: [
            "节点 `X` 这张图上没识别到该节点（算法 ColorMatch）",
            "通过：Win32-官服",
        ],
    });
    assert.equal(parseCaseResultLine("RESULT-FILE: tests/a.json pass"), null);
    assert.equal(parseCaseResultLine("RESULT-CASE: 不是json"), null);
});

test("平台统计：只在 CloudADB 失败时，文案要写明 Win32/ADB 通过", () => {
    const groups = [
        "Win32",
        "ADB",
        "CloudADB",
    ].map((controller) => ({
        configs: {
            name: `(${controller}-官服)环境监测拍照`,
            controller,
            resource: "官服",
            imageRoot: `${controller}/Official_CN`,
        },
        cases: [GROUP.cases[0]],
    }));
    const fileKey = "tests/environment/test_photo.json";
    const owners = new Map(
        groups.map((group) => [
            group.configs.name,
            new Set([fileKey]),
        ]),
    );
    const entries = [{key: fileKey, testFile: {cases: [GROUP.cases[0]]}, target: {caseKeys: []}}];

    const failures = locateCaseFailures({
        // 只有 CloudADB 报了失败条目
        errorDetails: [
            {
                imagePath: "/repo/tests/MaaEndTestset/CloudADB/Official_CN/武陵_拍照模式_画面设置.png",
                node: "Opened",
                hit: false,
                detail: {algorithm: "ColorMatch"},
            },
        ],
        groups,
        entries,
        owners,
        resolveImage,
    });

    const info = failures.get(`${fileKey}#0`);
    assert.deepEqual(info.platforms, [
        "Win32-官服",
        "ADB-官服",
        "CloudADB-官服",
    ]);

    const text = formatCaseFailure(info);
    assert.equal(text.title, "CloudADB-官服 失败");
    assert.ok(text.lines.some((line) => /节点 `Opened` 这张图上没识别到该节点/.test(line)));
    assert.ok(text.lines.includes("通过：Win32-官服、ADB-官服"));
});

test("平台统计：全都失败时说「所有能跑的平台都失败」", () => {
    const text = formatCaseFailure({
        platforms: [
            "Win32-官服",
            "CloudADB-官服",
        ],
        failures: [
            {
                platform: "Win32-官服",
                node: "Opened",
                reason: "这张图上没识别到该节点",
                algorithm: "ColorMatch",
                image: "a.png",
            },
            {
                platform: "CloudADB-官服",
                node: "Opened",
                reason: "这张图上没识别到该节点",
                algorithm: "ColorMatch",
                image: "a.png",
            },
        ],
        missing: [],
    });
    assert.equal(text.title, "Win32-官服、CloudADB-官服 失败");
    assert.ok(text.lines.includes("所有能跑的平台都失败：Win32-官服、CloudADB-官服"));
    // 多个平台都失败时，每条明细点明平台
    assert.ok(text.lines.some((line) => line.startsWith("Win32-官服：节点 `Opened`")));
});

test("缺图：某个平台缺图、别的平台通过时，说清哪边没验证", () => {
    const text = formatCaseFailure({
        platforms: [
            "Win32-官服",
            "CloudADB-官服",
        ],
        failures: [],
        missing: [{platform: "CloudADB-官服", image: "a.png", path: "/x/CloudADB/a.png"}],
    });
    assert.equal(text.title, "CloudADB-官服 没验证到");
    assert.ok(text.lines.some((line) => /截图不存在/.test(line)));
    assert.ok(text.lines.some((line) => /这条用例没有真正验证/.test(line)));
});

test("平台覆盖：按平台统计截图数和缺图数", () => {
    const win32 = {
        configs: {controller: "Win32", resource: "官服"},
        cases: [
            {image: "a.png"},
            {image: "b.png"},
        ],
    };
    const cloud = {configs: {controller: "CloudADB", resource: "官服"}, cases: [{image: "a.png"}]};
    const entries = [
        {
            key: "tests/a.json",
            target: {
                controllers: [
                    "Win32",
                    "CloudADB",
                ],
            },
        },
    ];

    const summary = summarizePlatforms({
        groups: [
            win32,
            cloud,
        ],
        entries,
        isImageMissing: (group) => group.configs.controller === "CloudADB",
    });

    assert.deepEqual(summary.platforms, [
        {label: "Win32-官服", controller: "Win32", images: 2, missing: 0},
        {label: "CloudADB-官服", controller: "CloudADB", images: 1, missing: 1},
    ]);
    assert.deepEqual(summary.unmatched, []);
});

test("平台覆盖：声明了但没有匹配到组的 controller 会被点出来", () => {
    const win32 = {configs: {controller: "Win32", resource: "官服"}, cases: [{image: "a.png"}]};
    const entries = [
        {
            key: "tests/a.json",
            target: {
                controllers: [
                    "Win32",
                    "ADB",
                ],
            },
        },
    ];

    const summary = summarizePlatforms({groups: [win32], entries, isImageMissing: () => false});

    assert.deepEqual(summary.unmatched, [{file: "tests/a.json", controller: "ADB"}]);
});

test("用例结论：有失败报 fail，只有缺图报 skipped", () => {
    assert.equal(caseOutcome({failures: [{platform: "ADB-官服", node: "X", reason: "没识别到"}], missing: []}), "fail");
    assert.equal(
        caseOutcome({failures: [], missing: [{platform: "ADB-官服", image: "a.png", path: "/x/a.png"}]}),
        "skipped",
    );
    // 失败优先：既有失败又有缺图时仍按失败报
    assert.equal(
        caseOutcome({
            failures: [{platform: "Win32-官服", node: "X", reason: "没识别到"}],
            missing: [{platform: "ADB-官服", image: "a.png", path: "/x/a.png"}],
        }),
        "fail",
    );
});
