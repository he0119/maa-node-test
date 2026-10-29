import {strict as assert} from "node:assert";
import {test} from "node:test";

import {fixtureResult, platformResult} from "./result-builders.test-helper";
import {validateListDocument, validateResultDocument, type ResultDocument} from "./protocol";
import {upstreamReports} from "./upstream-reports.test-helper";

const selection = {workspaceRoot: "/repo", testFiles: ["tests/test_a.json"]};

function validate(result: unknown) {
    return validateResultDocument(result, selection);
}

function failedResult(): ResultDocument {
    const result = fixtureResult("/repo", [1]);
    const file = result.files[0];
    file.cases[0].platforms[0].result = platformResult(file.file, 1, "Desktop", "fail");
    file.cases[0].verdict = "fail";
    file.verdict = "fail";
    result.status = "failed";
    return result;
}

test("合法结果只有files平台明细，无需版本字段并可使用不连续原始下标", () => {
    const result = fixtureResult();
    assert.equal(validate(result), result);
    assert.doesNotMatch(
        JSON.stringify([
            result,
            upstreamReports,
        ]),
        /"(?:groups|schemaVersion)"/,
    );
    assert.equal(result.files[0].cases[0].platforms[0].result.checks[0].detail, null);
});

test("清单和运行结果允许额外未知字段，外部groups不被消费", () => {
    const result = {...fixtureResult(), diagnostics: {future: true}, groups: {ignored: true}};
    assert.equal(validate(result), result);
    const list = {files: result.files, diagnostics: ["extra"]};
    assert.equal(validateListDocument(list), list);
    for (const invalid of [
        null,
        [],
        true,
        1,
        "result",
        {},
        {files: null},
    ]) {
        assert.throws(() => validateListDocument(invalid));
        assert.throws(() => validate(invalid));
    }
});

test("拒绝未知状态、缺失的必要字段和平台子结构", () => {
    for (const mutate of [
        (result: Record<string, unknown>) => {
            delete result.status;
        },
        (result: Record<string, unknown>) => {
            result.status = "success";
        },
        (result: Record<string, unknown>) => {
            result.status = ["passed"];
        },
        (result: Record<string, unknown>) => {
            delete result.durationMs;
        },
        (result: Record<string, unknown>) => {
            delete result.files;
        },
    ]) {
        const result = fixtureResult() as unknown as Record<string, unknown>;
        mutate(result);
        assert.throws(() => validate(result));
    }
    for (const field of [
        "controller",
        "resource",
        "result",
    ]) {
        const result = fixtureResult();
        delete (result.files[0].cases[0].platforms[0] as unknown as Record<string, unknown>)[field];
        assert.throws(() => validate(result), new RegExp(field));
    }
    for (const field of [
        "image",
        "imagePath",
        "verdict",
        "checks",
        "durationMs",
        "origin",
    ]) {
        const result = fixtureResult();
        delete (result.files[0].cases[0].platforms[0].result as unknown as Record<string, unknown>)[field];
        assert.throws(() => validate(result), new RegExp(field));
    }
    for (const field of [
        "name",
        "image",
        "hits",
        "start",
        "end",
    ]) {
        const result = fixtureResult();
        delete (result.files[0].cases[0] as unknown as Record<string, unknown>)[field];
        assert.throws(() => validate(result), new RegExp(field));
    }
    const result = fixtureResult();
    delete (result.files[0].cases[0].platforms[0].result.checks[0] as unknown as Record<string, unknown>).detail;
    assert.throws(() => validate(result), /detail/);
});

test("所选文件、selectedCases和外部收集索引必须完整对应", () => {
    const missingFile = {...fixtureResult(), status: "empty", errorCode: "no-tests-matched", files: []};
    assert.throws(() => validate(missingFile), /缺少所选测试文件/);
    const missingCase = fixtureResult();
    missingCase.files[0].cases.pop();
    assert.throws(() => validate(missingCase), /selectedCases/);
    assert.throws(() => validateResultDocument(fixtureResult(), {...selection, caseIndex: 1}), /未选用例/);
    assert.throws(
        () =>
            validateResultDocument(fixtureResult(), {
                ...selection,
                expectedCases: new Map([
                    [
                        "tests/test_a.json",
                        [
                            1,
                            2,
                            3,
                        ],
                    ],
                ]),
            }),
        /用例下标不完整/,
    );
    const unrequested = fixtureResult("/other");
    assert.throws(() => validate(unrequested), /所选测试文件|未请求/);
});

