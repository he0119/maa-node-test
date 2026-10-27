# AGENTS.md

这是一个 VS Code 扩展：在 VS Code 里跑 **Maa 节点测试**（MaaEnd 仓库 `tests/**/test_*.json`），并在悬浮提示里预览各平台截图。

**边界先说清楚**：只做「验证某张截图上哪些节点应该命中」这一件事。不做 Pipeline 校验、不做截图工具、不做任务调试、不碰识别算法本身。想加这类功能之前先确认它真的属于节点测试。

面向使用者的说明在 [README.md](README.md)；改代码前读 [.agents/skills/maa-node-test-dev/SKILL.md](.agents/skills/maa-node-test-dev/SKILL.md)，设计取舍看 [.agents/notes/](.agents/notes/README.md)。

## 常用命令

本项目的构建与测试都在插件目录里跑，不需要动 MaaEnd 仓库：

```bash
pnpm run check        # 类型检查（tsc --noEmit）
pnpm run compile      # 编译到 out/
pnpm test             # src/core 纯函数单测（node --test）
pnpm run test:runner  # runner 的纯函数单测
pnpm run test:all     # 上面三件事
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
| `src/testing.ts` | 测试面板：发现用例、运行顺序、退出码 → 通过/失败/未运行 |
| `src/providers/` | CodeLens 与 hover 的薄适配层，只做 vscode 类型转换 |
| `src/core/` | 纯函数：解析测试文件、扫截图、拼 hover 文本、拼命令参数。**不许 import vscode** |
| `runner/run-single-test.mjs` | 独立 ESM 脚本：只跑一个文件或一条用例，也可以直接在终端里跑 |
| `runner/lib/` | runner 的纯函数与单测 |

## 硬约束

1. **`src/core/` 不许 import `vscode`**：这一层的价值就是能在普通 Node 里单测，混进 vscode 就废了。
2. **runner 的命令行、`RESULT-FILE` 行与退出码是契约**，扩展和 runner 分别维护，任何一侧改动都要同步：`runner/lib/args.mjs`（参数）、`runner/lib/results.mjs`（`RESULT-FILE` 格式与判定）、`src/core/runnerArgs.ts`（拼参数）、`src/testing.ts`（解析 `RESULT-FILE` 与退出码映射），外加 README 的表格和 `reference.md`。
3. **不要写死平台名**（`Win32` / `ADB` / `Official_CN`）：平台与资源目录一律从测试集目录扫描得到，新加控制器才不用改代码。
4. **hover 里的图片用 Markdown 图片语法**（`![](file:///…)`），不用 HTML `<img>`：Markdown 语法在悬浮里稳定可见，HTML 会被过滤规则牵着走。
5. **`.code-workspace` 必须保持纯 JSON**（不带尾逗号），它已在 `.prettierignore` 里，别为了「格式化」把它改坏。
6. **判定语义不能想当然**：`maa-tools` 遇到不存在的截图只打印 `not exists, ignored` 然后跳过，跳过即视为通过 —— 任何新逻辑都不能把「没验证」当成「通过」。

## 调试时窗口的工作区必须是 MaaEnd

插件要读 MaaEnd 的 `maatools.config.mts`、`tests/` 和截图；工作区不对就只能看到空测试面板。三种调试方式见 [README「安装（开发态）」](README.md#安装开发态)，推荐打开 `maa-node-test.code-workspace`（MaaEnd 主工作区 + 插件源码两个文件夹）。

## 改了东西之后

- 行为、设置项、限制有变化：同步 `README.md`；
- 契约或设计有变化：更新对应的 [Agent Note](.agents/notes/README.md)，不要新开一份重复的；
- 提交信息用中文约定式提交（`feat:` / `fix:` / `chore:` / `docs:` / `refactor:`，可带 scope），一次提交讲一件事。
