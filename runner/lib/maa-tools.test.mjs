import {strict as assert} from "node:assert";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {test} from "node:test";
import {describeMaaToolsSource, importMaaTools, readMaaToolsVersion, workspaceMaaToolsEntry} from "./maa-tools.mjs";

const WORKSPACE = path.join(path.sep, "repo");

test("仓库里的入口路径 = <workspace>/node_modules/@nekosu/maa-tools/dist/index.mjs", () => {
    assert.equal(
        workspaceMaaToolsEntry(WORKSPACE),
        path.join(path.sep, "repo", "node_modules", "@nekosu", "maa-tools", "dist", "index.mjs"),
    );
});

test("读版本号：正常 package.json 返回版本，缺失或坏 JSON 返回 null", () => {
    const root = mkdtempSync(path.join(tmpdir(), "maa-node-test-maa-tools-"));
    try {
        const entry = path.join(root, "node_modules", "@nekosu", "maa-tools", "dist", "index.mjs");
        mkdirSync(path.dirname(entry), {recursive: true});
        const packageJson = path.join(root, "node_modules", "@nekosu", "maa-tools", "package.json");

        writeFileSync(packageJson, JSON.stringify({name: "@nekosu/maa-tools", version: "1.1.2"}));
        assert.equal(readMaaToolsVersion(entry), "1.1.2");

        writeFileSync(packageJson, "{ 坏掉的 json");
        assert.equal(readMaaToolsVersion(entry), null);

        assert.equal(readMaaToolsVersion(path.join(root, "不存在", "dist", "index.mjs")), null);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test("日志描述：仓库副本写相对路径，包名解析要写明不是仓库那份", () => {
    const inWorkspace = describeMaaToolsSource(
        {
            kind: "workspace",
            path: path.join(WORKSPACE, "node_modules", "@nekosu", "maa-tools", "dist", "index.mjs"),
            version: "1.1.2",
        },
        WORKSPACE,
    );
    assert.match(inWorkspace, /1\.1\.2/);
    assert.match(inWorkspace, /仓库里的副本：node_modules\/@nekosu\/maa-tools\/dist\/index\.mjs/);

    const byPackage = describeMaaToolsSource({kind: "package", path: null, version: null}, WORKSPACE);
    assert.match(byPackage, /版本未知/);
    assert.match(byPackage, /不是仓库里的副本/);
});

test("优先加载仓库里的副本，并把版本一并报出来", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "maa-node-test-workspace-"));
    try {
        const packageDir = path.join(workspace, "node_modules", "@nekosu", "maa-tools");
        mkdirSync(path.join(packageDir, "dist"), {recursive: true});
        writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({version: "9.9.9"}));
        writeFileSync(
            path.join(packageDir, "dist", "index.mjs"),
            "export const sentinel = 'from-workspace'; export function loadConfig() {} export function runTest() {}",
        );

        const {module, source} = await importMaaTools(workspace);
        assert.equal(module.sentinel, "from-workspace");
        assert.equal(source.kind, "workspace");
        assert.equal(source.version, "9.9.9");
        assert.equal(typeof module.loadConfig, "function");
        assert.equal(typeof module.runTest, "function");
    } finally {
        rmSync(workspace, {recursive: true, force: true});
    }
});
