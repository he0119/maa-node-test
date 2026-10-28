import {strict as assert} from "node:assert";
import {test} from "node:test";

import {fixtureResult, platformResult} from "./result-builders.test-helper";
import {
    adaptResultFiles,
    caseInfoToVerdict,
    caseOutcome,
    describeCheck,
    describeResultReason,
    overallVerdict,
    summarizePlatforms,
} from "./resultAdapter";

test("使用上游原始下标和聚合结论，不从用例数量或明细反推", () => {
    const result = fixtureResult();
    const aggregate = result.files[0].cases[0];
    aggregate.verdict = "error";
    aggregate.reason = "no-result";
    const maps = adaptResultFiles(result, "/repo");
    assert.deepEqual(
        [...maps.caseResults.keys()],
        [
            "tests/test_a.json#1",
            "tests/test_a.json#3",
        ],
    );
    assert.equal(maps.counts.get("tests/test_a.json"), 2);
    const info = maps.caseResults.get("tests/test_a.json#1")!;
    assert.equal(caseOutcome(info), "error");
    assert.equal(caseInfoToVerdict(info).verdict, "error");
    assert.match(caseInfoToVerdict(info).detail.join("\n"), /未完成验证/);
    assert.equal(maps.fileResults.get("tests/test_a.json"), "pass", "显示转换不重判领域结论；协议检查另行处理");
});

test("同名组的平台来自文件case的platforms，不按组名查找", () => {
    const result = fixtureResult();
    const testCase = result.files[0].cases[0];
    testCase.platforms.push({
        controller: "Mobile",
        resource: "CN",
        result: platformResult(result.files[0].file, 1, "Mobile", "fail"),
    });
    testCase.verdict = "fail";
    const maps = adaptResultFiles(result, "/repo");
    const shown = caseInfoToVerdict(maps.caseResults.get("tests/test_a.json#1")!);
    assert.equal(shown.title, "Mobile-CN 失败");
    assert.ok(shown.detail.includes("通过：Desktop-CN"));
    assert.match(shown.detail.join("\n"), /这张图上没识别到该节点/);
});

test("部分平台通过但聚合skipped时，保留文件pass和缺图提示", () => {
    const result = fixtureResult();
    const file = result.files[0];
    file.reason = "some-platforms-skipped";
    const testCase = file.cases[0];
    testCase.platforms.push({
        controller: "Mobile",
        resource: "CN",
        result: platformResult(file.file, 1, "Mobile", "skipped"),
    });
    testCase.verdict = "skipped";
    testCase.reason = "missing-image";
    const maps = adaptResultFiles(result, "/repo");
    const info = maps.caseResults.get("tests/test_a.json#1")!;
    assert.equal(maps.fileResults.get("tests/test_a.json"), "pass");
    assert.equal(caseInfoToVerdict(info).verdict, "skipped");
    assert.match(caseInfoToVerdict(info).detail.join("\n"), /Mobile/);
    assert.match(maps.fileReasons.get("tests/test_a.json")!, /已有平台完成验证/);
});

test("平台覆盖按文件统计，其他文件同平台不会掩盖缺项", () => {
    const result = fixtureResult();
    const maps = adaptResultFiles(result, "/repo");
    maps.entries.push({...maps.entries[0], key: "tests/test_b.json", controllers: ["Mobile"], cases: []});
    const summary = summarizePlatforms(maps.entries);
    assert.equal(summary.platforms[0].images, 2);
    assert.deepEqual(summary.unmatched, [{controller: "Mobile", file: "tests/test_b.json"}]);
});

test("原因代码显示中文，未知说明保留；检查明细按枚举翻译", () => {
    assert.match(describeResultReason("missing-image"), /缺少截图/);
    assert.equal(describeResultReason("用户配置的具体错误"), "用户配置的具体错误");
    assert.match(describeCheck({node: "A", reason: "should-miss"}).reason, /不期望它命中/);
    assert.match(
        describeCheck({
            node: "A",
            reason: "box-mismatch",
            expectedBox: [
                1,
                2,
                3,
                4,
            ],
        }).reason,
        /没有返回识别框/,
    );
    assert.match(describeCheck({node: "A", reason: "missing-detail"}).reason, /未返回明细/);
    assert.match(describeCheck({node: "A", reason: "no-result"}).reason, /没跑出/);
});

test("整体显示不把空Map或文件error当作通过", () => {
    assert.equal(overallVerdict(new Map()), "empty");
    assert.equal(
        overallVerdict(
            new Map([
                [
                    "a",
                    "pass",
                ],
                [
                    "b",
                    "error",
                ],
            ]),
        ),
        "error",
    );
    assert.equal(
        overallVerdict(
            new Map([
                [
                    "a",
                    "fail",
                ],
            ]),
        ),
        "fail",
    );
});