test("唯一files中的平台必须保留绝对来源、原始下标和对应截图", () => {
    const missingOrigin = fixtureResult();
    delete (missingOrigin.files[0].cases[0].platforms[0].result as unknown as Record<string, unknown>).origin;
    assert.throws(() => validate(missingOrigin), /origin 必须是对象/);
    for (const origin of [
        undefined,
        null,
        [],
        "origin",
        1,
        true,
        {},
        {file: "/repo/tests/test_a.json"},
        {case: 1},
        {file: "tests/test_a.json", case: 1},
        {file: "/repo/tests/test_other.json", case: 1},
        {file: "/repo/tests/test_a.json", case: 3},
        {file: "/repo/tests/test_a.json", case: -1},
        {file: "/repo/tests/test_a.json", case: 1.5},
        {file: "/repo/tests/test_a.json", case: Number.MAX_SAFE_INTEGER + 1},
        {file: "/repo/tests/test_a.json", case: "1"},
    ]) {
        const result = fixtureResult();
        (result.files[0].cases[0].platforms[0].result as unknown as Record<string, unknown>).origin = origin;
        assert.throws(() => validate(result), /来源|origin/);
    }
    const wrongImage = fixtureResult();
    wrongImage.files[0].cases[0].platforms[0].result.image = "other.png";
    assert.throws(() => validate(wrongImage), /截图与文件元数据不一致/);
    const relativeImage = fixtureResult();
    relativeImage.files[0].cases[0].platforms[0].result.imagePath = "images/case-1.png";
    assert.throws(() => validate(relativeImage), /imagePath.*绝对路径/);
    for (const caseIndex of [
        -1,
        1.5,
        Number.MAX_SAFE_INTEGER + 1,
    ]) {
        const result = fixtureResult();
        result.files[0].selectedCases[0] = caseIndex;
        assert.throws(() => validate(result), /selectedCases/);
    }
});

test("通过汇总不得吞掉底层失败检查或错误状态", () => {
    const result = fixtureResult();
    result.files[0].cases[0].platforms[0].result.checks[0].ok = false;
    assert.throws(() => validate(result), /包含失败检查/);
    const caseContradiction = fixtureResult();
    caseContradiction.files[0].cases[0].platforms[0].result.verdict = "error";
    assert.throws(() => validate(caseContradiction), /平台结论/);
    for (const verdict of [
        "fail",
        "error",
        "skipped",
    ] as const) {
        const wrongCase = fixtureResult();
        wrongCase.files[0].cases[0].verdict = verdict;
        assert.throws(() => validate(wrongCase), /平台结论/);
    }
    for (const verdict of [
        "fail",
        "error",
    ] as const) {
        const wrongFile = fixtureResult();
        wrongFile.files[0].verdict = verdict;
        assert.throws(() => validate(wrongFile), /文件结论/);
    }
    const fileError = fixtureResult();
    fileError.files[0].error = "test-file-error";
    assert.throws(() => validate(fileError), /文件结论/);
});

test("顶层passed需要真实验证且不能掩盖失败，failed需要真实失败", () => {
    const contradiction = fixtureResult();
    contradiction.status = "failed";
    assert.throws(() => validate(contradiction), /failed 却没有失败文件/);
    const failure = failedResult();
    assert.equal(validate(failure), failure);
    failure.status = "passed";
    assert.throws(() => validate(failure), /passed.*矛盾/);
    const allMissing = structuredClone(upstreamReports.allMissing);
    allMissing.status = "passed";
    assert.throws(() => validate(allMissing), /passed.*矛盾/);
});

test("文件错误与已完成失败并存时文件为fail，根状态必须为error", () => {
    const result = failedResult();
    const file = result.files[0];
    file.error = "test-file-error";
    file.reason = file.error;
    result.status = "error";
    result.errorCode = "test-file-error";
    assert.equal(validate(result), result);
    file.verdict = "error";
    assert.throws(() => validate(result), /文件结论应汇总为 fail/);
    file.verdict = "fail";
    for (const status of [
        "failed",
        "passed",
    ] as const) {
        result.status = status;
        assert.throws(() => validate(result), status === "failed" ? /failed 掩盖了运行错误/ : /passed.*矛盾/);
    }
});

test("文件fail及用例fail不能让顶层failed遮住同时存在的平台运行错误", () => {
    const result = failedResult();
    const file = result.files[0];
    file.cases[0].platforms.push({
        controller: "Mobile",
        resource: "CN",
        result: {...platformResult(file.file, 1, "Mobile", "error"), error: "test-execution-failed"},
    });
    assert.throws(() => validate(result), /failed 掩盖了运行错误/);
    result.status = "error";
    assert.equal(validate(result), result);
    const acrossCases = failedResult();
    const errorCase = structuredClone(upstreamReports.partialError.files[0].cases[0]);
    errorCase.index = 3;
    for (const platform of errorCase.platforms) platform.result.origin.case = 3;
    acrossCases.files[0].cases.push(errorCase);
    acrossCases.files[0].selectedCases.push(3);
    assert.throws(() => validate(acrossCases), /failed 掩盖了运行错误/);
    acrossCases.status = "error";
    assert.equal(validate(acrossCases), acrossCases);
});

