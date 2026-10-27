// 把 runner 打出来的结论行翻译成测试面板要用的东西：文件结论、逐用例结论、失败文案。
//
// 单独放一个纯模块（不 import vscode）是为了能直接单测：解析是「runner 输出格式」的契约另一端，
// 格式一旦变，这里的测试应该先红。
//
// 文案分两层：
//   title  —— 面板节点上显示的那一行，越短越好（「CloudADB-官服 失败」「2 条用例失败」）；
//   detail —— 点开测试结果后看到的列表项（哪个节点、什么原因、哪张截图、哪些平台是好的）。

/** 单个文件 / 单条用例的结论 */
export type FileVerdict = "pass" | "fail" | "error";

/** 单条用例的结论 + 具体原因（原因来自 maa-tools 的 error_details.json） */
export interface CaseVerdict {
    verdict: FileVerdict;
    title: string;
    detail: string[];
}

/** 一条用例最终要标成什么，以及悬停时显示什么 */
export interface CaseMark {
    caseIndex?: number;
    verdict: FileVerdict;
    text: VerdictText;
}

/** 一次文件级运行要打给面板的全部标记 */
export interface FileMarking {
    file: {verdict: FileVerdict; text: VerdictText};
    cases: CaseMark[];
}

/** 一段给人看的文案：短标题 + 展开后的列表项 */
export interface VerdictText {
    title: string;
    detail: string[];
}

/** runner 给每个文件打的结论行：`RESULT-FILE: <相对路径> pass|fail|error` */
export const FILE_RESULT_PATTERN = /^RESULT-FILE: (.+) (pass|fail|error)$/;

/**
 * runner 给单条用例打的结论行：`RESULT-CASE: {"file":…,"case":…,"verdict":…,"title":…,"detail":[…]}`。
 * 用 JSON 是因为失败原因里带空格、逗号和反引号。
 */
export const CASE_RESULT_PREFIX = "RESULT-CASE: ";

/** 从一行输出里抓 `RESULT-FILE:` 结论 */
export function collectFileVerdict(line: string, verdicts: Map<string, FileVerdict>): void {
    const match = line.replace(/\r$/, "").match(FILE_RESULT_PATTERN);
    if (!match) return;
    verdicts.set(toPosix(match[1]), match[2] as FileVerdict);
}

/** 从一行输出里抓 `RESULT-CASE:` 结论 */
export function collectCaseVerdict(line: string, verdicts: Map<string, CaseVerdict>): void {
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed.startsWith(CASE_RESULT_PREFIX)) return;
    try {
        const payload = JSON.parse(trimmed.slice(CASE_RESULT_PREFIX.length)) as {
            file?: unknown;
            case?: unknown;
            verdict?: unknown;
            title?: unknown;
            detail?: unknown;
        };
        if (typeof payload.file !== "string" || !Number.isInteger(payload.case)) return;
        if (payload.verdict !== "pass" && payload.verdict !== "fail" && payload.verdict !== "error") return;
        verdicts.set(caseKeyOf(toPosix(payload.file), payload.case as number), {
            verdict: payload.verdict,
            title: typeof payload.title === "string" ? payload.title : "断言失败",
            detail: Array.isArray(payload.detail)
                ? payload.detail.filter((item): item is string => typeof item === "string")
                : [],
        });
    } catch {
        // 不是合法的 JSON 就当没这一行：文件级结论照样有效
    }
}

/** 逐用例结论的键：相对路径 + 用例下标 */
export function caseKeyOf(relativePath: string, caseIndex: number): string {
    return `${toPosix(relativePath)}#${caseIndex}`;
}

/** 退出码 → 文件结论 */
export function verdictFromExitCode(code: number | null): FileVerdict {
    if (code === 0) return "pass";
    if (code === 1) return "fail";
    return "error";
}

/** 批量跑兜底：进程整体成功但某个文件没有结论行时，按 pass；否则一律 error */
export function fallbackVerdict(processExitCode: number | null): FileVerdict {
    return processExitCode === 0 ? "pass" : "error";
}

/**
 * 通用话术。只在 runner 没给出逐用例原因时兜底用 —— 正常情况下会直接说「节点 X 没命中」。
 */
export function describeVerdict(verdict: FileVerdict, title: string): VerdictText {
    if (verdict === "fail") {
        return {
            title: "断言失败",
            detail: [
                `${title} 有失败，但这次没拿到具体原因（可能是 node 版本低于 22 导致明细解析失败）`,
                "展开测试输出看红色组名，或查看工作区的 tests/maatools/error_details.json",
            ],
        };
    }
    if (verdict === "error") {
        return {
            title: "没跑起来",
            detail: [
                `${title} 没有被验证到（不是断言失败）`,
                "常见原因：node 版本低于 22（改设置 maaNodeTest.nodePath）、截图一张都不存在、",
                "maatools 配置加载失败、MaaFW 首次下载失败。测试输出里有具体原因。",
            ],
        };
    }
    return {title: "通过", detail: []};
}

