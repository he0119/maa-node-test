# AGENTS.md

这是一个 VS Code 扩展，服务于 **Maa 节点测试**：基于 `maa-tools` 的节点测试机制（`tests/**/test_*.json` 与测试集截图），适用于任何采用该机制的仓库。默认值（`maatools.config.mts`、`tests/MaaEndTestset`）取自 MaaEnd，均为设置项，可调整。

**范围**：只使用节点测试的输入 —— 测试文件、测试集截图、`maatools.config.mts`。范围内包括运行用例、查看截图、报告失败原因、辅助编写用例；范围外是 Pipeline 链路校验、资源打包、任务运行调试、识别算法实现，这些由各仓库自己的工具负责。

写代码时注意别把 MaaEnd 特有的东西焊死：默认值可以来自它，但路径、控制器名、资源服名都要能从设置或扫描得到（`AGENTS.md` 硬约束里有「不要写死平台名」这条）。

面向使用者的说明在 [README.md](README.md)；改代码前读 [.agents/skills/maa-node-test-dev/SKILL.md](.agents/skills/maa-node-test-dev/SKILL.md)，设计取舍看 [.agents/notes/](.agents/notes/README.md)。

## 常用命令

本项目的构建与测试都在插件目录里跑，不需要动 MaaEnd 仓库：

```bash
pnpm run check        # 类型检查（tsc --noEmit）
pnpm run compile      # 编译到 out/（单测和调试用）
pnpm run bundle       # esbuild 打包到 dist/（发布用，改了 runner 也要重跑）
pnpm run build        # compile + bundle
pnpm test             # src/core 纯函数单测（node --test）
pnpm run test:runner  # runner 的纯函数单测
pnpm run test:all     # build + 两个单测套件
pnpm run package      # 打 VSIX 到 dist/
```

端到端验证（真的跑识别，需要 MaaEnd 仓库装好依赖、MaaFW 已缓存）：

```bash
node runner/run-single-test.mjs --workspace ~/dev/MaaEnd \
  --file tests/Common/Button/test_close_button.json --dry-run
```

格式化与 Markdown 检查沿用 MaaEnd 仓库装好的工具链（保持和主仓库同一套风格，不在这里再配一份）：

```bash
~/dev/MaaEnd/node_modules/.bin/prettier --config ~/dev/MaaEnd/.prettierrc.mjs --write \
  "package.json" "tsconfig.json" ".vscode/*.json" "src/**/*.ts" "runner/**/*.mjs"
~/dev/MaaEnd/node_modules/.bin/markdownlint .   # 规则用本仓库的 .markdownlint.json
```

## 代码地图

| 位置 | 职责 |
| --- | --- |
| `src/extension.ts` | 只做装配：输出面板、两个 provider、四个命令、测试面板 |
| `src/config.ts` | 读三个设置项、认定哪个工作区文件夹是仓库根 |
| `src/runner.ts` | 起 runner 进程、收输出、按退出码提示（CodeLens / 命令走这条） |
| `src/testing.ts` | 测试面板：发现用例、运行顺序、把结论行标记成通过/失败/未运行 |
| `src/providers/` | CodeLens 与 hover 的薄适配层，只做 vscode 类型转换 |
| `src/core/` | 纯函数：解析测试文件、扫截图、拼 hover 文本、拼命令参数、解析结论行与失败文案。**不许 import vscode** |
| `runner/run-single-test.mjs` | 独立 ESM 脚本：跑一批文件或其中一条用例，也可以直接在终端里跑 |
| `runner/lib/` | runner 的纯函数与单测 |

## 硬约束

1. **`src/core/` 不许 import `vscode`**：这一层的价值就是能在普通 Node 里单测，混进 vscode 就废了。
2. **runner 的命令行、`RESULT-FILE` 行与退出码是契约**，扩展和 runner 分别维护，任何一侧改动都要同步：`runner/lib/args.mjs`（参数）、`runner/lib/results.mjs`（`RESULT-FILE` / `RESULT-CASE` 格式与判定）、`src/core/runnerArgs.ts`（拼参数）、`src/core/testResult.ts`（解析结论行与失败文案）、`src/testing.ts`（把结论标记到面板节点），外加 `reference.md` 的契约段（README 只写用法，不放契约）。
3. **不要写死平台名**（`Win32` / `ADB` / `Official_CN`）：平台与资源目录一律从测试集目录扫描得到，新加控制器才不用改代码。
4. **hover 里的图片默认用 HTML `<img width>`，宽度可配**：Markdown 图片语法给不了尺寸，1280×720 会按原样铺开占掉大半个悬浮框。代价是依赖 `MarkdownString.supportHtml`（provider 里已开），所以留了开关：`maaNodeTest.hoverImageWidth` 设 `0` 就回落到 `![](uri)`。「打开原图」链接在任何情况下都要保留。
5. **`.code-workspace` 必须保持纯 JSON**（不带尾逗号），它已在 `.prettierignore` 里，别为了「格式化」把它改坏。
6. **判定语义不能想当然**：`maa-tools` 遇到不存在的截图只打印 `not exists, ignored` 然后跳过，跳过即视为通过 —— 任何新逻辑都不能把「没验证」当成「通过」。
7. **运行时依赖只能进 `dist/`，不能进 `dependencies`**：vsce 在 pnpm 仓库里解析不了生产依赖，包必须自包含。要加运行时依赖就改 `scripts/bundle.mjs` 让它被打进去（同时保持 `dependencies` 为空），否则装到 VS Code 里会 `Cannot find module`。
8. **扩展 spawn 的是 `dist/run-single-test.mjs`**，不是 `runner/run-single-test.mjs`。改了 `runner/**` 之后记得 `pnpm run bundle`（或者挂着 `pnpm run watch:bundle`），否则扩展跑的还是旧代码。

## 调试时窗口的工作区必须是 MaaEnd

插件要读 MaaEnd 的 `maatools.config.mts`、`tests/` 和截图；工作区不对就只能看到空测试面板。三种调试方式见 [README「装（开发态）」](README.md#装开发态)，推荐打开 `maa-node-test.code-workspace`（MaaEnd 主工作区 + 插件源码两个文件夹）。

## 改了东西之后

- 行为、设置项、限制有变化：同步 `README.md`（它面向使用者，只写「怎么用、怎么排错」）；
- 契约、内部机制有变化：同步 `reference.md`（面向改代码的人）；
- 契约或设计有变化：更新对应的 [Agent Note](.agents/notes/README.md)，不要新开一份重复的；
- 发布相关：`dist/` 和 `*.vsix` 不进 git；发版细节见 `reference.md` 的「构建与发布」；
- 提交信息用中文约定式提交（`feat:` / `fix:` / `chore:` / `docs:` / `refactor:`，可带 scope），一次提交讲一件事。
