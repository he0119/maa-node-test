# Maa 节点测试（VS Code 扩展）

在 VS Code 里跑 Maa 节点测试的一个小插件，只做一件事：**验证某张截图上哪些节点应该命中**。

它把 MaaEnd 仓库里 `tests` 目录下的节点测试（`test_*.json`）接到 VS Code 上：

- 在**测试面板（Test Explorer）**里按文件、按用例列出，可以只跑一条用例；
- 在测试文件里给每个用例加 **CodeLens**（「运行此用例」/「运行整个文件」）；
- 把鼠标放在用例的 `image` 字段上，**悬浮预览各平台（Win32 / ADB / CloudADB …）的同名截图**。

## 它解决的问题

MaaEnd 的节点测试入口是 `pnpm test`（`maa-tools test`），而这个命令只能全量跑：几十个测试文件、上百条用例一起过一遍。改完一个识别节点只想验证一条用例时，这个反馈太慢。

另外截图是按平台分目录放的（`tests/MaaEndTestset/<控制器>/<资源服>/<图片>`），光看 `"image": "武陵_拍照模式_画面设置.png"` 这个字段，看不出 Win32 和 ADB 上的画面到底差在哪、图有没有放对平台。

这个插件就是补这两件事：**点一下就跑一条**，**鼠标一放就看见图**。

## 前置条件

- Node **22 及以上**（`maa-tools` 与仓库脚本依赖 Node 22 的 API）；
- pnpm；
- 一个装好依赖的 MaaEnd 仓库（工作区里要有 `maatools.config.mts`，并且已经跑过 `pnpm install`）；
- VS Code **1.85 及以上**。

插件本身不需要修改 MaaEnd 仓库，也不需要往仓库里加任何文件。

## 安装（开发态）

```bash
cd ~/dev/maa-node-test
pnpm install
pnpm run compile
```

调试的关键点：**运行插件的那个窗口，工作区必须是 MaaEnd 仓库**。插件的一切能力都要读 MaaEnd 的 `maatools.config.mts`、`tests/` 和截图，工作区不对就只能看到空面板。下面三种方式都能做到，按习惯挑一个。

### 方式一（推荐）：用多根工作区文件，MaaEnd 当主工作区

把 `maa-node-test.code-workspace` 拖进 VS Code（或 `code ~/dev/maa-node-test/maa-node-test.code-workspace`）。它同时打开两个文件夹：

- `MaaEnd`（排第一个，就是主工作区）—— 测试文件、截图、Pipeline 都在这里；
- `maa-node-test` —— 插件源码在这里，改代码、打断点都在这个文件夹里。

按 `F5` 会先自动编译，再起一个**工作区是 MaaEnd** 的调试窗口，插件已经装好。在那个窗口里打开任意 `tests/**/test_*.json` 就能看到 CodeLens、hover 和测试面板；在源码窗口里打断点会正常命中（`out/**/*.js.map` 已经配好）。

### 方式二：只开插件目录

打开 `~/dev/maa-node-test` 直接按 `F5`。`.vscode/launch.json` 里的配置值同样是「插件从本目录加载、调试窗口打开 `~/dev/MaaEnd`」，所以调试窗口的工作区还是 MaaEnd，只是源码和测试不在同一个窗口里。

### 方式三：不想换窗口，直接在 MaaEnd 里调试

如果你习惯只在 MaaEnd 窗口里工作，把这段加到 `MaaEnd/.vscode/launch.json` 的 `configurations` 里，按 `F5` 即可（调试窗口就是当前这个 MaaEnd 工作区）：

```json
{
  "name": "调试 Maa 节点测试插件",
  "type": "extensionHost",
  "request": "launch",
  "args": ["--extensionDevelopmentPath=${userHome}/dev/maa-node-test", "${workspaceFolder}"],
  "outFiles": ["${userHome}/dev/maa-node-test/out/**/*.js"]
}
```

注意这是本机个人配置：`MaaEnd/.vscode/launch.json` 是仓库里的共享文件，路径里带着你自己的插件位置，别提交上去。

方式一、方式二都配了 `compile` 前置任务，按 `F5` 会自动先编译；方式三需要自己 `pnpm run compile`（或者 `pnpm run watch` 挂着），然后重载调试窗口。

## 怎么用

### 1. 测试面板

左侧活动栏的烧瓶图标（测试）：

- 面板里是三层：**目录 → 测试文件 → 用例**。目录按 `tests` 下的实际文件夹生成（`tests` 这层省略），灰字是「含 N 个测试文件」；
- 文件节点标题是文件名，灰字写着测试组名、平台/资源矩阵和用例数；
- 用例节点标题优先用 `name`，没有就用图片名（去掉扩展名），灰字是图片文件和预期命中节点数；
- 点目录的播放键 → 它下面所有文件各跑一次；点文件的播放键 → 这个文件所有用例跑一遍（一次进程）；点单条用例 → 只跑这一条（一次进程，结果精确到这条）；
- 跑的时候可以在测试输出里看 runner 的完整日志，可以点取消；
- 保存测试文件后会自动刷新（磁盘变化 300 毫秒后重扫）。

