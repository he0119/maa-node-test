// 用 esbuild 把扩展打成一个文件，产出 dist/extension.js。
//
// 为什么要打包而不是直接发 node_modules：
//   1. vsce 判断「要带哪些生产依赖」靠的是 `npm list`，在 pnpm 的软链接树里必然报一堆
//      missing，根本跑不通；`--no-dependencies` 又不会把依赖打进去，包一装就缺 jsonc-parser。
//   2. 打成一个文件之后 package.json 里没有 dependencies，vsce 不需要解析依赖，包体积也小。
//
// 扩展运行时直接 spawn 被测试仓库那份 maa-tools 命令行，不再自带 runner 脚本，所以只有一个产物。
//
// 用法：node scripts/bundle.mjs [--watch]

import {mkdir, rm} from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import * as esbuild from "esbuild";

const ROOT = path.resolve(import.meta.dirname, "..");
const watch = process.argv.includes("--watch");

/**
 * 入口设定：CommonJS，vscode 由宿主提供必须 external。
 * jsonc-parser 的 umd 版用运行期 require("./impl/xxx") 懒加载，打不进包；优先用 esm 版。
 */
const target = {
    bundle: true,
    platform: "node",
    target: "node20",
    sourcemap: true,
    external: ["vscode"],
    mainFields: [
        "module",
        "main",
    ],
    logLevel: "info",
    absWorkingDir: ROOT,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    format: "cjs",
};

await rm(path.join(ROOT, "dist"), {recursive: true, force: true});
await mkdir(path.join(ROOT, "dist"), {recursive: true});

if (watch) {
    const context = await esbuild.context(target);
    await context.watch();
    console.log("esbuild 正在监听改动（Ctrl+C 结束）");
} else {
    await esbuild.build(target);
}
