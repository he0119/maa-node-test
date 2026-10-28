// 校验实时事件的先后关系并保存完成事实；最终报告必须与已发布的事实一致。

import {isDeepStrictEqual} from "node:util";

import {
    ResultFormatError,
    validateTestRunEvent,
    type CaseOrigin,
    type ResultDocument,
    type ResultSelection,
    type RunFileCaseResult,
    type RunCaseResult,
    type RunFileResult,
    type TestRunEvent,
} from "./protocol";
import {adaptResultFiles, type CaseInfo} from "./results";
import {pathKey} from "./paths";

function originKey(origin: CaseOrigin): string {
    return `${pathKey(origin.file)}#${origin.case}`;
}

function requireSame(condition: boolean, message: string): void {
    if (!condition) throw new ResultFormatError(message);
}

function metadata(file: RunFileResult) {
    return {
        file: pathKey(file.file),
        name: file.name,
        error: file.error,
        controllers: file.controllers,
        resources: file.resources,
    };
}

/** 只规范明确的路径字段；用例名、断言明细等内容仍须完全相同。 */
function platformFacts(result: RunCaseResult) {
    return {
        ...result,
        imagePath: pathKey(result.imagePath),
        ...(result.origin ? {origin: {...result.origin, file: pathKey(result.origin.file)}} : {}),
    };
}

function sameCase(left: RunFileCaseResult, right: RunFileCaseResult): boolean {
    const {platforms: leftPlatforms, ...leftCase} = left;
    const {platforms: rightPlatforms, ...rightCase} = right;
    if (!isDeepStrictEqual(leftCase, rightCase) || leftPlatforms.length !== rightPlatforms.length) return false;
    const remaining = [...rightPlatforms];
    for (const platform of leftPlatforms) {
        const index = remaining.findIndex((item) =>
            isDeepStrictEqual(
                {...item, result: platformFacts(item.result)},
                {...platform, result: platformFacts(platform.result)},
            ),
        );
        if (index < 0) return false;
        remaining.splice(index, 1);
    }
    return true;
}

function sameFile(left: RunFileResult, right: RunFileResult): boolean {
    return (
        isDeepStrictEqual(metadata(left), metadata(right)) &&
        left.verdict === right.verdict &&
        left.reason === right.reason &&
        isDeepStrictEqual(
            [...left.selectedCases].sort((a, b) => a - b),
            [...right.selectedCases].sort((a, b) => a - b),
        ) &&
        left.cases.length === right.cases.length &&
        left.cases.every((testCase) => {
            const other = right.cases.find((item) => item.index === testCase.index);
            return other !== undefined && sameCase(testCase, other);
        })
    );
}

export class RunProgress {
    private readonly started = new Map<string, CaseOrigin>();
    private readonly completedCases = new Map<string, {origin: CaseOrigin; result: RunFileCaseResult}>();
    private readonly completedFiles = new Map<string, RunFileResult>();
    private readonly fileMetadata = new Map<string, ReturnType<typeof metadata>>();
    private readonly fileDocuments = new Map<string, ResultDocument>();
    private readonly caseInfo = new Map<string, CaseInfo>();

    constructor(private readonly selection: ResultSelection) {}

