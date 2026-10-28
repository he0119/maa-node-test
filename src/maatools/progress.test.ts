import {strict as assert} from "node:assert";
import {test} from "node:test";

import {fileCase, fixtureResult} from "./result-builders.test-helper";
import {RunProgress} from "./progress";
import {
    validateResultDocument,
    validateTestRunEvent,
    type ResultDocument,
    type ResultSelection,
    type TestRunEvent,
} from "./protocol";
import {upstreamReports} from "./upstream-reports.test-helper";

const selection: ResultSelection = {
    workspaceRoot: "/repo",
    testFiles: ["tests/test_a.json"],
    expectedCases: new Map([
        [
            "tests/test_a.json",
            [
                1,
                3,
            ],
        ],
    ]),
};
const origin = (index: number) => ({file: "/repo/tests/test_a.json", case: index});
const started = (index: number): TestRunEvent => ({schemaVersion: 1, type: "case-started", origin: origin(index)});
const caseEvent = (index: number, result = fixtureResult("/repo", [index])): TestRunEvent => ({
    schemaVersion: 1,
    type: "case-result",
    origin: origin(index),
    result,
});
const fileEvent = (result = fixtureResult()): TestRunEvent => ({
    schemaVersion: 1,
    type: "file-result",
    file: result.files[0].file,
    result,
});

function finalCheck(progress: RunProgress, result = fixtureResult()) {
    progress.checkFinal(validateResultDocument(result, selection));
}

test("进度拒绝未知schema/type、相对来源和请求外文件或用例", () => {
    for (const event of [
        null,
        {...started(1), schemaVersion: 2},
        {...started(1), type: ["case-started"]},
        {...started(1), type: "future-result"},
        {schemaVersion: 1, type: "case-started", origin: {file: "tests/test_a.json", case: 1}},
        {schemaVersion: 1, type: "case-started", origin: {file: "/repo/tests/other.json", case: 1}},
        started(2),
        {schemaVersion: 1, type: "case-started", origin: {file: origin(1).file, case: 1.5}},
    ])
        assert.throws(() => validateTestRunEvent(event, selection));
});

test("结果事件必须是与来源一致的单case或单file完整快照", () => {
    assert.throws(() => validateTestRunEvent(caseEvent(1, fixtureResult()), selection), /下标不完整或包含未选/);
    assert.throws(() => validateTestRunEvent(caseEvent(3, fixtureResult("/repo", [1])), selection), /下标不完整/);
    assert.throws(() => validateTestRunEvent(fileEvent(fixtureResult("/repo", [1])), selection), /下标不完整/);
    const startup: ResultDocument = {
        schemaVersion: 1,
        status: "error",
        errorCode: "config-load-failed",
        groups: [],
        files: [],
        durationMs: 0,
    };
    assert.throws(() => validateTestRunEvent(caseEvent(1, startup), selection), /必须包含对应的单个文件/);
});

test("乱序完成独立用例合法，相同重复消息只更新一次", () => {
    const progress = new RunProgress(selection);
    assert.ok(progress.accept(started(1)));
    assert.equal(progress.accept(started(1)), null);
    assert.ok(progress.accept(caseEvent(3)));
    assert.ok(progress.accept(caseEvent(1)));
    assert.equal(progress.accept(caseEvent(1)), null);
    assert.ok(progress.accept(fileEvent()));
    assert.equal(progress.accept(fileEvent()), null);
    finalCheck(progress);
});

test("完成用例不会被迟到的开始消息重置", () => {
    const progress = new RunProgress(selection);
    progress.accept(caseEvent(1));
    assert.throws(() => progress.accept(started(1)), /已经完成/);
});

test("重复结果矛盾和文件快照遗漏已完成case立即报错", () => {
    const progress = new RunProgress(selection);
    progress.accept(caseEvent(1));
    const changed = fixtureResult("/repo", [1]);
    changed.files[0].cases[0].reason = "changed";
    assert.throws(() => progress.accept(caseEvent(1, changed)), /重复用例结果互相矛盾/);
    const unknownSelection = new RunProgress({...selection, expectedCases: undefined});
    unknownSelection.accept(caseEvent(1));
    assert.throws(() => unknownSelection.accept(fileEvent(fixtureResult("/repo", [3]))), /遗漏已完成用例/);
});

