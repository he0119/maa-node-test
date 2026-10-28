import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {strict as assert} from "node:assert";
import {test} from "node:test";

import {
    MIN_MAA_TOOLS_VERSION,
    MAX_MAA_TOOLS_VERSION_EXCLUSIVE,
    MAA_TOOLS_VERSION_RANGE,
    requireSupportedMaaTools,
    MaaToolsLoadError,
    describeMaaToolsSource,
    compareVersions,
    findMaaToolsCli,
    isMaaToolsVersionSupported,
    queryMaaToolsVersion,
    readMaaToolsVersion,
    workspaceMaaToolsCli,
} from "./installation";

const WORKSPACE = path.join(path.sep, "repo");

test("仓库里的命令行入口 = <workspace>/node_modules/@nekosu/maa-tools/bin/maa-tools", () => {
    assert.equal(
        workspaceMaaToolsCli(WORKSPACE),
        path.join(WORKSPACE, "node_modules", "@nekosu", "maa-tools", "bin", "maa-tools"),
    );
});

test("读版本号：正常 package.json 返回版本，缺失或坏 JSON 返回 null", () => {
    const root = mkdtempSync(path.join(tmpdir(), "maa-node-test-cli-"));
    try {
        mkdirSync(path.join(root, "bin"), {recursive: true});
        writeFileSync(path.join(root, "bin", "maa-tools"), "#!/usr/bin/env node\n");
        writeFileSync(path.join(root, "package.json"), JSON.stringify({version: "1.2.0"}));

        const entry = path.join(root, "bin", "maa-tools");
        assert.equal(readMaaToolsVersion(entry), "1.2.0");

        writeFileSync(path.join(root, "package.json"), "{ 坏 JSON");
        assert.equal(readMaaToolsVersion(entry), null);
        assert.equal(readMaaToolsVersion(path.join(root, "不存在", "bin", "maa-tools")), null);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test("日志描述写明是仓库里的哪份（相对路径）", () => {
    const source = {
        path: path.join(WORKSPACE, "node_modules", "@nekosu", "maa-tools", "bin", "maa-tools"),
        version: "1.2.0",
    };
    const text = describeMaaToolsSource(source, WORKSPACE);
    assert.match(text, /1\.2\.0/);
    assert.match(text, /node_modules\/@nekosu\/maa-tools\/bin\/maa-tools/);
    assert.match(text, /仓库里的副本/);
});

test("findMaaToolsCli：找到就返回入口和版本，找不到抛 MaaToolsLoadError 提示先装依赖", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "maa-node-test-find-"));
    try {
        assert.throws(
            () => findMaaToolsCli(workspace),
            (error) => error instanceof MaaToolsLoadError && (error as Error).message.includes("pnpm install"),
        );

        const cliPath = workspaceMaaToolsCli(workspace);
        mkdirSync(path.dirname(cliPath), {recursive: true});
        writeFileSync(cliPath, "#!/usr/bin/env node\n");
        writeFileSync(
            path.join(path.dirname(path.dirname(cliPath)), "package.json"),
            JSON.stringify({version: "2.0.0"}),
        );

        const found = findMaaToolsCli(workspace);
        assert.equal(found.cliPath, cliPath);
        assert.equal(found.source.version, "2.0.0");
    } finally {
        rmSync(workspace, {recursive: true, force: true});
    }
});

test("版本比较：数字段逐段比，v 前缀忽略", () => {
    assert.equal(compareVersions("1.1.2", "1.1.3"), -1);
    assert.equal(compareVersions("1.1.3", "1.1.3"), 0);
    assert.equal(compareVersions("v1.2.0", "1.1.3"), 1);
    assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
    assert.equal(compareVersions("1.1.3", "1.1"), 1);
});

test("支持范围包含1.2.0并排除2.0.0，允许v前缀和构建元数据", () => {
    assert.equal(MIN_MAA_TOOLS_VERSION, "1.2.0");
    assert.equal(MAX_MAA_TOOLS_VERSION_EXCLUSIVE, "2.0.0");
    assert.equal(MAA_TOOLS_VERSION_RANGE, `>=${MIN_MAA_TOOLS_VERSION} <${MAX_MAA_TOOLS_VERSION_EXCLUSIVE}（仅稳定版）`);
    for (const version of [
        MIN_MAA_TOOLS_VERSION,
        "v1.2.0",
        "1.2.0+build.7",
        "v1.2.0+build-with-hyphen",
        "1.10.0",
        "1.999.999",
    ]) {
        assert.equal(isMaaToolsVersionSupported(version), true, version);
        assert.doesNotThrow(() => requireSupportedMaaTools({path: workspaceMaaToolsCli(WORKSPACE), version}));
    }
    assert.equal(compareVersions("1.2.0+build-with-hyphen", "v1.2.0"), 0);
});