test("明确全局错误可保留已完成pass或fail，空的error状态不能伪装执行错误", () => {
    for (const result of [
        fixtureResult(),
        failedResult(),
    ]) {
        result.status = "error";
        assert.throws(() => validate(result), /全局 errorCode/);
        result.errorCode = "test-execution-failed";
        assert.equal(validate(result), result);
    }
});

test("同控制器资源可有多个实际平台项，不以组合名称去重或拒绝", () => {
    const result = fixtureResult("/repo", [1]);
    const testCase = result.files[0].cases[0];
    const another = structuredClone(testCase.platforms[0]);
    another.result.durationMs = 7;
    another.result.imagePath = "/another-images/Desktop/case-1.png";
    testCase.platforms.push(another, structuredClone(another));
    testCase.durationMs = 17;
    assert.equal(validate(result), result);
    assert.equal(testCase.platforms.length, 3);
});

test("实际maa-tools report输出：合法未执行占位和正常文件均保留", () => {
    const result = structuredClone(upstreamReports.partialError);
    const request = {
        ...selection,
        testFiles: [
            "tests/test_a.json",
            "tests/test_b.json",
        ],
    };
    validateResultDocument(result, request);
    assert.equal(result.status, "error");
    assert.equal(result.files[0].cases[0].platforms[1].result.imagePath, "");
    assert.equal(result.files[1].verdict, "pass");
    for (const mutate of [
        (value: ResultDocument) => {
            value.files[0].cases[0].platforms[1].result.durationMs = 1;
        },
        (value: ResultDocument) => {
            delete value.files[0].cases[0].platforms[1].result.error;
        },
        (value: ResultDocument) => {
            value.files[0].cases[0].platforms[1].result.checks.push(
                structuredClone(value.files[0].cases[0].platforms[0].result.checks[0]),
            );
        },
    ]) {
        const invalid = structuredClone(result);
        mutate(invalid);
        assert.throws(() => validateResultDocument(invalid, request), /尚未执行的错误占位/);
    }
});

test("实际maa-tools report输出：部分缺图可以文件pass，全缺图error，无匹配empty", () => {
    for (const name of [
        "partialMissing",
        "allMissing",
        "empty",
    ] as const)
        validate(upstreamReports[name]);
    assert.equal(upstreamReports.partialMissing.files[0].verdict, "pass");
    assert.equal(upstreamReports.partialMissing.files[0].cases[0].verdict, "skipped");
    assert.equal(upstreamReports.allMissing.status, "error");
    assert.equal(upstreamReports.empty.status, "empty");
});

test("empty只接受无执行事实，包括合法未执行error占位", () => {
    const result = structuredClone(upstreamReports.empty);
    result.files[0].cases[0].platforms.push({
        controller: "Desktop",
        resource: "CN",
        result: {
            image: "a.png",
            imagePath: "",
            origin: {file: result.files[0].file, case: 1},
            verdict: "error",
            checks: [],
            durationMs: 0,
            error: "no-tests-matched",
        },
    });
    assert.equal(validate(result), result);
    const timed = structuredClone(upstreamReports.empty);
    timed.files[0].cases[0].durationMs = 1;
    assert.throws(() => validate(timed), /empty 却包含已运行/);
    for (const source of [
        fixtureResult(),
        failedResult(),
        upstreamReports.partialMissing,
        upstreamReports.allMissing,
    ]) {
        const executed = structuredClone(source);
        executed.status = "empty";
        executed.errorCode = "no-tests-matched";
        assert.throws(() => validate(executed), /empty 却包含已运行/);
    }
    const runtimeError = structuredClone(result);
    runtimeError.files[0].cases[0].platforms[0].result.imagePath = "/images/Desktop/a.png";
    assert.throws(() => validate(runtimeError), /empty 却包含已运行/);
});

test("启动错误必须带错误代码；empty必须明确no-tests-matched", () => {
    const result: ResultDocument = {
        status: "error",
        files: [],
        durationMs: 0,
        errorCode: "config-load-failed",
    };
    validate(result);
    delete result.errorCode;
    assert.throws(() => validate(result), /errorCode/);
    result.status = "empty";
    assert.throws(() => validate(result), /no-tests-matched/);
});

test("收集协议检查绝对路径、元数据和重复下标；接受错误额外字段", () => {
    const file = structuredClone(fixtureResult().files[0]);
    const doc = {files: [file]};
    validateListDocument(doc);
    validateListDocument({...doc, status: "error", durationMs: 0, errorCode: "collection-source-missing"});
    file.file = "tests/test_a.json";
    assert.throws(() => validateListDocument(doc), /绝对路径/);
});
