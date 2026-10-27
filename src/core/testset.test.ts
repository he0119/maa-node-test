import {strict as assert} from "node:assert";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {locateImage, orderImageLocations, readPngSize, scanTestsetDirs} from "./testset";

/** 造一个只有 PNG 头 + IHDR 的假文件，够 readPngSize 读尺寸用了 */
function fakePng(width: number, height: number): Buffer {
    const buffer = Buffer.alloc(33);
    Buffer.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
    ]).copy(buffer, 0);
    buffer.writeUInt32BE(13, 8);
    buffer.write("IHDR", 12, "ascii");
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    buffer[24] = 8; // 位深
    buffer[25] = 2; // 颜色类型：真彩色
    return buffer;
}

interface FakeTestset {
    root: string;
    dispose: () => void;
}

/** 在系统临时目录里搭一个和仓库同形的测试集，用完删掉，不碰仓库 */
function makeTestset(): FakeTestset {
    const root = mkdtempSync(path.join(tmpdir(), "maa-node-test-testset-"));
    const write = (relativePath: string, content: Buffer | string): void => {
        const absolute = path.join(root, relativePath);
        mkdirSync(path.dirname(absolute), {recursive: true});
        writeFileSync(absolute, content);
    };

    write(path.join("Win32", "Official_CN", "帝江号_大世界.png"), fakePng(1280, 720));
    write(path.join("Win32", "B服", "帝江号_大世界.png"), fakePng(640, 360));
    write(path.join("ADB", "Official_CN", "别的图.png"), fakePng(720, 1280));
    // CloudADB 下面没有资源子目录，资源应当算空
    write(path.join("CloudADB", "帝江号_大世界.png"), fakePng(1920, 1080));
    // 一级目录里的普通文件要忽略
    write("README.md", "# 假的测试集");

    return {root, dispose: () => rmSync(root, {recursive: true, force: true})};
}

test("scanTestsetDirs 一级目录当平台、二级目录当资源", (t) => {
    const testset = makeTestset();
    t.after(testset.dispose);

    const dirs = scanTestsetDirs(testset.root);
    assert.deepEqual(
        dirs.map((dir) => `${dir.platform}/${dir.resource}`),
        [
            "ADB/Official_CN",
            "CloudADB/",
            "Win32/B服",
            "Win32/Official_CN",
        ],
    );
    assert.equal(dirs[1].resource, "");
    assert.equal(
        dirs.every((dir) => path.isAbsolute(dir.dirPath)),
        true,
    );
});

test("locateImage 按平台找同名截图并读出 PNG 尺寸", (t) => {
    const testset = makeTestset();
    t.after(testset.dispose);

    const locations = locateImage(testset.root, "帝江号_大世界.png");
    assert.deepEqual(
        locations.map((location) => `${location.platform}/${location.resource}`),
        [
            "ADB/Official_CN",
            "CloudADB/",
            "Win32/B服",
            "Win32/Official_CN",
        ],
    );

    const byKey = new Map(
        locations.map((location) => [
            `${location.platform}/${location.resource}`,
            location,
        ]),
    );

    const win32 = byKey.get("Win32/Official_CN");
    assert.ok(win32);
    assert.equal(win32.filePath, path.join(testset.root, "Win32", "Official_CN", "帝江号_大世界.png"));
    assert.deepEqual(win32.size, {width: 1280, height: 720});

    const noResource = byKey.get("CloudADB/");
    assert.ok(noResource);
    assert.deepEqual(noResource.size, {width: 1920, height: 1080});

    // 这张图在 ADB 下没有
    const missing = byKey.get("ADB/Official_CN");
    assert.ok(missing);
    assert.equal(missing.filePath, null);
    assert.equal(missing.size, null);
});

test("测试集目录不存在时返回空数组，不抛异常", () => {
    assert.deepEqual(scanTestsetDirs(path.join(tmpdir(), "maa-node-test-不可能存在的目录")), []);
    assert.deepEqual(locateImage(path.join(tmpdir(), "maa-node-test-不可能存在的目录"), "a.png"), []);
});

test("image 里带路径分隔符时直接当找不到", (t) => {
    const testset = makeTestset();
    t.after(testset.dispose);
    assert.deepEqual(locateImage(testset.root, "../Win32/Official_CN/帝江号_大世界.png"), []);
});

test("readPngSize 对非 PNG、缺失文件都返回 null", (t) => {
    const testset = makeTestset();
    t.after(testset.dispose);

    assert.equal(readPngSize(path.join(testset.root, "README.md")), null);
    assert.equal(readPngSize(path.join(testset.root, "Win32", "没有这张图.png")), null);

    const truncated = path.join(testset.root, "Win32", "Official_CN", "半张.png");
    writeFileSync(truncated, fakePng(800, 600).subarray(0, 12));
    assert.equal(readPngSize(truncated), null);
});

test("平台排序：声明过的按声明顺序排前面，没声明的按扫描顺序跟在后面", () => {
    const cloud = {platform: "CloudADB", resource: "Official_CN", filePath: "/x/cloud.png", size: null};
    const win32 = {platform: "Win32", resource: "Official_CN", filePath: "/x/win32.png", size: null};
    const adb = {platform: "ADB", resource: "Official_CN", filePath: "/x/adb.png", size: null};

    const ordered = orderImageLocations(
        [
            adb,
            cloud,
            win32,
        ],
        [
            "Win32",
            "ADB",
        ],
    );
    assert.deepEqual(
        ordered.map((item) => item.platform),
        [
            "Win32",
            "ADB",
            "CloudADB",
        ],
    );

    // 没写 controller 就保持扫描顺序
    assert.deepEqual(
        orderImageLocations(
            [
                adb,
                cloud,
                win32,
            ],
            [],
        ).map((item) => item.platform),
        [
            "ADB",
            "CloudADB",
            "Win32",
        ],
    );
});

test("平台排序：别名按目录名对号入座", () => {
    const win32 = {platform: "Win32", resource: "Official_CN", filePath: "/x/win32.png", size: null};
    const adb = {platform: "ADB", resource: "Official_CN", filePath: "/x/adb.png", size: null};

    const ordered = orderImageLocations(
        [
            adb,
            win32,
        ],
        ["Win32-Front"],
        (controller: string) => (controller === "Win32-Front" ? "Win32" : controller),
    );
    assert.deepEqual(
        ordered.map((item) => item.platform),
        [
            "Win32",
            "ADB",
        ],
    );
});
