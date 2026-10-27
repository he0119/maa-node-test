// 退出码与 RESULT 行。两者必须一一对应，调用方（VS Code 扩展）会同时看 stdout 最后一行和退出码。

/**
 * 0 通过：dry-run 有匹配，或实际运行全部用例通过
 * 1 测试失败：maa-tools 明确报了失败
 * 2 前置错误：参数非法、配置加载失败、截图一张都不存在、MaaFW 准备失败、运行抛异常
 * 3 过滤后没有任何用例可跑
 */
export const EXIT_CODES = {
    pass: 0,
    fail: 1,
    error: 2,
    empty: 3,
};

/** 固定格式，不要加装饰，扩展会按这一行判断结果。 */
export function resultLine(kind) {
    if (!Object.prototype.hasOwnProperty.call(EXIT_CODES, kind)) {
        throw new Error(`未知结果类型：${kind}`);
    }
    return `RESULT: ${kind}`;
}

/**
 * 打印结果行并设置退出码。
 * 用 process.exitCode 而不是 process.exit()：后者会截断还没冲出去的 stdout 缓冲，
 * 导致重定向到文件或管道时丢日志。
 */
export function printResult(kind) {
    console.log(resultLine(kind));
    process.exitCode = EXIT_CODES[kind];
}
