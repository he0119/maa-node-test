// 用 esbuild 把扩展和 runner 各自打成一个文件，产出 dist/。
//
// 为什么要打包而不是直接发 node_modules：
//   1. vsce 判断「要带哪些生产依赖」靠的是 `npm list`，在 pnpm 的软链接树里必然报一堆
//      missing，根本跑不通；`--no-dependencies` 又不会把依赖打进去，包一装就缺 jsonc-parser。
//   2. 打成一个文件之后 package.json 里没有 dependencies，vsce 不需要解析依赖，包体积也小。
//
// 两个产物：
//   dist/extension.js        扩展入口（CommonJS，vscode 由宿主提供，必须 external）
//   dist/run-single-test.mjs runner 入口（ESM，扩展 spawn 它；也可以在终端里直接跑）
//
// 用法：node scripts/bundle.mjs [--watch]

import {mkdir, rm} from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import * as esbuild from "esbuild";

const ROOT = path.resolve(import.meta.dirname, "..");
const watch = process.argv.includes("--watch");

/** 两个入口共用的设定 */
const common = {
    bundle: true,
    platform: "node",
    target: "node20",
    sourcemap: true,
    // vscode 由扩展宿主注入，不能打进包里
    external: ["vscode"],
    // jsonc-parser 的 umd 版用运行期 require("./impl/xxx") 懒加载，打不进包；优先用 esm 版
    mainFields: [
        "module",
        "main",
    ],
    logLevel: "info",
    absWorkingDir: ROOT,
};

const targets = [
    {
        ...common,
        entryPoints: ["src/extension.ts"],
        outfile: "dist/extension.js",
        format: "cjs",
    },
    {
        ...common,
        entryPoints: ["runner/run-single-test.mjs"],
        outfile: "dist/run-single-test.mjs",
        format: "esm",
    },
];

await rm(path.join(ROOT, "dist"), {recursive: true, force: true});
await mkdir(path.join(ROOT, "dist"), {recursive: true});

if (watch) {
    const contexts = await Promise.all(targets.map((target) => esbuild.context(target)));
    await Promise.all(contexts.map((context) => context.watch()));
    console.log("esbuild 正在监听改动（Ctrl+C 结束）");
} else {
    await Promise.all(targets.map((target) => esbuild.build(target)));
}
