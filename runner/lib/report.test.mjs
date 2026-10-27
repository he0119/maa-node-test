import assert from "node:assert/strict";
import {test} from "node:test";

import {EXIT_CODES, resultLine} from "./report.mjs";

test("退出码映射固定不变（扩展按它对结果）", () => {
    assert.deepEqual(EXIT_CODES, {pass: 0, fail: 1, error: 2, empty: 3});
});

test("RESULT 行格式固定", () => {
    assert.equal(resultLine("pass"), "RESULT: pass");
    assert.equal(resultLine("fail"), "RESULT: fail");
    assert.equal(resultLine("error"), "RESULT: error");
    assert.equal(resultLine("empty"), "RESULT: empty");
});

test("未知结果类型直接报错，避免打出无法解析的行", () => {
    assert.throws(() => resultLine("ok"), /未知结果类型/);
});
