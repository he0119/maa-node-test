import {strict as assert} from "node:assert";
import {test} from "node:test";
import {buildRunTitle, buildRunnerArgs, formatCommandLine, quoteArgument} from "./runnerArgs";

const BASE = {
    runnerScriptPath: "/home/someone/.vscode/extensions/maa.node-test-0.1.0/runner/run-single-test.mjs",
    workspaceRoot: "/home/someone/dev/MaaEnd",
    configPath: "maatools.config.mts",
    testFile: "/home/someone/dev/MaaEnd/tests/Common/Button/test_close_button.json",
};

test("跑整个文件时不带 --case，也不带 --dry-run", () => {
    const args = buildRunnerArgs(BASE);
    assert.deepEqual(args, [
        BASE.runnerScriptPath,
        "--workspace",
        BASE.workspaceRoot,
        "--config",
        BASE.configPath,
        "--file",
        BASE.testFile,
    ]);
    assert.equal(args.includes("--case"), false);
    assert.equal(args.includes("--dry-run"), false);
});

test("跑单个用例时把 --case 放在 --file 后面", () => {
    const args = buildRunnerArgs({...BASE, caseIndex: 2});
    assert.deepEqual(args.slice(-2), [
        "--case",
        "2",
    ]);
    assert.equal(args[args.length - 3], BASE.testFile);
});

test("--dry-run 追加在最后；和 --case 一起用时顺序固定", () => {
    assert.deepEqual(buildRunnerArgs({...BASE, dryRun: true}).slice(-1), ["--dry-run"]);
    assert.deepEqual(buildRunnerArgs({...BASE, caseIndex: 0, dryRun: true}).slice(-3), [
        "--case",
        "0",
        "--dry-run",
    ]);
});

test("命令行带上 --config 的默认值也可以覆盖", () => {
    const args = buildRunnerArgs({...BASE, configPath: "tools/maatools.config.mts"});
    assert.deepEqual(args.slice(3, 5), [
        "--config",
        "tools/maatools.config.mts",
    ]);
});

test("带空格或引号的参数会加双引号，日志里看得清", () => {
    assert.equal(quoteArgument("node"), "node");
    assert.equal(quoteArgument(""), '""');
    assert.equal(quoteArgument("C:\\Program Files\\nodejs\\node.exe"), '"C:\\Program Files\\nodejs\\node.exe"');
    assert.equal(quoteArgument('say "hi"'), '"say \\"hi\\""');

    assert.equal(
        formatCommandLine("node", [
            "a.mjs",
            "--workspace",
            "/a b",
        ]),
        'node a.mjs --workspace "/a b"',
    );
});

test("标题用相对路径，跑单例时补「第 N 个用例」", () => {
    assert.equal(
        buildRunTitle("tests/Common/Button/test_close_button.json"),
        "tests/Common/Button/test_close_button.json",
    );
    assert.equal(
        buildRunTitle("tests\\Common\\Button\\test_close_button.json", 1),
        "tests/Common/Button/test_close_button.json 第 2 个用例",
    );
});