/**
 * 文件节点的文案：标题只说「几条用例失败」，展开后逐条列出是哪条用例、什么原因。
 * 只有一条失败时直接把它的标题和详情拿来用，省一层点击。
 */
export function describeFileFailure(
    relativePath: string,
    verdict: FileVerdict,
    knownCases: readonly {info?: CaseVerdict; caseIndex?: number}[],
): VerdictText {
    const failing = knownCases.filter((entry) => entry.info !== undefined && entry.info.verdict !== "pass");

    if (failing.length === 0) return describeVerdict(verdict, relativePath);

    if (failing.length === 1) {
        const entry = failing[0];
        return {
            title: `第 ${formatIndex(entry.caseIndex)} 个用例：${entry.info?.title ?? "失败"}`,
            detail: entry.info?.detail ?? [],
        };
    }

    const detail: string[] = [];
    for (const entry of failing) {
        detail.push(`第 ${formatIndex(entry.caseIndex)} 个用例 · ${entry.info?.title ?? "失败"}`);
        for (const line of entry.info?.detail ?? []) detail.push(`    ${line}`);
    }
    return {title: `${failing.length} 条用例失败`, detail};
}

/**
 * 决定文件节点和各条用例分别标成什么。
 *
 * 关键的一条：**文件「通过」不代表每条用例都被验证过**。声明的某个平台缺截图时，maa-tools 会跳过
 * 那一条用例并当作通过，整个文件也就没有断言失败 —— 但那条用例其实什么也没验证。所以这里不允许
 * 「文件通过 → 子用例全绿」，只要有用例没验证到，文件就标成 errored 并把缺图平台写出来。
 */
export function planFileMarking(
    relativePath: string,
    verdict: FileVerdict,
    cases: readonly {caseIndex?: number; info?: CaseVerdict}[],
): FileMarking {
    const problems = cases.filter((entry) => entry.info !== undefined && entry.info.verdict !== "pass");

    if (verdict === "pass" && problems.length === 0) {
        return {
            file: {verdict: "pass", text: {title: "通过", detail: []}},
            cases: cases.map((entry) => ({
                caseIndex: entry.caseIndex,
                verdict: "pass",
                text: {title: "通过", detail: []},
            })),
        };
    }

    // 文件本身没有断言失败，但有用例没验证到（缺图）或（理论上）有用例失败
    if (verdict === "pass") {
        const hasFailure = problems.some((entry) => entry.info?.verdict === "fail");
        const detail: string[] = [];
        for (const entry of problems) {
            detail.push(`第 ${formatIndex(entry.caseIndex)} 个用例 · ${entry.info?.title ?? "没验证到"}`);
            for (const line of entry.info?.detail ?? []) detail.push(`    ${line}`);
        }
        return {
            file: {
                verdict: hasFailure ? "fail" : "error",
                text: {
                    title: hasFailure ? "有用例失败" : `${problems.length} 条用例没有验证到`,
                    detail,
                },
            },
            cases: cases.map((entry) => markOfCase(entry, "pass")),
        };
    }

    const fileText = describeFileFailure(relativePath, verdict, cases);
    return {
        file: {verdict, text: fileText},
        // 有逐用例信息的按自己的结论标；没被点名的说明它确实通过了；一条信息都没有时跟随文件结论
        cases: cases.map((entry) => markOfCase(entry, problems.length === 0 ? verdict : "pass")),
    };
}

/** 单条用例的标记：有结论就用自己的，没有就用 fallback */
function markOfCase(entry: {caseIndex?: number; info?: CaseVerdict}, fallback: FileVerdict): CaseMark {
    if (entry.info) return {caseIndex: entry.caseIndex, verdict: entry.info.verdict, text: entry.info};
    return {caseIndex: entry.caseIndex, verdict: fallback, text: {title: "通过", detail: []}};
}

/**
 * 拼成测试面板要的 Markdown：第一行是粗体短标题（面板内联显示的就是它），
 * 空一行后是列表项，点开测试结果就能看到完整明细。
 */
export function buildMessageMarkdown(title: string, detail: readonly string[]): string {
    if (detail.length === 0) return `**${title}**`;
    return [
        `**${title}**`,
        "",
        // 明细里以两个以上空格开头的行当作子项（例如文件节点下面再列每条用例的原因）
        ...detail.map((line) => (/^ {2,}/.test(line) ? `  - ${line.trim()}` : `- ${line.trim()}`)),
    ].join("\n");
}

/** 用例下标给人看时从 1 开始；拿不到就写问号 */
function formatIndex(caseIndex: number | undefined): string {
    return caseIndex === undefined ? "?" : String(caseIndex + 1);
}

/** 统一正斜杠，跨平台才能和 runner 的输出对上 */
function toPosix(target: string): string {
    return target.replace(/\\/g, "/");
}
