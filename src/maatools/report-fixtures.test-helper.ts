// 由 maa-tools buildTestRunResult 的实际输出生成，覆盖合法未执行占位、部分缺图、全缺图和无匹配。
import type {ResultDocument} from "./protocol";
export const reportFixtures: Record<"partialError" | "partialMissing" | "allMissing" | "empty", ResultDocument> = {
    partialError: {
        schemaVersion: 1,
        groups: [
            {
                name: "same name",
                controller: "Desktop",
                resource: "CN",
                verdict: "pass",
                cases: [
                    {
                        image: "a.png",
                        imagePath: "/images/Desktop/a.png",
                        verdict: "pass",
                        checks: [
                            {
                                node: "Node",
                                expected: "hit",
                                hit: true,
                                detail: null,
                                ok: true,
                            },
                        ],
                        durationMs: 3,
                        origin: {
                            file: "/repo/tests/test_a.json",
                            case: 1,
                        },
                    },
                ],
                durationMs: 3,
            },
            {
                name: "same name",
                controller: "Desktop",
                resource: "CN",
                verdict: "pass",
                cases: [
                    {
                        image: "b.png",
                        imagePath: "/images/Desktop/b.png",
                        verdict: "pass",
                        checks: [
                            {
                                node: "Node",
                                expected: "hit",
                                hit: true,
                                detail: null,
                                ok: true,
                            },
                        ],
                        durationMs: 3,
                        origin: {
                            file: "/repo/tests/test_b.json",
                            case: 2,
                        },
                    },
                ],
                durationMs: 3,
            },
        ],
        files: [
            {
                file: "/repo/tests/test_a.json",
                name: "same name",
                controllers: [
                    "Desktop",
                    "Mobile",
                ],
                resources: [
                    "CN",
                ],
                cases: [
                    {
                        index: 1,
                        name: null,
                        image: "a.png",
                        hits: [
                            "Node",
                        ],
                        start: 0,
                        end: 20,
                        verdict: "error",
                        durationMs: 3,
                        reason: "no-result",
                        platforms: [
                            {
                                controller: "Desktop",
                                resource: "CN",
                                result: {
                                    image: "a.png",
                                    imagePath: "/images/Desktop/a.png",
                                    verdict: "pass",
                                    checks: [
                                        {
                                            node: "Node",
                                            expected: "hit",
                                            hit: true,
                                            detail: null,
                                            ok: true,
                                        },
                                    ],
                                    durationMs: 3,
                                    origin: {
                                        file: "/repo/tests/test_a.json",
                                        case: 1,
                                    },
                                },
                            },
                            {
                                controller: "Mobile",
                                resource: "CN",
                                result: {
                                    image: "a.png",
                                    imagePath: "",
                                    origin: {
                                        file: "/repo/tests/test_a.json",
                                        case: 1,
                                    },
                                    verdict: "error",
                                    checks: [],
                                    durationMs: 0,
                                    error: "no-result",
                                },
                            },
                        ],
                    },
                ],
                selectedCases: [
                    1,
                ],
                verdict: "error",
                reason: "no-result",
            },
            {
                file: "/repo/tests/test_b.json",
                name: "same name",
                controllers: [
                    "Desktop",
                    "Mobile",
                ],
                resources: [
                    "CN",
                ],
                cases: [
                    {
                        index: 2,
                        name: null,
                        image: "b.png",
                        hits: [
                            "Node",
                        ],
                        start: 0,
                        end: 20,
                        verdict: "pass",
                        durationMs: 3,
                        platforms: [
                            {
                                controller: "Desktop",
                                resource: "CN",
                                result: {
                                    image: "b.png",
                                    imagePath: "/images/Desktop/b.png",
                                    verdict: "pass",
                                    checks: [
                                        {
                                            node: "Node",
                                            expected: "hit",
                                            hit: true,
                                            detail: null,
                                            ok: true,
                                        },
                                    ],
                                    durationMs: 3,
                                    origin: {
                                        file: "/repo/tests/test_b.json",
                                        case: 2,
                                    },
                                },
                            },
                        ],
                    },
                ],
                selectedCases: [
                    2,
                ],
                verdict: "pass",
            },
        ],
        durationMs: 10,
        status: "error",
        errorCode: "test-verification-error",
        reason: "no-result",
    },
    partialMissing: {
        schemaVersion: 1,
        groups: [
            {
                name: "same name",
                controller: "Desktop",
                resource: "CN",
                verdict: "pass",
                cases: [
                    {
                        image: "a.png",
                        imagePath: "/images/Desktop/a.png",
                        verdict: "pass",
                        checks: [
                            {
                                node: "Node",
                                expected: "hit",
                                hit: true,
                                detail: null,
                                ok: true,
                            },
                        ],
                        durationMs: 3,
                        origin: {
                            file: "/repo/tests/test_a.json",
                            case: 1,
                        },
                    },
                ],
                durationMs: 3,
            },
            {
                name: "same name",
                controller: "Mobile",
                resource: "CN",
                verdict: "skipped",
                cases: [
                    {
                        image: "a.png",
                        imagePath: "/images/Mobile/a.png",
                        verdict: "skipped",
                        checks: [],
                        durationMs: 0,
                        origin: {
                            file: "/repo/tests/test_a.json",
                            case: 1,
                        },
                    },
                ],
                durationMs: 0,
            },
        ],
        files: [
            {
                file: "/repo/tests/test_a.json",
                name: "same name",
                controllers: [
                    "Desktop",
                    "Mobile",
                ],
                resources: [
                    "CN",
                ],
                cases: [
                    {
                        index: 1,
                        name: null,
                        image: "a.png",
                        hits: [
                            "Node",
                        ],
                        start: 0,
                        end: 20,
                        verdict: "skipped",
                        durationMs: 3,
                        reason: "missing-image",
                        platforms: [
                            {
                                controller: "Desktop",
                                resource: "CN",
                                result: {
                                    image: "a.png",
                                    imagePath: "/images/Desktop/a.png",
                                    verdict: "pass",
                                    checks: [
                                        {
                                            node: "Node",
                                            expected: "hit",
                                            hit: true,
                                            detail: null,
                                            ok: true,
                                        },
                                    ],
                                    durationMs: 3,
                                    origin: {
                                        file: "/repo/tests/test_a.json",
                                        case: 1,
                                    },
                                },
                            },
                            {
                                controller: "Mobile",
                                resource: "CN",
                                result: {
                                    image: "a.png",
                                    imagePath: "/images/Mobile/a.png",
                                    verdict: "skipped",
                                    checks: [],
                                    durationMs: 0,
                                    origin: {
                                        file: "/repo/tests/test_a.json",
                                        case: 1,
                                    },
                                },
                            },
                        ],
                    },
                ],
                selectedCases: [
                    1,
                ],
                verdict: "pass",
                reason: "some-platforms-skipped",
            },
        ],
        durationMs: 10,
        status: "passed",
    },
    allMissing: {
        schemaVersion: 1,
        groups: [
            {
                name: "same name",
                controller: "Desktop",
                resource: "CN",
                verdict: "skipped",
                cases: [
                    {
                        image: "a.png",
                        imagePath: "/images/Desktop/a.png",
                        verdict: "skipped",
                        checks: [],
                        durationMs: 0,
                        origin: {
                            file: "/repo/tests/test_a.json",
                            case: 1,
                        },
                    },
                ],
                durationMs: 0,
            },
        ],
        files: [
            {
                file: "/repo/tests/test_a.json",
                name: "same name",
                controllers: [
                    "Desktop",
                    "Mobile",
                ],
                resources: [
                    "CN",
                ],
                cases: [
                    {
                        index: 1,
                        name: null,
                        image: "a.png",
                        hits: [
                            "Node",
                        ],
                        start: 0,
                        end: 20,
                        verdict: "skipped",
                        durationMs: 0,
                        reason: "missing-image",
                        platforms: [
                            {
                                controller: "Desktop",
                                resource: "CN",
                                result: {
                                    image: "a.png",
                                    imagePath: "/images/Desktop/a.png",
                                    verdict: "skipped",
                                    checks: [],
                                    durationMs: 0,
                                    origin: {
                                        file: "/repo/tests/test_a.json",
                                        case: 1,
                                    },
                                },
                            },
                        ],
                    },
                ],
                selectedCases: [
                    1,
                ],
                verdict: "error",
                reason: "no-tests-verified",
            },
        ],
        durationMs: 10,
        status: "error",
        errorCode: "test-verification-error",
        reason: "no-tests-verified",
    },
    empty: {
        schemaVersion: 1,
        groups: [],
        files: [
            {
                file: "/repo/tests/test_a.json",
                name: "same name",
                controllers: [
                    "Desktop",
                    "Mobile",
                ],
                resources: [
                    "CN",
                ],
                cases: [
                    {
                        index: 1,
                        name: null,
                        image: "a.png",
                        hits: [
                            "Node",
                        ],
                        start: 0,
                        end: 20,
                        verdict: "error",
                        durationMs: 0,
                        reason: "no-tests-matched",
                        platforms: [],
                    },
                ],
                selectedCases: [
                    1,
                ],
                verdict: "error",
                reason: "no-tests-matched",
            },
        ],
        durationMs: 10,
        status: "empty",
        errorCode: "no-tests-matched",
        reason: "没有匹配到测试组，请检查配置、来源和过滤条件",
    },
};
