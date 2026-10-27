import assert from "node:assert/strict";
import path from "node:path";
import {test} from "node:test";

import {displayPath, resolveFromWorkspace, toPosix} from "./paths.mjs";

const workspace = path.join(path.sep, "repo");

test("绝对路径原样规整", () => {
    const absolute = path.join(path.sep, "repo", "tests", "a", "test_a.json");
    assert.equal(resolveFromWorkspace(workspace, absolute), absolute);
});

test("相对路径按仓库根解析", () => {
    assert.equal(
        resolveFromWorkspace(workspace, "tests/Common/Button/test_close_button.json"),
        path.join(workspace, "tests", "Common", "Button", "test_close_button.json"),
    );
});

test("仓库内显示相对路径，仓库外显示绝对路径", () => {
    assert.equal(displayPath(workspace, path.join(workspace, "tests", "a.json")), "tests/a.json");
    const outside = path.join(path.sep, "elsewhere", "b.json");
    assert.equal(displayPath(workspace, outside), toPosix(outside));
});

test("输出统一正斜杠", () => {
    assert.equal(toPosix(path.join("tests", "a", "b.png")), "tests/a/b.png");
});