### 2. 测试文件里的 CodeLens

打开任意 `tests/**/test_*.json`：

- 文件第一行上方：`运行整个文件（N 个用例）：<测试组名>`；
- 每条用例的 `{` 上方：`运行此用例：<用例名>`。

结果会进「Maa 节点测试」输出面板，并按退出码弹提示（通过 / 失败 / 没跑起来 / 没有匹配用例）。

### 3. 悬浮预览各平台截图

把鼠标放在用例的 `image` 字段上（`"image"` 这个键或它的字符串值都行）：

```text
**帝江号_大世界.png** · 在 `tests/MaaEndTestset` 下找到 3 张（共 3 个平台/资源组合） · 本文件声明平台：Win32、ADB

**ADB / Official_CN** · 1280×720 · [打开原图](file:///…)
![](file:///…)

**CloudADB / Official_CN** · 1280×720 · [打开原图](file:///…)
![](file:///…)
```

- 平台/资源组合是从 `maaNodeTest.testsetDir` 目录**实际扫描**出来的，不写死平台名，加了新控制器目录也能自动出现；
- 某个平台没有这张图，就直接写 `**ADB / Official_CN** · 缺失` —— 这比跑完测试再猜「为什么这条没验证到」快得多；
- 图片按原始像素渲染，1280×720 的截图在悬浮里会比较大，看不清细节时点「打开原图」；
- 一张都没有时会直接说「没有任何平台包含 xxx.png」。

### 4. 命令面板

| 命令 | 作用 |
| --- | --- |
| `Maa 节点测试: 运行当前测试文件` | 跑当前文件所有用例 |
| `Maa 节点测试: 运行当前测试用例` | 从命令面板调起会先弹出用例列表让你选 |
| `Maa 节点测试: 查看当前测试文件的运行计划（不实际执行）` | dry-run：只解析、过滤、检查截图，不加载 MaaFW，用来看「到底会跑哪些组、图片在不在」 |
| `Maa 节点测试: 刷新测试面板` | 手动重扫测试文件 |

## 设置项

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `maaNodeTest.nodePath` | `node` | 跑测试用的 node。要求 22+；不在 PATH 里就填绝对路径 |
| `maaNodeTest.configPath` | `maatools.config.mts` | maa-tools 配置文件，相对工作区根。用来认定哪个工作区文件夹是「仓库根」 |
| `maaNodeTest.testsetDir` | `tests/MaaEndTestset` | 截图根目录，相对工作区根。悬浮预览按它扫描平台目录 |

## 它是怎么做到「只跑一个文件 / 一条用例」的

`maa-tools` 的 CLI 只有 `test`（全量），没有过滤参数。所以插件带了一个脚本 `runner/run-single-test.mjs`，走的是同一套库函数：

1. `loadConfig` 加载 `maatools.config.mts`（会连带执行 `tests/scripts/loader.mts` 的 `fetchCases`）；
2. 读目标测试文件，算出要保留的用例：键是「图片名 + 预期命中的节点集合」；
3. 把配置里的 `test.cases` 包一层，只留下属于这个文件的测试组和用例 —— 因为 `fetchCases` 展开后已经丢了「来自哪个文件」的信息，所以用「声明的 controller/resource + 组名后缀 + 用例键」三条一起定位；
4. 自己做**截图存在性预检**：`maa-tools` 遇到不存在的截图只打印 `not exists, ignored` 然后跳过，跳过即视为通过，会把「一张图都没有」误判成通过；所以一张都不存在时直接判前置错误；
5. 调 `runTest(cfg)`，把结果翻译成固定接口：最后一行 `RESULT: pass|fail|error|empty` + 退出码。

### 为什么不用插件自己的 maa-tools

插件直接调用 `@nekosu/maa-tools` 的 `loadConfig` / `runTest`，但**不把它装进自己的依赖里**：运行时优先加载被测试仓库 `node_modules` 里那份，按包名解析只作兜底。原因是 `maatools.config.mts` 是照仓库那份版本写的，CI 的 `pnpm test` 跑的也是那份 —— 两边版本不一致，就会出现「插件说通过、CI 说失败」这种最难查的问题。

每次运行的第二行日志会写明实际用的是哪一份、什么版本：

```text
库：@nekosu/maa-tools 1.1.2（用仓库里的副本：node_modules/@nekosu/maa-tools/dist/index.mjs）
```

退出码就是插件和脚本之间的契约：

| 退出码 | 含义 | 测试面板里的表现 |
| --- | --- | --- |
| `0` | 通过 | 绿色对勾 |
| `1` | 有用例断言失败（真的跑了识别，结果不符） | 红色叉，附带「看输出 / error_details.json」 |
| `2` | 前置错误：参数错、配置加载失败、截图全缺、MaaFW 准备失败 | 感叹号（errored），和「断言失败」分开，避免误判 |
| `3` | 过滤后没有匹配到任何用例（通常是 controller/resource 写错） | 感叹号，提示去查 `tests/scripts/loader.mts` 的映射 |

