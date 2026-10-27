---
name: maa-node-test-dev
description: 改这个 Maa 节点测试 VS Code 插件时使用。适用于改动 src/ 下的 CodeLens、悬浮预览、测试面板，改动 runner/ 下的单文件/单用例运行逻辑，调整事件与退出码契约，或排查「跑出来的结果不对」「面板里没东西」的场景。
---

# Maa 节点测试插件开发

先读 [README.md](../../../README.md)（面向使用者：功能、设置项、排错）和 [reference.md](reference.md)（面向改代码的人：每个文件的职责、runner 命令行契约、退出码映射、失败结论怎么产生、hover 文本格式）。本文件只讲「改东西时该动哪里、别踩什么」。

## 数据流

```text
                ┌────────────── 测试文件 tests/**/test_*.json
                │
   CodeLens ────┤  src/core/document.ts  解析 configs / cases / offset
   悬浮预览 ────┤  src/core/testset.ts   扫测试集，按平台找同名截图
   测试面板 ────┘
                │
   跑测试 ──────► src/runner.ts  startTestProcess()
                │      └─ spawn node runner/run-single-test.mjs --workspace … --file … [--case N]
                └──► runner/run-single-test.mjs
                         loadConfig(maatools.config.mts) → 包装 cfg.test.cases 过滤 → 截图预检 → runTest
                         退出码 0/1/2/3 + 末行 RESULT: pass|fail|error|empty
```

三条入口共用同一次「起进程 + 读退出码」，别另写一套 spawn。

## 改什么 → 动哪里

| 想改的东西 | 主要文件 | 连带要改 |
| --- | --- | --- |
| 悬浮里显示的文案/布局 | `src/core/hover.ts` + `src/core/hover.test.ts` | `reference.md` 里的示例 |
| 悬浮命中范围（哪些字段触发） | `src/core/document.ts` 的 `findImageFieldAt` | 对应单测 |
| CodeLens 文案/条数 | `src/core/lens.ts` | `src/providers/codeLens.ts` 只在需要换命令参数时动 |
| 测试面板的树结构 | `src/core/testExplorer.ts`（纯函数）+ `src/testing.ts`（vscode 适配） | 单测 |
| 测试面板运行顺序/取消/排除 | `src/testing.ts` 的 `collectTargets` 与 `runTarget` | — |
| 过滤规则（跑哪些组/用例） | `runner/lib/filter.mjs` + `runner/lib/case-key.mjs` | `runner/lib/filter.test.mjs` |
| 新增 runner 参数 | `runner/lib/args.mjs` → `src/core/runnerArgs.ts` → `src/testing.ts` / `src/runner.ts` | `reference.md` 的命令行契约段 |
| 退出码含义 | `runner/lib/report.mjs` → `src/core/testResult.ts` `verdictFromExitCode()` → `src/testing.ts` 标记 | `reference.md` 的退出码表 |
| 新增设置项 | `package.json` 的 `contributes.configuration` + `src/config.ts` | README 设置项表（面向用户） |
| 失败信息文案 | `runner/lib/results.mjs` `classifyErrorEntry()` / `formatCaseFailure()` → `src/core/testResult.ts` 的 Markdown 拼装 | `reference.md` 的逐用例结论段 |

## 验证步骤（按顺序做，别跳过）

1. `pnpm run check` —— 类型必须零报错。
2. `pnpm test` + `pnpm run test:runner` —— 纯函数单测。改了 `src/core/` 或 `runner/lib/` 就要补/改用例。
3. 过滤与截图路径的改动，用 dry-run 看真实结果（几秒，不加载 MaaFW）：

   ```bash
   node runner/run-single-test.mjs --workspace ~/dev/MaaEnd \
     --file tests/Common/Button/test_close_button.json --dry-run
   ```

   期望：匹配到 `Win32-官服`、`ADB-官服` 两组、各 3 条用例、6 张截图 ✓。
4. 真的跑一次（3～15 秒）：换一个可用例文件加 `--case 0`，确认末行 `RESULT: pass`、退出码 0。
5. 改到 `src/testing.ts` / `src/runner.ts` / `src/extension.ts` 这些 vscode 相关代码时，无界面环境里可以临时写一个假 `vscode` 模块验证接线：用 `Module._resolveFilename` 把 `vscode` 指到假模块，加载 `out/extension.js`、调 `activate({ extensionPath })`，再手动触发 run profile handler 与 provider。验完删掉临时文件，不要留在仓库里。
6. 收尾：跑一次格式化（命令见根 `AGENTS.md`），Markdown 用 markdownlint 检查。

## 常见坑（都是踩过的）

- **Node 24 的 `node --test <目录>` 不展开目录**：把目录当成一个测试文件解析会直接报错。脚本里统一用显式 glob：`node --test "out/core/*.test.js"`。
- **块注释里别写 `tests/**` 这种 glob**：`**/` 里的 `*/` 会提前结束注释，后面整段被当成代码，报一堆「Invalid character」。要写就写「tests 目录下所有 test_*.json」。
- **`maa-tools` 的假阳性**：截图不存在时它只 `not exists, ignored` 然后跳过，跳过＝通过。任何「批量跑」路径都要先做截图预检。
- **整文件运行只能给整体结论**：`runTest` 返回一个布尔值，说不出第几条失败。测试面板里整文件跑完只能把子用例统一标记，失败信息里提示用户展开后单跑以定位。
- **不要为了省事写死平台**：测试集目录按 `<控制器>/<资源服>/` 放图，平台名从目录扫出来，不写常量表。
- **`.code-workspace` 不能被 prettier 加尾逗号**：VS Code 之外的工具按纯 JSON 读它，所以它在 `.prettierignore` 里。
- **hover 每次触发都会扫目录 + 读 PNG 头**：目前几十毫秒，图上到几千张再考虑加缓存，别提前优化。
- **测试面板读的是磁盘**：文件改了没保存，面板和运行看到的都还是旧内容。

## 提交

中文约定式提交，一次提交一件事；改到契约或设计取舍时，同步 `.agents/notes/` 里对应的记录（没有就新建一份，别新开重复的）。
