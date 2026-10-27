import assert from "node:assert/strict";
import path from "node:path";
import {test} from "node:test";

import {countImages, resolveImagePath, scanImages} from "./images.mjs";

const cfg = {cwd: path.join(path.sep, "repo"), test: {casesCwd: "tests/MaaEndTestset"}};
const groupWith = (controller, imageRoot) => ({
    configs: {controller, resource: "官服", imageRoot},
    cases: [],
});

test("截图路径 = cwd / casesCwd / imageRoot / image，与 maa-tools 一致", () => {
    const group = groupWith("Win32", "Win32/Official_CN");
    assert.equal(
        resolveImagePath(cfg, group, "帝江号_大世界.png"),
        path.join(path.sep, "repo", "tests", "MaaEndTestset", "Win32", "Official_CN", "帝江号_大世界.png"),
    );
});

test('group 没有 imageRoot 时按 "." 处理', () => {
    assert.equal(
        resolveImagePath(cfg, groupWith("ADB", undefined), "a.png"),
        path.join(path.sep, "repo", "tests", "MaaEndTestset", "a.png"),
    );
});

test("cfg 缺 cwd / casesCwd 时给出可解析的路径而不是抛异常", () => {
    const fallback = resolveImagePath({}, {configs: {}}, "a.png");
    assert.equal(fallback, path.resolve(process.cwd(), ".", ".", "a.png"));
});

test("扫描逐个用例标记存在性（exists 可注入）", () => {
    const group = groupWith("Win32", "Win32/Official_CN");
    group.cases = [
        {image: "有.png", hits: []},
        {image: "没有.png", hits: []},
    ];
    // 注意用文件名全等比较：'没有.png' 也以 '有.png' 结尾，用 endsWith 会误判
    const exists = (file) => path.basename(file) === "有.png";

    const scan = scanImages(cfg, [group], exists);
    assert.equal(scan.length, 1);
    assert.deepEqual(
        scan[0].images.map((item) => ({image: item.image, exists: item.exists})),
        [
            {image: "有.png", exists: true},
            {image: "没有.png", exists: false},
        ],
    );
    assert.equal(
        scan[0].images[1].path,
        path.join(path.sep, "repo", "tests", "MaaEndTestset", "Win32", "Official_CN", "没有.png"),
    );
});

test("统计总数 / 存在数 / 缺失数", () => {
    const scan = scanImages(
        cfg,
        [
            (() => {
                const group = groupWith("Win32", "Win32/Official_CN");
                group.cases = [
                    {image: "a.png", hits: []},
                    {image: "b.png", hits: []},
                ];
                return group;
            })(),
            (() => {
                const group = groupWith("ADB", "ADB/Official_CN");
                group.cases = [{image: "a.png", hits: []}];
                return group;
            })(),
        ],
        (file) => file.includes(`${path.sep}ADB${path.sep}`),
    );
    assert.deepEqual(countImages(scan), {total: 3, existing: 1, missing: 2});
    assert.deepEqual(countImages([]), {total: 0, existing: 0, missing: 0});
});
