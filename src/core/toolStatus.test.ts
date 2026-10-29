import * as assert from "node:assert/strict";
import {test} from "node:test";

import {describeToolStatus, isToolVersion, type ToolLocation} from "./toolStatus";

const supportedRange = ">=1.2.0 <2.0.0（仅稳定版）";
const location: ToolLocation = {
    workspaceRoot: "/workspace/test-repo",
    cliPath: "/workspace/test-repo/node_modules/@nekosu/maa-tools/bin/maa-tools",
    resolvedCliPath: "/dev/maa-tools/bin/maa-tools",
    nodePath: "/opt/node/bin/node",
    configPath: "config/node tests.mts",
};

void test("版本必须是完整版本字符串，不能把旧 CLI 的日志当版本", () => {
    for (const version of [
        "1.2.0",
        "v2.0.0",
        "1.2.0-beta.2",
        "1.2.0+build.4",
        "v1.2.0+build-with-hyphen",
        "0.0.0-0.alpha+001",
    ]) {
        assert.equal(isToolVersion(version), true, version);
    }
    for (const value of [
        null,
        undefined,
        120,
        "",
        "1.2.0 loaded",
        "Usage: maa-tools",
        "1",
        "1.2.0\n",
        " 1.2.0",
        "01.2.0",
        "1.02.0",
        "1.2.00",
        "1.2.0-01",
        "1.2.0-beta..1",
        "1.2.0+build..1",
        "1.2.0+",
    ]) {
        assert.equal(isToolVersion(value), false, String(value));
    }
});

void test("正常版本的来源同时展示仓库入口和软链接实际文件", () => {
    const view = describeToolStatus({kind: "ready", location, version: "1.2.0", versionSource: "cli"}, supportedRange);
    assert.equal(view.text, "maa-tools 1.2.0");
    for (const value of Object.values(location)) assert.ok(view.tooltip.includes(value));
    assert.match(view.tooltip, /命令行 --version/);
    assert.ok(view.tooltip.includes(`支持范围：${supportedRange}`));
    assert.match(view.tooltip, /点击重新查询/);
});

void test("查询失败的安装包版本不能显示成已确认可用", () => {
    const view = describeToolStatus(
        {kind: "unknown", location, version: "1.2.0", versionSource: "package", reason: "Node 不可用"},
        supportedRange,
    );
    assert.match(view.text, /1\.2\.0（未确认）/);
    assert.match(view.tooltip, /package\.json 声明/);
    assert.match(view.tooltip, /Node 不可用/);
    assert.doesNotMatch(view.tooltip, /版本满足要求/);
});

void test("旧版、未来主版本和预发布都显示不兼容并保留支持范围与完整来源", () => {
    for (const version of [
        "1.1.3",
        "2.0.0",
        "v3.1.0+build.4",
        "1.3.0-rc.1",
    ]) {
        const view = describeToolStatus(
            {kind: "incompatible", location, version, versionSource: "package"},
            supportedRange,
        );
        assert.equal(view.text, `maa-tools ${version}（不兼容）`);
        assert.doesNotMatch(view.text, /过旧/);
        assert.ok(view.tooltip.includes(`支持范围：${supportedRange}`));
        assert.match(view.tooltip, /package\.json 声明/);
        for (const value of Object.values(location)) assert.ok(view.tooltip.includes(value));
    }
    assert.match(describeToolStatus({kind: "missing", location}, supportedRange).text, /未安装/);
    assert.match(describeToolStatus({kind: "unknown", location}, supportedRange).text, /版本未知/);
    assert.match(describeToolStatus({kind: "checking", location}, supportedRange).text, /查询中/);
});
