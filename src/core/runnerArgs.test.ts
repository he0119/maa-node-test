import {strict as assert} from "node:assert";
import {test} from "node:test";
import {
    DEFAULT_CONFIG,
    buildBatchRunTitle,
    buildMaaToolsArgs,
    buildRunTitle,
    formatCommandLine,
    quoteArgument,
} from "./runnerArgs";

const BASE = {
    cliPath: "/repo/node_modules/@nekosu/maa-tools/bin/maa-tools",
    configPath: DEFAULT_CONFIG,
    testFiles: [
        "tests/Common/Button/test_close_button.json",
    ],
};

test("真跑模式：maa-tools test --jsonl，配置用默认名时不带位置参数", () => {
    const args = buildMaaToolsArgs({...BASE, mode: "run"});
    assert.deepEqual(args, [
        BASE.cliPath,
        "test",
        "--jsonl",
        "--file",
        "tests/Common/Button/test_close_button.json",
    ]);
});

test("真跑模式的参数顺序固定（--file 在前）", () => {
    const args = buildMaaToolsArgs({...BASE, mode: "run"});
    assert.deepEqual(args, [
        BASE.cliPath,
        "test",
        "--jsonl",
        "--file",
        BASE.testFiles[0],
    ]);
});

test("收集模式：--list --json 同时传过滤文件与自定义配置路径", () => {
    const args = buildMaaToolsArgs({...BASE, configPath: "tools/maatools.config.mts", mode: "list"});
    assert.deepEqual(args, [
        BASE.cliPath,
        "test",
        "--list",
        "--json",
        "--file",
        BASE.testFiles[0],
        "tools/maatools.config.mts",
    ]);
});

test("跑单个用例时把 --case 放在 --file 后面", () => {
    const args = buildMaaToolsArgs({...BASE, caseIndex: 2, mode: "run"});
    assert.deepEqual(args.slice(-2), [
        "--case",
        "2",
    ]);
});

test("配置不是默认名时作为位置参数放在最后（maa-tools test [config]）", () => {
    const args = buildMaaToolsArgs({...BASE, configPath: "tools/maatools.config.mts", mode: "run"});
    assert.deepEqual(args.slice(-1), ["tools/maatools.config.mts"]);
});

test("多个 --file 各来一个参数，顺序照传进来的来", () => {
    const files = [
        "tests/a/test_a.json",
        "tests/b/test_b.json",
    ];
    const args = buildMaaToolsArgs({...BASE, testFiles: files, mode: "run"});
    assert.deepEqual(args.slice(3), [
        "--file",
        files[0],
        "--file",
        files[1],
    ]);
});

test("带空格或引号的参数会加双引号，日志里看得清", () => {
    assert.equal(quoteArgument("plain"), "plain");
    assert.equal(quoteArgument("has space"), '"has space"');
    assert.equal(quoteArgument('has "quote"'), '"has \\"quote\\""');
    assert.equal(quoteArgument(""), '""');
    assert.equal(
        formatCommandLine("node", [
            "a.js",
            "b c",
        ]),
        'node a.js "b c"',
    );
});

test("标题用相对路径，跑单例时补「第 N 个用例」", () => {
    assert.equal(buildRunTitle("tests/a/test_a.json"), "tests/a/test_a.json");
    assert.equal(buildRunTitle("tests/a/test_a.json", 2), "tests/a/test_a.json 第 3 个用例");
});

test("批量标题：一个文件用单文件标题，多个写数量和第一个文件", () => {
    assert.equal(buildBatchRunTitle([]), "0 个测试文件");
    assert.equal(buildBatchRunTitle(["tests/a/test_a.json"]), "tests/a/test_a.json");
    assert.equal(
        buildBatchRunTitle([
            "tests/a/test_a.json",
            "tests/b/test_b.json",
        ]),
        "2 个测试文件（批量，含 tests/a/test_a.json 等）",
    );
});
