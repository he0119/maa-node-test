import {strict as assert} from "node:assert";
import {test} from "node:test";

import {fixtureResult, platformResult} from "./fixtures.test-helper";
import {
    renderAllMissingNote,
    renderCaseSummaries,
    renderCoverage,
    renderFileResults,
    renderMissingWarnings,
} from "./render";
import {adaptResultFiles} from "./results";

test("日志使用上游原始索引，错误和缺图分别列出，不显示通过用例", () => {
    const result = fixtureResult();
    const file = result.files[0];
    file.cases[0].verdict = "fail";
    file.cases[0].platforms[0].result = platformResult(file.file, 1, "Desktop", "fail");
    file.cases[1].verdict = "skipped";
    file.cases[1].platforms[0].result = platformResult(file.file, 3, "Desktop", "skipped");
    const maps = adaptResultFiles(result, "/repo");
    const summaries = renderCaseSummaries(maps.entries, maps.caseResults);
    assert.match(summaries.failures.join("\n"), /第 2 个用例/);
    assert.match(summaries.skipped.join("\n"), /第 4 个用例/);
    assert.match(renderCoverage(maps.entries).join("\n"), /Desktop-CN：2 张截图，缺 1 张/);
});

test("缺图说明列实际路径和配置项，不把仓库根当截图根", () => {
    assert.deepEqual(renderMissingWarnings([]), []);
    const missing = [{path: "/actual/screenshots/a.png"}];
    const note = renderAllMissingNote(missing).join("\n");
    assert.match(note, /actual\/screenshots/);
    assert.match(note, /casesCwd、imageRoot 和 image/);
    assert.doesNotMatch(note, /截图根目录是/);
    assert.doesNotMatch(renderMissingWarnings(missing).join("\n"), /视为通过/);
});

test("逐文件显示上游原因，缺文件Map不显示通过", () => {
    const maps = adaptResultFiles(fixtureResult(), "/repo");
    maps.entries[0].reason = "未完成验证";
    assert.match(renderFileResults(maps.entries, new Map()).join("\n"), /！ tests\/test_a.json：未完成验证/);
});
