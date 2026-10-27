import assert from "node:assert/strict";
import {test} from "node:test";

import {DEFAULT_CONFIG, UsageError, parseArgs} from "./args.mjs";

test("解析全部参数", () => {
    const args = parseArgs([
        "--workspace",
        "/repo",
        "--config",
        "custom.config.mts",
        "--file",
        "tests/Common/Button/test_close_button.json",
        "--case",
        "2",
        "--dry-run",
    ]);
    assert.deepEqual(args, {
        workspace: "/repo",
        config: "custom.config.mts",
        file: "tests/Common/Button/test_close_button.json",
        caseIndex: 2,
        dryRun: true,
    });
});

test("默认配置名、默认跑全部用例、默认不 dry-run", () => {
    const args = parseArgs([
        "--workspace",
        "/repo",
        "--file",
        "tests/a/test_a.json",
    ]);
    assert.equal(args.config, DEFAULT_CONFIG);
    assert.equal(args.caseIndex, null);
    assert.equal(args.dryRun, false);
});

test("参数顺序不影响解析", () => {
    const args = parseArgs([
        "--dry-run",
        "--case",
        "0",
        "--file",
        "x.json",
        "--workspace",
        "/repo",
    ]);
    assert.equal(args.workspace, "/repo");
    assert.equal(args.file, "x.json");
    assert.equal(args.caseIndex, 0);
    assert.equal(args.dryRun, true);
});

test("不认识的参数报 UsageError", () => {
    assert.throws(
        () =>
            parseArgs([
                "--workspace",
                "/repo",
                "--file",
                "x.json",
                "--verbose",
            ]),
        (error) => error instanceof UsageError && error.message.includes("--verbose"),
    );
});

test("缺参数取值报 UsageError", () => {
    assert.throws(
        () =>
            parseArgs([
                "--workspace",
                "/repo",
                "--file",
            ]),
        (error) => error instanceof UsageError && error.message.includes("--file"),
    );
});

test("参数后面紧跟另一个参数时算缺值", () => {
    assert.throws(
        () =>
            parseArgs([
                "--workspace",
                "--file",
                "x.json",
            ]),
        (error) => error instanceof UsageError && error.message.includes("--workspace"),
    );
});

test("--case 非整数报 UsageError", () => {
    for (const bad of [
        "abc",
        "1.5",
        "",
        "0x1",
        "1a",
    ]) {
        assert.throws(
            () =>
                parseArgs([
                    "--workspace",
                    "/repo",
                    "--file",
                    "x.json",
                    "--case",
                    bad,
                ]),
            (error) => error instanceof UsageError && error.message.includes("--case"),
            `应拒绝 --case ${JSON.stringify(bad)}`,
        );
    }
});

test("--case 负数报 UsageError（下标必须非负）", () => {
    assert.throws(
        () =>
            parseArgs([
                "--workspace",
                "/repo",
                "--file",
                "x.json",
                "--case",
                "-1",
            ]),
        (error) => error instanceof UsageError && error.message.includes("--case"),
    );
});

test("缺少 --workspace 报 UsageError", () => {
    assert.throws(
        () =>
            parseArgs([
                "--file",
                "x.json",
            ]),
        (error) => error instanceof UsageError && error.message.includes("--workspace"),
    );
});

test("缺少 --file 报 UsageError", () => {
    assert.throws(
        () =>
            parseArgs([
                "--workspace",
                "/repo",
            ]),
        (error) => error instanceof UsageError && error.message.includes("--file"),
    );
});

test("位置参数报 UsageError", () => {
    assert.throws(
        () =>
            parseArgs([
                "--workspace",
                "/repo",
                "x.json",
            ]),
        (error) => error instanceof UsageError && error.message.includes("x.json"),
    );
});
