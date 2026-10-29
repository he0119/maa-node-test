import {strict as assert} from "node:assert";
import {mkdirSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test, type TestContext} from "node:test";
import {RepoIndex} from "./repoIndex";

function makeRepo(t: TestContext, images: string[]) {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "maa-node-test-image-root-index-"));
    t.after(() => rmSync(workspaceRoot, {recursive: true, force: true}));
    const testsetRoot = path.join(workspaceRoot, "images");
    mkdirSync(testsetRoot);
    const loaderPath = path.join(workspaceRoot, "tests", "scripts", "loader.mts");
    mkdirSync(path.dirname(loaderPath), {recursive: true});
    writeFileSync(loaderPath, 'const controllerMap = { "Win32-Front": "Win32", ADB: "ADB" };');
    const write = (relativePath: string): string => {
        const filePath = path.join(testsetRoot, relativePath);
        mkdirSync(path.dirname(filePath), {recursive: true});
        writeFileSync(filePath, "image candidate");
        return filePath;
    };
    for (const image of images) write(image);
    return {testsetRoot, index: new RepoIndex(workspaceRoot, testsetRoot), write};
}

const SAME_DIRECTORY_TIME = new Date("2025-01-01T00:00:00Z");

function stampDirectory(testsetRoot: string, relativePath: string, milliseconds = 0): void {
    const time = new Date(SAME_DIRECTORY_TIME.getTime() + milliseconds);
    utimesSync(path.join(testsetRoot, relativePath), time, time);
}

test("截图补全：默认目录保留控制器别名、平台过滤和去重", (t) => {
    const {index} = makeRepo(t, [
        "Win32/Official_CN/common.png",
        "Win32/Official_CN/desktop.png",
        "ADB/Official_CN/common.png",
        "ADB/Official_CN/mobile.png",
    ]);

    assert.deepEqual(index.images(["Win32-Front"]), [
        "common.png",
        "desktop.png",
    ]);
    assert.deepEqual(index.images(["ADB"]), [
        "common.png",
        "mobile.png",
    ]);
    assert.deepEqual(index.images([]), [
        "common.png",
        "desktop.png",
        "mobile.png",
    ]);
    assert.deepEqual(index.images(["Win32-Front"], "."), [
        "common.png",
        "desktop.png",
    ]);
});

test("截图补全：相同修改时间的两个子目录切换时不混入其他候选", (t) => {
    const {index, testsetRoot} = makeRepo(t, [
        "Win32/Official_CN/First/common.png",
        "Win32/Official_CN/First/first.png",
        "Win32/Official_CN/Second/common.png",
        "Win32/Official_CN/Second/second.png",
    ]);
    stampDirectory(testsetRoot, "Win32/Official_CN/First");
    stampDirectory(testsetRoot, "Win32/Official_CN/Second");

    assert.deepEqual(index.images(["Win32-Front"], "First"), [
        "common.png",
        "first.png",
    ]);
    assert.deepEqual(index.images(["Win32-Front"], "Second"), [
        "common.png",
        "second.png",
    ]);
    assert.deepEqual(index.images(["Win32-Front"], "First"), [
        "common.png",
        "first.png",
    ]);
});

test("截图补全：嵌套 imageRoot 只列该目录文件，保留平台过滤", (t) => {
    const {index} = makeRepo(t, [
        "Win32/Official_CN/root.png",
        "Win32/Official_CN/Events/Daily/desktop.png",
        "Win32/Official_CN/Events/Daily/deeper/hidden.png",
        "ADB/Official_CN/Events/Daily/mobile.png",
    ]);

    assert.deepEqual(index.images(["Win32-Front"], "Events/Daily"), ["desktop.png"]);
    assert.deepEqual(index.images(["ADB"], "Events/Daily"), ["mobile.png"]);
    assert.deepEqual(index.images([], "Events/Daily"), [
        "desktop.png",
        "mobile.png",
    ]);
    assert.deepEqual(index.images(["Win32-Front"]), ["root.png"]);
});

test("截图补全：选定子目录内新增和删除文件会刷新缓存", (t) => {
    const {index, testsetRoot, write} = makeRepo(t, ["Win32/Official_CN/Daily/existing.png"]);
    stampDirectory(testsetRoot, "Win32/Official_CN/Daily");
    assert.deepEqual(index.images(["Win32-Front"], "Daily"), ["existing.png"]);

    const added = write("Win32/Official_CN/Daily/added.png");
    stampDirectory(testsetRoot, "Win32/Official_CN/Daily", 5_000);
    assert.deepEqual(index.images(["Win32-Front"], "Daily"), [
        "added.png",
        "existing.png",
    ]);

    unlinkSync(added);
    stampDirectory(testsetRoot, "Win32/Official_CN/Daily", 10_000);
    assert.deepEqual(index.images(["Win32-Front"], "Daily"), ["existing.png"]);
});

test("截图补全：缺失的子目录创建后能够发现新图片", (t) => {
    const {index, testsetRoot, write} = makeRepo(t, ["Win32/Official_CN/root.png"]);
    assert.deepEqual(index.images(["Win32-Front"], "New/Daily"), []);

    write("Win32/Official_CN/New/Daily/created.png");
    stampDirectory(testsetRoot, "Win32/Official_CN/New/Daily");
    assert.deepEqual(index.images(["Win32-Front"], "New/Daily"), ["created.png"]);
});