test("未知、坏格式、旧版、预发布和未来主版本都明确拒绝且带范围来源", () => {
    for (const version of [
        null,
        "",
        "unknown",
        "1.2",
        "1.2.0 trailing",
        "01.2.0",
        "1.2.0+build..1",
        "1.1.2",
        "1.1.3",
        "1.2.0-rc.1",
        "1.9.0-beta",
        MAX_MAA_TOOLS_VERSION_EXCLUSIVE,
        "v2.0.0+build.3",
        "3.0.0",
    ]) {
        assert.equal(isMaaToolsVersionSupported(version), false, String(version));
        const source = {path: workspaceMaaToolsCli(WORKSPACE), version};
        assert.throws(
            () => requireSupportedMaaTools(source),
            (error) => {
                assert.ok(error instanceof MaaToolsLoadError);
                assert.ok(error.message.includes(MAA_TOOLS_VERSION_RANGE));
                assert.ok(error.message.includes(source.path));
                assert.match(error.message, /package\.json/);
                assert.match(error.message, /未知|无效|不兼容/);
                return true;
            },
        );
    }
    assert.equal(isMaaToolsVersionSupported(120), false);
});

test("queryMaaToolsVersion：跑 --version 问出版本；打的不是版本号或起不来就返回 null", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "maa-node-test-qv-"));
    try {
        const goodCli = path.join(root, "good.js");
        writeFileSync(goodCli, 'console.log("1.4.2");\n');
        assert.equal(await queryMaaToolsVersion(process.execPath, goodCli), "1.4.2");

        const noisyCli = path.join(root, "noisy.js");
        writeFileSync(noisyCli, 'console.error("log"); console.log("1.4.2");\n');
        assert.equal(await queryMaaToolsVersion(process.execPath, noisyCli), "1.4.2");

        const badCli = path.join(root, "bad.js");
        writeFileSync(badCli, 'console.log("不知道你在说什么");\n');
        assert.equal(await queryMaaToolsVersion(process.execPath, badCli), null);

        assert.equal(await queryMaaToolsVersion(process.execPath, path.join(root, "missing.js")), null);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test("describeMaaToolsSource：版本问不到就说「版本未知」，不装成知道", () => {
    const text = describeMaaToolsSource(
        {path: "/repo/node_modules/@nekosu/maa-tools/bin/maa-tools", version: null},
        "/repo",
    );
    assert.match(text, /版本未知/);
});

test("readMaaToolsVersion：version 字段不是字符串返回 null", () => {
    const root = mkdtempSync(path.join(tmpdir(), "maa-node-test-ver-"));
    try {
        const cliPath = workspaceMaaToolsCli(root);
        mkdirSync(path.dirname(cliPath), {recursive: true});
        writeFileSync(cliPath, "#!/usr/bin/env node\n");
        writeFileSync(path.join(path.dirname(path.dirname(cliPath)), "package.json"), JSON.stringify({version: 42}));
        assert.equal(readMaaToolsVersion(cliPath), null);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test("compareVersions：带预发布后缀的视为更旧（1.1.3-beta < 1.1.3）", () => {
    assert.equal(compareVersions("1.1.3-beta.1", "1.1.3"), -1);
    assert.equal(compareVersions("1.1.3", "1.1.3-beta.1"), 1);
    assert.equal(compareVersions("1.1.3-beta", "1.1.3-beta"), 0);
});

test("queryMaaToolsVersion：v 前缀照收；空输出返回 null", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "maa-node-test-qv2-"));
    try {
        const vCli = path.join(root, "v.js");
        writeFileSync(vCli, 'console.log("v2.0.0");\n');
        assert.equal(await queryMaaToolsVersion(process.execPath, vCli), "v2.0.0");

        const quietCli = path.join(root, "quiet.js");
        writeFileSync(quietCli, "");
        assert.equal(await queryMaaToolsVersion(process.execPath, quietCli), null);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});