## 已知限制

1. **整文件运行时只看整体结果**：`runTest` 一次调用只回答「这个文件里有没有失败用例」，说不出是哪一条。所以点文件节点跑完整文件后，子用例按同一结果统一标记；想定位具体是哪条失败，展开后单独重跑那一条。
2. **部分截图缺失仍会继续跑**：这是 `maa-tools` 自己的行为（缺失的用例跳过并视为通过），插件只能把「缺哪张图」打出来提醒，不会替它判失败。
3. **悬浮图片按原尺寸渲染**：图多、图大时悬浮框会很高。想要小图只能点「打开原图」看完整尺寸。
4. **远程 / WSL / 虚拟工作区**：悬浮里的 `file://` 图片在非本机文件系统上可能不显示，此时用「打开原图」链接。
5. **过滤依赖 loader 的组名格式**：`tests/scripts/loader.mts` 里组名是 `(controller-resource)name`，`imageRoot` 是 `controller/resource`。这两处拼法将来若改了，需要同步改 `runner/lib/filter.mjs`。
6. **极端情况下可能多跑别人的用例**：两个测试文件若 controller、resource、`configs.name`、图片名和命中节点全都一样，就无法区分，两边都会被保留（当前 MaaEnd 仓库实测没有这种冲突）。
7. **未保存的修改不生效**：测试面板和运行都读磁盘上的文件，改了没保存请先 `Ctrl+S`。

## 目录结构

```text
maa-node-test/
├─ package.json          # 扩展清单：命令、设置项、激活事件
├─ tsconfig.json
├─ src/
│  ├─ extension.ts       # 只做装配：输出面板、provider、命令
│  ├─ config.ts          # 读设置、解析仓库根
│  ├─ runner.ts          # 起 runner 进程、收输出、按退出码提示（CodeLens / 命令用）
│  ├─ testing.ts         # 测试面板：发现用例、运行、结果映射
│  ├─ providers/         # CodeLens 与 hover 的薄适配层
│  └─ core/              # 纯函数：解析测试文件、扫截图、拼 hover 文本、拼命令参数
└─ runner/
   ├─ run-single-test.mjs # 只跑一个文件 / 一条用例的入口
   └─ lib/                # 参数解析、用例键、过滤、截图预检、PNG 尺寸、退出码
```

`src/core/` 里的模块不 import `vscode`，所以能直接在 Node 里跑单测；`runner/` 是独立的 ESM 脚本，不依赖插件进程，也可以在终端里手动跑。

## 自查命令

```bash
pnpm run check        # 类型检查（tsc --noEmit）
pnpm run compile      # 编译到 out/
pnpm test             # 扩展纯函数单测
pnpm run test:runner  # runner 单测
pnpm run test:all     # 上面三件事一起
```

格式化沿用 MaaEnd 仓库的 prettier 配置（本项目的 `.prettierrc` 不重复写一份）：

```bash
~/dev/MaaEnd/node_modules/.bin/prettier --config ~/dev/MaaEnd/.prettierrc.mjs \
  --write "package.json" "tsconfig.json" ".vscode/*.json" "src/**/*.ts" "runner/**/*.mjs"
```

`maa-node-test.code-workspace` 刻意排除在格式化之外（`.prettierignore` 里有说明）：它是纯 JSON，不能带尾逗号。

想在终端里手动看某个文件会跑哪些组、图在不在（不加载 MaaFW，几秒出结果）：

```bash
node runner/run-single-test.mjs \
  --workspace ~/dev/MaaEnd \
  --file tests/Common/Button/test_close_button.json \
  --dry-run
```

真实跑一条用例：

```bash
node runner/run-single-test.mjs \
  --workspace ~/dev/MaaEnd \
  --file tests/DeliveryJobs/test_region.json \
  --case 0
```

## 和 MaaEnd 仓库的关系

这个扩展是 MaaEnd 节点测试的配套开发工具，但**不放在 MaaEnd 仓库里**：仓库的 CI 只为 Pipeline / 资源 / Agent 服务，加一个需要 `tsc` 构建的 VS Code 扩展会平白多一套构建产物和依赖。

插件对 MaaEnd 仓库的假设只有三条：工作区根有 `maatools.config.mts`、截图在 `tests/MaaEndTestset` 下按 `<控制器>/<资源服>` 分目录、测试文件叫 `tests/**/test_*.json`。这三条变了，改设置项或 `core/` 里对应的一小段即可。

## 给 agent / 新维护者的入口

- [AGENTS.md](AGENTS.md)：项目边界、常用命令、代码地图、硬约束；
- [.agents/skills/maa-node-test-dev/SKILL.md](.agents/skills/maa-node-test-dev/SKILL.md)：改动这个插件时的操作手册，同目录的 [reference.md](.agents/skills/maa-node-test-dev/reference.md) 是命令行契约、退出码映射等细节；
- [.agents/notes/](.agents/notes/README.md)：设计取舍记录 —— 为什么自带 runner 而不改上游、为什么插件独立成仓、调试窗口为什么必须是 MaaEnd。
