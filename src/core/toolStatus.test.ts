import * as assert from "node:assert/strict";
import {test} from "node:test";

import {describeToolStatus, isToolVersion, type ToolLocation} from "./toolStatus";

const location: ToolLocation = {
    workspaceRoot: "/workspace/test-repo",
    cliPath: "/workspace/test-repo/node_modules/@nekosu/maa-tools/bin/maa-tools",
    resolvedCliPath: "/dev/maa-tools/bin/maa-tools",
    nodePath: "/opt/node/bin/node",
    configPath: "config/node tests.mts",
};

void test("版本必须是完整版本字符串，不能把旧 CLI 的日志当版本", () => {
    for (const version of [
        "1.1.3",
        "v2.0.0",
        "1.1.3-beta.2",
        "1.1.3+build.4",
    ]) {
        assert.equal(isToolVersion(version), true, version);
    }
    for (const value of [
        null,
        undefined,
        "",
        "1.1.3 loaded",
        "Usage: maa-tools",
        "1",
        "1.1.3\n",
        " 1.1.3",
    ]) {
        assert.equal(isToolVersion(value), false, String(value));
    }
});

void test("正常版本的来源同时展示仓库入口和软链接实际文件", () => {
    const view = describeToolStatus({kind: "ready", location, version: "1.1.3", versionSource: "cli"}, "1.1.3");
    assert.match(view.text, /maa-tools 1\.1\.3/);
    for (const value of Object.values(location)) assert.ok(view.tooltip.includes(value));
    assert.match(view.tooltip, /命令行 --version/);
    assert.match(view.tooltip, /点击重新查询/);
});

void test("查询失败的安装包版本不能显示成已确认可用", () => {
    const view = describeToolStatus(
        {kind: "unknown", location, version: "1.1.3", versionSource: "package", reason: "Node 不可用"},
        "1.1.3",
    );
    assert.match(view.text, /1\.1\.3（未确认）/);
    assert.match(view.tooltip, /package\.json 声明/);
    assert.match(view.tooltip, /Node 不可用/);
    assert.doesNotMatch(view.tooltip, /版本满足要求/);
});

void test("过旧版本明确显示门槛，未安装与未知状态不同", () => {
    const old = describeToolStatus({kind: "outdated", location, version: "1.1.2", versionSource: "package"}, "1.1.3");
    assert.match(old.text, /1\.1\.2（过旧）/);
    assert.match(old.tooltip, /最低版本：1\.1\.3/);
    assert.match(describeToolStatus({kind: "missing", location}, "1.1.3").text, /未安装/);
    assert.match(describeToolStatus({kind: "unknown", location}, "1.1.3").text, /版本未知/);
    assert.match(describeToolStatus({kind: "checking", location}, "1.1.3").text, /查询中/);
});
