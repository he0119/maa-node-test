import {strict as assert} from "node:assert";
import {test} from "node:test";

import {fixtureResult} from "./fixtures.test-helper";
import {validateListDocument, validateResultDocument, type ResultDocument} from "./protocol";
import {reportFixtures} from "./report-fixtures.test-helper";

const selection = {workspaceRoot: "/repo", testFiles: ["tests/test_a.json"]};

function validate(result: unknown) {
    return validateResultDocument(result, selection);
}

test("已知schema的合法结果可以使用不连续原始下标", () => {
    const result = fixtureResult();
    assert.equal(validate(result), result);
});

test("拒绝未知版本、状态和缺失的必要子结构", () => {
    for (const mutate of [
        (result: Record<string, unknown>) => {
            delete result.schemaVersion;
        },
        (result: Record<string, unknown>) => {
            result.schemaVersion = 2;
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
    const result = fixtureResult();
    delete (result.files[0].cases[0].platforms[0].result as unknown as Record<string, unknown>).checks;
    assert.throws(() => validate(result), /checks/);
});

test("所选文件、selectedCases和外部收集索引必须完整对应", () => {
    const missingFile = fixtureResult();
    missingFile.files = [];
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
});

test("顶层failed不能被全pass文件掩盖，组的失败必须全部有来源", () => {
    const contradiction = fixtureResult();
    contradiction.status = "failed";
    assert.throws(() => validate(contradiction), /failed 却没有失败文件/);
    const noOrigin = fixtureResult();
    delete noOrigin.groups[0].cases[0].origin;
    assert.throws(() => validate(noOrigin), /来源/);
    const dropped = fixtureResult();
    dropped.groups[0].cases.push({
        ...dropped.groups[0].cases[0],
        origin: {file: "/repo/tests/test_other.json", case: 7},
        verdict: "fail",
    });
    dropped.groups[0].verdict = "fail";
    assert.throws(() => validate(dropped), /矛盾|未归入/);
});

test("通过汇总不得吞掉底层失败检查或错误状态", () => {
    const result = fixtureResult();
    result.files[0].cases[0].platforms[0].result.checks[0].ok = false;
    assert.throws(() => validate(result), /包含失败检查/);
    const caseContradiction = fixtureResult();
    caseContradiction.files[0].cases[0].platforms[0].result.verdict = "error";
    assert.throws(() => validate(caseContradiction), /标记通过/);
});

test("实际maa-tools report输出：合法未执行占位和正常文件均保留", () => {
    const result = structuredClone(reportFixtures.partialError);
    validateResultDocument(result, {
        ...selection,
        testFiles: [
            "tests/test_a.json",
            "tests/test_b.json",
        ],
    });
    assert.equal(result.status, "error");
    assert.equal(result.files[0].cases[0].platforms[1].result.imagePath, "");
    assert.equal(result.files[1].verdict, "pass");
    result.files[0].cases[0].platforms[1].result.durationMs = 1;
    assert.throws(
        () =>
            validateResultDocument(result, {
                ...selection,
                testFiles: [
                    "tests/test_a.json",
                    "tests/test_b.json",
                ],
            }),
        /没有对应测试组/,
    );
});

test("实际maa-tools report输出：部分缺图可以文件pass，全缺图error，无匹配empty", () => {
    for (const name of [
        "partialMissing",
        "allMissing",
        "empty",
    ] as const)
        validate(reportFixtures[name]);
    assert.equal(reportFixtures.partialMissing.files[0].verdict, "pass");
    assert.equal(reportFixtures.partialMissing.files[0].cases[0].verdict, "skipped");
    assert.equal(reportFixtures.allMissing.status, "error");
    assert.equal(reportFixtures.empty.status, "empty");
});

test("启动错误必须带错误代码；empty不能仅凭空groups猜测", () => {
    const result: ResultDocument = {
        schemaVersion: 1,
        status: "error",
        groups: [],
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
    const doc = {schemaVersion: 1, files: [file]};
    validateListDocument(doc);
    validateListDocument({...doc, status: "error", groups: [], durationMs: 0, errorCode: "collection-source-missing"});
    file.file = "tests/test_a.json";
    assert.throws(() => validateListDocument(doc), /绝对路径/);
});