    /** 重复但内容相同的消息不再发布，避免面板重新 started 或重复完成。 */
    accept(message: unknown): TestRunEvent | null {
        const event = structuredClone(validateTestRunEvent(message, this.selection));
        if (event.type === "case-started") {
            const key = originKey(event.origin);
            if (this.started.has(key)) return null;
            requireSame(
                !this.completedCases.has(key) && !this.completedFiles.has(pathKey(event.origin.file)),
                `已经完成的用例又收到开始消息：${key}`,
            );
            this.started.set(key, event.origin);
            return structuredClone(event);
        }
        const file = event.result.files[0];
        const filePath = pathKey(file.file);
        const previousMetadata = this.fileMetadata.get(filePath);
        requireSame(
            !previousMetadata || isDeepStrictEqual(previousMetadata, metadata(file)),
            `进度消息的文件元数据发生变化：${filePath}`,
        );
        if (event.type === "case-result") {
            const testCase = file.cases[0];
            const key = originKey(event.origin);
            const completed = this.completedCases.get(key);
            if (completed) {
                requireSame(sameCase(completed.result, testCase), `重复用例结果互相矛盾：${key}`);
                return null;
            }
            const completedFile = this.completedFiles.get(filePath);
            if (completedFile) {
                const known = completedFile.cases.find((item) => item.index === event.origin.case);
                requireSame(known !== undefined && sameCase(known, testCase), `用例结果与已完成文件矛盾：${key}`);
            }
        } else {
            const completed = this.completedFiles.get(filePath);
            if (completed) {
                requireSame(sameFile(completed, file), `重复文件结果互相矛盾：${filePath}`);
                return null;
            }
            for (const origin of this.started.values()) {
                if (pathKey(origin.file) === filePath)
                    requireSame(
                        file.selectedCases.includes(origin.case),
                        `文件结果遗漏已经开始的用例：${originKey(origin)}`,
                    );
            }
            for (const testCase of file.cases) {
                const key = originKey({file: file.file, case: testCase.index});
                const completedCase = this.completedCases.get(key);
                requireSame(
                    !completedCase || sameCase(completedCase.result, testCase),
                    `文件结果与已完成用例矛盾：${key}`,
                );
            }
            for (const [
                key,
                completedCase,
            ] of this.completedCases) {
                if (pathKey(completedCase.origin.file) === filePath)
                    requireSame(
                        file.selectedCases.includes(completedCase.origin.case),
                        `文件结果遗漏已完成用例：${key}`,
                    );
            }
        }
        this.fileMetadata.set(filePath, metadata(file));
        const adapted = adaptResultFiles(event.result, this.selection.workspaceRoot);
        for (const [
            key,
            info,
        ] of adapted.caseResults)
            this.caseInfo.set(key, info);
        for (const testCase of file.cases) {
            const origin = {file: file.file, case: testCase.index};
            this.completedCases.set(originKey(origin), {origin, result: testCase});
        }
        if (event.type === "file-result") {
            this.completedFiles.set(filePath, file);
            this.fileDocuments.set(filePath, event.result);
        }
        // 回调拿到独立副本，调用方修改显示数据不会改变后续对账依据。
        return structuredClone(event);
    }

    /** 最终报告已通过 validateResultDocument；只比较对应范围，忽略快照的整批状态与墙钟时间。 */
    checkFinal(result: ResultDocument): void {
        const files = new Map(
            result.files.map((file) => [
                pathKey(file.file),
                file,
            ]),
        );
        for (const origin of this.started.values()) {
            requireSame(
                files.get(pathKey(origin.file))?.selectedCases.includes(origin.case) === true,
                `最终报告遗漏已经开始的用例：${originKey(origin)}`,
            );
        }
        for (const [
            filePath,
            previous,
        ] of this.fileMetadata) {
            const file = files.get(filePath);
            requireSame(
                file !== undefined && isDeepStrictEqual(previous, metadata(file)),
                `最终报告的文件元数据与进度不一致：${filePath}`,
            );
        }
        for (const [
            key,
            completed,
        ] of this.completedCases) {
            const matching = files
                .get(pathKey(completed.origin.file))
                ?.cases.find((item) => item.index === completed.origin.case);
            requireSame(
                matching !== undefined && sameCase(completed.result, matching),
                `最终报告与已完成用例结果不一致：${key}`,
            );
        }
        for (const [
            filePath,
            completed,
        ] of this.completedFiles) {
            const file = files.get(filePath);
            requireSame(file !== undefined && sameFile(completed, file), `最终报告与已完成文件结果不一致：${filePath}`);
        }
    }

    /** 取消或进程异常时只交回已校验的完成事实；单条快照不表示整个文件完成。 */
    partial(): ReturnType<typeof adaptResultFiles> {
        const partial = adaptResultFiles(
            {schemaVersion: 1, status: "error", groups: [], files: [], durationMs: 0},
            this.selection.workspaceRoot,
        );
        for (const document of this.fileDocuments.values()) {
            const completed = adaptResultFiles(document, this.selection.workspaceRoot);
            partial.entries.push(...completed.entries);
            for (const [
                key,
                value,
            ] of completed.fileResults)
                partial.fileResults.set(key, value);
            for (const [
                key,
                value,
            ] of completed.counts)
                partial.counts.set(key, value);
            for (const [
                key,
                value,
            ] of completed.fileReasons)
                partial.fileReasons.set(key, value);
        }
        for (const [
            key,
            value,
        ] of this.caseInfo)
            partial.caseResults.set(key, structuredClone(value));
        return partial;
    }
}
