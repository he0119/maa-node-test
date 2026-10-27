// 读取目标测试文件，并把「本文件声明了什么」整理成过滤用的 target。
//
// 读取方式必须和 maa-tools 一致：用 jsonc-parser 的 parse（允许注释、允许尾逗号），
// 否则会出现「maa-tools 能读、我这里报错」的分歧。

import {parse, printParseErrorCode} from "jsonc-parser";

import {caseKey} from "./case-key.mjs";

/** 测试文件读不了 / 不符合结构。入口当作前置错误，退出码 2。 */
export class TestFileError extends Error {
    constructor(message) {
        super(message);
        this.name = "TestFileError";
    }
}

/** --case 写了个该文件里不存在的下标。入口当作「没有可跑用例」，退出码 3。 */
export class CaseIndexOutOfRangeError extends Error {
    constructor(index, total) {
        super(`用例下标 ${index} 超出范围：该文件只有 ${total} 个用例（合法下标 0..${total - 1}）`);
        this.name = "CaseIndexOutOfRangeError";
        this.index = index;
        this.total = total;
    }
}

/**
 * 解析测试文件文本。
 *
 * 调用方式和 @nekosu/maa-tools 的 loadTestCases 完全一致：`parse(text, errors)`，不带选项。
 * 这样注释是允许的，但尾逗号不允许 —— 这正是 maa-tools 的真实行为（它会因为 errors 非空
 * 把整个文件判成「读不了」，该文件的用例直接不参与测试）。这里保持一致，避免出现
 * 「本脚本说能读、maa-tools 却整文件丢弃」的分歧。
 */
export function parseTestFile(text) {
    const errors = [];
    const value = parse(text, errors);
    if (errors.length === 0) return value;

    const detail = errors.map((error) => `${printParseErrorCode(error.error)}（字符偏移 ${error.offset}）`).join("；");

    // 再用宽松模式试一次：如果只是尾逗号的问题，就把话说准，省得人对着偏移号找半天。
    const lenientErrors = [];
    parse(text, lenientErrors, {allowTrailingComma: true});
    if (lenientErrors.length === 0) {
        throw new TestFileError(
            `JSON 解析失败：${detail}\n` +
                `提示：这个文件只是「尾逗号」不合规（数组或对象的最后一项后面多了逗号）。` +
                `maa-tools 读测试文件时会把整个文件判为读取失败，请删掉尾逗号。`,
        );
    }

    throw new TestFileError(`JSON 解析失败：${detail}`);
}

/** 把任意 JSON 值规整成字符串数组：单值当成单元素数组，数组去重，其它值算空。 */
function normalizeMatrixValue(value) {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return [...new Set(value.filter((item) => typeof item === "string"))];
    return [];
}

/**
 * 校验结构并规整。只做本脚本需要的检查：configs.controller / configs.resource / cases。
 * 其余字段（name、hits 的 box 等）交给 maa-tools 自己处理，这里不重复造 schema。
 */
export function normalizeTestFile(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new TestFileError("顶层必须是对象（要有 configs 和 cases）");
    }

    const configs = raw.configs;
    if (!configs || typeof configs !== "object" || Array.isArray(configs)) {
        throw new TestFileError("缺少 configs 对象");
    }

    const controllers = normalizeMatrixValue(configs.controller);
    if (controllers.length === 0) throw new TestFileError("configs.controller 必须是非空字符串或字符串数组");

    const resources = normalizeMatrixValue(configs.resource);
    if (resources.length === 0) throw new TestFileError("configs.resource 必须是非空字符串或字符串数组");

    const name = typeof configs.name === "string" && configs.name.length > 0 ? configs.name : null;

    if (!Array.isArray(raw.cases)) throw new TestFileError("缺少 cases 数组");
    const cases = raw.cases;
    if (cases.length === 0) throw new TestFileError("cases 是空数组，没有可运行用例");
    cases.forEach((testCase, index) => {
        if (!testCase || typeof testCase !== "object" || typeof testCase.image !== "string" || testCase.image === "") {
            throw new TestFileError(`第 ${index} 个用例缺少 image（截图文件名）`);
        }
        if (!Array.isArray(testCase.hits)) {
            throw new TestFileError(`第 ${index} 个用例缺少 hits 数组（负例请写空数组）`);
        }
    });

    return {controllers, resources, name, cases};
}

/**
 * 生成过滤用的 target：本文件声明的 controller / resource / configs.name，以及要跑的用例键集合。
 * caseIndex 为 null 表示整个文件；否则只挑那一个用例（越界抛 CaseIndexOutOfRangeError）。
 */
export function buildTarget(testFile, caseIndex = null) {
    const {cases} = testFile;

    if (caseIndex !== null) {
        if (!Number.isInteger(caseIndex) || caseIndex < 0 || caseIndex >= cases.length) {
            throw new CaseIndexOutOfRangeError(caseIndex, cases.length);
        }
    }

    const selected = caseIndex === null ? cases : [cases[caseIndex]];
    return {
        controllers: testFile.controllers,
        resources: testFile.resources,
        name: testFile.name,
        caseKeys: [...new Set(selected.map((testCase) => caseKey(testCase)))],
        cases: selected,
        caseIndex,
    };
}
