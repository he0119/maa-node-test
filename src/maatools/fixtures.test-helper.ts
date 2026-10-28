import type {ResultDocument, RunCaseResult, RunFileCaseResult, RunFileResult} from "./protocol";

export function platformResult(
    file: string,
    index: number,
    controller = "Desktop",
    verdict: RunCaseResult["verdict"] = "pass",
): RunCaseResult {
    return {
        image: `case-${index}.png`,
        imagePath: `/images/${controller}/case-${index}.png`,
        verdict,
        checks:
            verdict === "skipped"
                ? []
                : [
                      {
                          node: "Node",
                          expected: "hit",
                          hit: verdict === "pass",
                          detail: null,
                          ok: verdict === "pass",
                          ...(verdict === "fail" ? {reason: "should-hit"} : {}),
                      },
                  ],
        durationMs: verdict === "skipped" ? 0 : 3,
        origin: {file, case: index},
    };
}

export function fileCase(file: string, index: number, verdict: RunCaseResult["verdict"] = "pass"): RunFileCaseResult {
    const result = platformResult(file, index, "Desktop", verdict);
    return {
        index,
        name: `用例 ${index}`,
        image: result.image,
        hits: ["Node"],
        start: index * 20,
        end: index * 20 + 10,
        verdict,
        durationMs: result.durationMs,
        platforms: [{controller: "Desktop", resource: "CN", result}],
    };
}

export function fixtureResult(
    workspace = "/repo",
    indices = [
        1,
        3,
    ],
): ResultDocument {
    const file = `${workspace}/tests/test_a.json`;
    const cases = indices.map((index) => fileCase(file, index));
    const metadata: RunFileResult = {
        file,
        name: "same name",
        controllers: ["Desktop"],
        resources: ["CN"],
        selectedCases: [...indices],
        verdict: "pass",
        cases,
    };
    return {
        schemaVersion: 1,
        status: "passed",
        durationMs: 10,
        files: [metadata],
        groups: [
            {
                name: "same name",
                controller: "Desktop",
                resource: "CN",
                verdict: "pass",
                durationMs: 6,
                cases: cases.map((item) => item.platforms[0].result),
            },
        ],
    };
}
