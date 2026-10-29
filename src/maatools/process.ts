import {spawn} from "node:child_process";

import {ResultFormatError} from "./protocol";

export interface ChildRun {
    parsed: unknown;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal?: NodeJS.Signals | null;
    spawnError?: unknown;
    streamError?: unknown;
    incompleteLine?: boolean;
}

/** 标准 close 保证管道已排空；收集读单份 JSON，运行按完整行交给消费者。 */
export function runChild(
    cwd: string,
    nodePath: string,
    args: readonly string[],
    onOutput: (chunk: string) => void,
    register?: (child: ReturnType<typeof spawn>) => void,
    onLine?: (line: string) => void,
): Promise<ChildRun> {
    return new Promise((resolve) => {
        let child: ReturnType<typeof spawn>;
        try {
            child = spawn(nodePath, [...args], {
                cwd,
                stdio: [
                    "ignore",
                    "pipe",
                    "pipe",
                ],
            });
        } catch (error) {
            resolve({parsed: null, stdout: "", stderr: "", exitCode: null, spawnError: error});
            return;
        }
        register?.(child);
        let stdout = "";
        let stderr = "";
        let pending = "";
        let streamError: unknown;
        let spawnError: unknown;
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
            stdout += chunk;
            if (!onLine || streamError) return;
            pending += chunk;
            try {
                let newline: number;
                while ((newline = pending.indexOf("\n")) >= 0) {
                    const line = pending.slice(0, newline);
                    pending = pending.slice(newline + 1);
                    onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
                }
            } catch (error) {
                streamError = error instanceof Error ? error : new ResultFormatError("无法读取标准输出记录");
                child.kill();
            }
        });
        child.stderr?.on("data", (chunk: string) => {
            stderr += chunk;
            onOutput(chunk);
        });
        child.on("error", (error) => {
            spawnError = error;
        });
        child.once("close", (exitCode, signal) => {
            let parsed: unknown = null;
            if (!onLine) {
                try {
                    parsed = JSON.parse(stdout);
                } catch {
                    /* 由收集调用方解释格式错误。 */
                }
            }
            resolve({
                parsed,
                stdout,
                stderr,
                exitCode,
                signal,
                spawnError,
                streamError,
                incompleteLine: pending.length > 0,
            });
        });
    });
}