test("文件快照不能改变已完成case事实，重复文件矛盾立即报错", () => {
    const progress = new RunProgress(selection);
    progress.accept(caseEvent(1));
    const changed = fixtureResult();
    changed.files[0].cases[0].durationMs++;
    assert.throws(() => progress.accept(fileEvent(changed)), /与已完成用例矛盾/);
    progress.accept(fileEvent());
    const duplicate = fixtureResult();
    duplicate.files[0].reason = "different";
    assert.throws(() => progress.accept(fileEvent(duplicate)), /重复文件结果互相矛盾/);
});

test("最终补全缺失事件，进度与最终整批状态和墙钟时间可不同", () => {
    const progress = new RunProgress(selection);
    progress.accept(caseEvent(1));
    const result = fixtureResult();
    result.status = "error";
    result.errorCode = "test-execution-failed";
    result.durationMs = 100;
    finalCheck(progress, result);
});

test("单case快照文件error不妨碍最终文件因其他有效用例而pass", () => {
    const progress = new RunProgress(selection);
    const skipped = structuredClone(upstreamReports.allMissing);
    progress.accept(caseEvent(1, skipped));
    const result = structuredClone(skipped);
    const passed = fileCase(result.files[0].file, 3);
    result.files[0].cases.push(passed);
    result.files[0].selectedCases.push(3);
    result.files[0].verdict = "pass";
    result.files[0].reason = "some-platforms-skipped";
    result.groups.push({
        name: "other",
        controller: "Desktop",
        resource: "CN",
        verdict: "pass",
        cases: [passed.platforms[0].result],
        durationMs: 3,
    });
    result.status = "passed";
    delete result.errorCode;
    delete result.reason;
    finalCheck(progress, result);
});

test("最终报告改变已发布case或file必须报错", () => {
    const progress = new RunProgress(selection);
    progress.accept(caseEvent(1));
    const changed = fixtureResult();
    changed.files[0].cases[0].reason = "changed";
    assert.throws(() => finalCheck(progress, changed), /已完成用例结果不一致/);
    progress.accept(fileEvent());
    const changedFile = fixtureResult();
    changedFile.files[0].reason = "changed";
    assert.throws(() => finalCheck(progress, changedFile), /已完成文件结果不一致/);
});

test("最终必须覆盖已开始但未完成的来源，启动错误不能吞掉进度", () => {
    const progress = new RunProgress({...selection, expectedCases: undefined});
    progress.accept(started(7));
    assert.throws(() => progress.checkFinal(fixtureResult()), /遗漏已经开始的用例/);
    progress.accept(caseEvent(1));
    assert.throws(
        () =>
            progress.checkFinal({
                schemaVersion: 1,
                status: "error",
                errorCode: "test-execution-failed",
                files: [],
                groups: [],
                durationMs: 0,
            }),
        /遗漏/,
    );
});

test("取消partial保留完成case，只有file-result才能把文件当作完成", () => {
    const progress = new RunProgress(selection);
    progress.accept(caseEvent(1));
    let partial = progress.partial();
    assert.equal(partial.caseResults.get("tests/test_a.json#1")?.verdict, "pass");
    assert.equal(partial.fileResults.size, 0);
    progress.accept(fileEvent());
    partial = progress.partial();
    assert.equal(partial.fileResults.get("tests/test_a.json"), "pass");
    assert.equal(partial.caseResults.size, 2);
});

test("回调或调用方修改消息不能污染保存的事实", () => {
    const progress = new RunProgress(selection);
    const original = caseEvent(1);
    const published = progress.accept(original);
    if (original.type === "case-result") original.result.files[0].cases[0].reason = "original mutated";
    if (published?.type === "case-result") published.result.files[0].cases[0].reason = "callback mutated";
    finalCheck(progress);
});
