# Agent Note: 插件独立成仓，调试时窗口工作区固定为 MaaEnd

Status: implemented

## Problem

两件事必须一开始就定下来，否则后面每加一个功能都要返工：

1. **插件代码放哪。** 它是 MaaEnd 节点测试的配套工具，第一版就写在 MaaEnd 仓库的 `dev/` 里；但 MaaEnd 的 CI 只为 Pipeline、资源、Go/C++ Agent 服务，多一个需要 `tsc` 构建、带 `node_modules` 的 VS Code 扩展，等于给主仓库平白加一套构建产物和依赖升级负担。
2. **调试时哪个窗口跑插件。** 插件的一切能力都要读 MaaEnd 的 `maatools.config.mts`、`tests/` 和截图。用插件目录当工作区，测试面板永远是空的，而第一次用的人很容易把「插件开出来了」当成「调试配好了」。

## Decision

- 插件独立成一个仓库 `~/dev/maa-node-test`，与 MaaEnd 仓库**平级**，不往里加任何文件；对 MaaEnd 的假设只有三条：根上有 `maatools.config.mts`、截图在 `tests/MaaEndTestset` 下按 `<控制器>/<资源服>` 分目录、测试文件叫 `tests/**/test_*.json`。
- 跑插件那个窗口的**工作区必须是 MaaEnd**。提供三种调试方式，首选多根工作区文件 `maa-node-test.code-workspace`（`MaaEnd` 排第一当主工作区 + 插件源码第二个文件夹），它带 `compile` 前置任务，按 `F5` 就直接得到「工作区是 MaaEnd、插件已加载」的调试窗口。
- 另外两条路都保留：只开插件目录按 `F5`（`.vscode/launch.json` 里末位参数固定传 `../MaaEnd`）；或在 MaaEnd 窗口里加一段本地 launch 片段（只做本机配置，不进仓库）。
- 依赖策略同理：**用 MaaEnd 那份 `@nekosu/maa-tools`，不自己装一份**。插件加载它时优先走 `<workspace>/node_modules/@nekosu/maa-tools/dist/index.mjs`，按包名解析只作兜底；每次运行把实际版本打进日志。

## Alternatives considered

**放在 MaaEnd 仓库的 `dev/maa-node-test/`。** 起初就是这么放的（`dev/` 还是为此新建的）。问题在于：主仓库要为一个开发工具承受构建产物、依赖锁文件、格式化/检查的连带影响，而这个工具只有少数维护者用；插件本身还在快速变化，放在主仓库里既不方便单独发版，也不方便单独迁移。

**作为 MaaEnd 的 pnpm workspace 成员。** 比直接塞进目录好一点（依赖能复用），但会把插件依赖写进主仓库的 `pnpm-lock.yaml`，并让主仓库的 `format:check` 之类开始扫插件代码；一处风格差异就会让主仓库 CI 变红，而这份红是「开发工具」造成的，语义上很别扭。

**让插件自动向上级目录找 `maatools.config.mts` 来定位仓库。** 能省掉一个设置项，但在多根工作区、monorepo、软链接目录下行为不直观：用户看到的是「插件莫名其妙连到了另一个仓库」。现在的做法是「优先选含 `configPath` 的工作区文件夹，否则用第一个」，规则一句话能说清，出错时提示也具体（「先把 MaaEnd 仓库作为工作区打开」）。

**只支持一种调试方式（插件目录 + 传参）。** 功能上够用，但源码和被测仓库分处两个窗口，改 hover 这种「必须在测试文件里看效果」的功能时来回切换很烦。多根工作区文件让源码和测试文件在同一个窗口里，而工作区根仍是 MaaEnd。

## Consequences

- MaaEnd 仓库零侵入：`git status` 永远是干净的，插件的改动不会以任何形式出现在主仓库的 PR 里；
- 代价是路径约定固定：插件目录默认在 `~/dev/maa-node-test`、仓库在 `~/dev/MaaEnd`，换机器要改 `.code-workspace` / `launch.json` 里的路径（已尽量用 `${userHome}` / `${workspaceFolder}` 表达）；
- 依赖只自带「构建期/纯工具」的那几个（`jsonc-parser`、`typescript`、`@types/*`）。**`@nekosu/maa-tools` 故意不声明依赖**：运行时优先加载 `<workspace>/node_modules` 里那份，包名解析只作兜底，并在日志里打出实际版本 —— 理由见下一条；
- 代价是 MaaEnd 那份依赖没装好时插件跑不起来，这个前提写进了 README 的前置条件；换来的是「插件跑出来的结果」和「CI 跑出来的结果」用的是同一套 maa-tools 与 MaaFW 解析逻辑，不会出现两边结论不一致却查不出原因的情况；
- 格式化与 Markdown 检查沿用 MaaEnd 仓库装好的 prettier / markdownlint，避免两处配置漂移；`maa-node-test.code-workspace` 因为要当纯 JSON 读，被排除在 prettier 之外。
