<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <img alt="Maa 节点测试插件" src="./icon.png" width="256" height="256" />
</p>

<div align="center">

# Maa 节点测试插件

</div>

Maa 节点测试的 VS Code 插件，基于 `maa-tools` 的节点测试机制（`tests/**/test_*.json` 与测试集截图），适用于任何采用该机制的仓库。默认值取自 MaaEnd（作者日常使用的仓库），均可在设置中调整。

## 功能

- **运行单条用例**：修改识别节点后无需执行全量 `pnpm test` 即可验证目标用例。
- **报告失败原因**：失败的平台、未命中的节点、识别框偏差，均写入测试面板。
- **对照各平台截图**：悬浮提示展示 Win32 / ADB / CloudADB 下的同名截图，顺序跟本文件 `configs.controller` 一致，缺失的平台单独标注。
- **写用例时就提示缺图**：声明的平台没有这张截图时，`image` 的值下面直接出现黄色波浪线，测试面板里的用例节点也会写「缺 ADB 截图」。
- **字段补全**：`controller` / `resource` 补的是 `tests/scripts/loader.mts` 里登记过的名字，`image` 补测试集里真实存在的截图（按本文件声明的平台收窄），`hits` 补 pipeline 里的节点名（只算本文件声明的控制器会加载的资源目录）；各级对象的键也能补。
- **节点注释与跳转**：`hits` 里的节点名，展开补全能看到它在 pipeline 里的 `desc` 和定义位置；鼠标放上去显示注释、识别/动作和节点源码片段；Ctrl+Click 或 F12 跳到定义。`image` 字段上 Ctrl+Click 打开截图。
结果有多个时（同一张图在几个平台都有、同一个节点名在多处定义）会弹一个列表让你挑，顺序跟本文件声明的平台一致 —— 常常只是想看某个平台那张图，列表里直接选就行。
- **内联提示**：`hits` 里每个节点名后面直接贴一句灰色注释（就是 pipeline 里的 `desc`），一屏能同时看到好几个节点各自是干什么的；点提示跳到定义。不喜欢可以在设置里关掉。
- **测试面板集成**：以「目录 → 测试文件 → 用例」三层组织，目录、文件、单条用例均可运行。

## 范围

插件范围限于节点测试，输入为测试文件（`tests/**/test_*.json`）、测试集截图与 `maatools.config.mts`。Pipeline 链路校验、资源打包、任务运行调试不在其中，由各仓库自己的工具负责。

## 装之前

| 需要 | 说明 |
| --- | --- |
| Node 22 或更高 | `maa-tools` 和仓库脚本都依赖 Node 22 的 API；不在 PATH 里可以设 `maaNodeTest.nodePath` |
| pnpm，以及一个装好依赖的仓库（用 `maa-tools` 做节点测试的，比如 MaaEnd） | 工作区根要有 `maatools.config.mts`，并且跑过 `pnpm install` |
| VS Code 1.85 或更高 | |

插件不改动被测仓库，也不往里加文件。

## 装

### 正式版

还没发布到市场。发布之后可以：

- 在 VS Code 的扩展面板里搜「Maa 节点测试」安装；
- 或者从 GitHub Release 下载 `.vsix`，用 `code --install-extension maa-node-test-<版本>.vsix` 安装。

维护者发一版分两步（`main` 有分支保护，版本号改动也得走 PR）：

1. `pnpm version patch --no-git-tag-version` 改版本号，提 PR 合进 `main`；
2. 到仓库的 Actions 页面手动触发 `Release` 工作流（选 `main` 分支）。它读 `package.json` 的版本号，打 `v<版本>` 标签、跑测试、打包、建 GitHub Release 并挂上 `.vsix`，然后发布到市场（细节见 [reference.md](.agents/skills/maa-node-test-dev/reference.md#构建与发布)）。

标签由工作流自己打，不需要在本地 `git tag`；手动推标签不会再触发发布。

### 开发态

想改代码或者还没发版时，用调试方式跑：

```bash
cd ~/dev/maa-node-test
pnpm install
pnpm run compile
```

关键点：**运行插件的那个窗口，工作区必须是被测的那个仓库**。插件要靠它读 `maatools.config.mts`、`tests/` 和截图；工作区不对，测试面板就是空的。下面三种方式都行，示例里用的是作者本机的 `~/dev/MaaEnd`，换成你自己的仓库路径即可。

### 方式一（推荐）：用多根工作区文件

把 `maa-node-test.code-workspace` 拖进 VS Code（或 `code ~/dev/maa-node-test/maa-node-test.code-workspace`）。它同时打开两个文件夹：`MaaEnd`（排第一个，主工作区）和 `maa-node-test`（插件源码）。

按 `F5` 会自动编译，再起一个**工作区是 MaaEnd** 的调试窗口，插件已经装好。在那个窗口里打开任意 `tests/**/test_*.json` 就能用；在源码窗口打断点也会正常命中。

### 方式二：只开插件目录

打开 `~/dev/maa-node-test` 直接按 `F5`。`.vscode/launch.json` 已经写好「插件从本目录加载、调试窗口打开 `~/dev/MaaEnd`」，所以调试窗口的工作区还是 MaaEnd。

### 方式三：直接在 MaaEnd 窗口里调试

把这段加到 `MaaEnd/.vscode/launch.json` 的 `configurations` 里，按 `F5`：

```json
{
    "name": "调试 Maa 节点测试插件",
    "type": "extensionHost",
    "request": "launch",
    "args": ["--extensionDevelopmentPath=${userHome}/dev/maa-node-test", "${workspaceFolder}"],
    "outFiles": ["${userHome}/dev/maa-node-test/out/**/*.js"]
}
```

注意这是个人配置：`MaaEnd/.vscode/launch.json` 是仓库共享文件，路径里带着你自己的插件位置，别提交上去。

方式一、方式二按 `F5` 会自动先编译；方式三要自己 `pnpm run compile`（或者 `pnpm run watch` 挂着）再重载窗口。

## 怎么用

### 测试面板

左侧活动栏的烧瓶图标（测试）：

- 树是三层：**目录 → 测试文件 → 用例**。目录按 `tests` 下的实际文件夹生成（`tests` 这层省略），灰字写「含 N 个测试文件」；
- 文件节点标题是文件名，灰字写测试组名、平台/资源矩阵和用例数；
- 用例节点标题优先用 `name`，没有就用图片名（去掉扩展名），灰字是图片文件和预期命中节点数；
- 点目录的播放键 → 下面所有文件**一次进程**跑完；点文件 → 这个文件所有用例；点单条用例 → 只跑这一条；
- 跑的时候能在「测试输出」里看完整日志，也能点取消；
- 保存测试文件后自动刷新（停手 300 毫秒后重扫）。

失败信息分两层：节点上显示一行短标题，点开测试结果看到明细列表。例如只在 CloudADB 上失败时：

```text
**CloudADB-官服 失败**

- 节点 `EnvironmentMonitoringPhotoSettingsOpened` 这张图上没识别到该节点（算法 ColorMatch）
- 截图 `武陵_拍照模式_画面设置.png`（CloudADB-官服）
- 通过：Win32-官服、ADB-官服
```

文件节点上是「2 条用例失败」，展开后逐条列出每条用例的原因，省得一条条重跑。

### 文件里的运行按钮（CodeLens）

打开任意 `tests/**/test_*.json`：

- 文件第一行上方：`运行整个文件（N 个用例）：<测试组名>`；
- 每条用例的 `{` 上方：`运行此用例：<用例名>`。

跑完会进「Maa 节点测试」输出面板，并按结果弹提示（通过 / 失败 / 没跑起来 / 没有匹配用例）。

### 鼠标放在 `image` 上：看各平台截图

指针放在用例的 `image` 键或它的字符串值上都行：

```text
**帝江号_大世界.png** · 在 `tests/MaaEndTestset` 下找到 3 张（共 3 个平台/资源组合） · 本文件声明平台：Win32、ADB

**ADB / Official_CN** · 1280×720 · [打开原图](file:///…)
（这里是一张预览图，默认宽 400）

**CloudADB / Official_CN** · 缺失
```

- 平台/资源组合是从 `maaNodeTest.testsetDir` 目录**实际扫出来的**，不写死平台名，加了新控制器目录也能自动出现；
- 某个平台没有这张图就直接写 `缺失` —— 这比跑完测试再猜「为什么这条没验证到」快得多；
- 图片按原始像素渲染，1280×720 在悬浮里比较大，看不清就点「打开原图」；
- 一张都没有时会直接说「没有任何平台包含 xxx.png」。

### 命令面板

| 命令 | 作用 |
| --- | --- |
| `Maa 节点测试: 运行当前测试文件` | 跑当前文件所有用例 |
| `Maa 节点测试: 运行当前测试用例` | 先弹用例列表让你选 |
| `Maa 节点测试: 查看当前测试文件的运行计划（不实际执行）` | dry-run：只解析、过滤、检查截图，不加载 MaaFW |
| `Maa 节点测试: 刷新测试面板` | 手动重扫测试文件 |

## 设置项

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `maaNodeTest.nodePath` | `node` | 跑测试用的 node。要求 22+；不在 PATH 里就填绝对路径 |
| `maaNodeTest.configPath` | `maatools.config.mts` | maa-tools 配置文件，相对工作区根。用来认定哪个工作区文件夹是「仓库根」 |
| `maaNodeTest.testsetDir` | `tests/MaaEndTestset` | 截图根目录，相对工作区根。悬浮预览按它扫描平台目录 |
| `maaNodeTest.hoverImageWidth` | `400` | 悬浮里预览图的显示宽度（像素）。`0` 表示按原图尺寸 |
| `maaNodeTest.hitsInlayHints` | `true` | 是否在 `hits` 的节点名后面显示注释（内联提示） |

## 常见问题

**测试面板是空的。**
当前窗口的工作区不是被测仓库，或者仓库里没有 `tests/**/test_*.json`。按上面的方式一重新打开。

**点运行，提示「没跑起来」。**
大多是 node 版本低于 22，用 `maaNodeTest.nodePath` 指到 22+ 的 node。也可能是第一次运行要联网下载 MaaFW 失败，看「Maa 节点测试」输出面板里的 prepare 日志。

**提示「没有匹配到任何用例」。**
`configs.controller` 或 `configs.resource` 写得不在 `tests/scripts/loader.mts` 的映射里。命令面板的「查看运行计划」能看出到底解析出了哪些组。

**声明的平台缺截图会怎么提示？**

四个地方都会提示，缺图不会被当成「通过」糊过去：

- **写的时候**（不用跑）：`image` 的值下面一条黄色波浪线，说明哪个平台没这张图、哪个平台连目录都没有；测试面板的用例节点上带一句「缺 ADB 截图」；
- 悬浮里那个平台直接标 `缺失`；声明了、但测试集里连平台目录都没有，会写「`tests/MaaEndTestset` 下没有这个平台的目录」；
- 运行日志里先打一块「平台覆盖」：每个平台多少张截图、缺几张，以及声明了却没匹配到测试组的平台（通常说明 controller 名字写错或 `tests/scripts/loader.mts` 没映射它）；
- 测试面板里那条用例标成**跳过**（灰的，不算失败），文件节点仍算通过，但会带一句「N 条用例没有验证到（缺图跳过，不算失败，补图后重跑即可）」并在测试输出里列出是哪几条 —— 因为 `maa-tools` 遇到缺图只会跳过，跳过在它那里等于通过，插件把它显式顶出来，同时不把整次运行染红。

**为什么全量跑要几分钟？**
节点测试本身就是几百上千次识别，时间花在识别上，不是插件。插件已经把「一个文件一个进程」改成「一批文件一个进程」，和 `pnpm test` 的速度基本一致；机器核越多越快（maa-tools 默认开 `核数/4` 个 worker）。

**悬浮里的图片不显示。**
远程 / WSL / 虚拟工作区下 `file://` 可能加载不出来，点「打开原图」看。

**改了测试文件没生效。**
面板和运行都读磁盘上的文件，先保存（`Ctrl+S`）。

## 已知限制

1. **两条用例共用同一张截图、同一批节点时，会被同时点名**：结论按「图片 + 期望命中的节点」归位，这种情况区分不了。
2. **缺图的用例在 `maa-tools` 里算通过**：它遇到不存在的截图只打印跳过。插件不改它的判定，但会在悬浮、运行日志（平台覆盖）和测试面板（用「跳过」而不是绿勾，也不算失败）三处显式提示。
3. **逐用例原因依赖 maa-tools 的错误明细**：它写 `tests/maatools/error_details.json`，插件只在本次运行确实更新过这个文件时才采信；拿不到就退化成「整个文件失败，原因未知」。
4. **悬浮图片按原尺寸渲染**：图大时悬浮框会很高。

## 和具体仓库的关系

插件是独立的（自己一个仓库、自己一套构建），**不塞进被测仓库**：那边 CI 只为 Pipeline / 资源 / Agent 服务，加一个需要 `tsc` 构建的 VS Code 扩展会平白多一套构建产物和依赖。

它对被测仓库的假设只有三条：

1. 工作区根有 `maatools.config.mts`（`maa-tools` 的默认约定）；
2. 测试文件叫 `tests/**/test_*.json`（同上）；
3. 截图按 `<控制器>/<资源服>/<图片>` 分目录放在测试集里。默认路径是 `tests/MaaEndTestset`（MaaEnd 的写法），别的仓库用 `maaNodeTest.testsetDir` 指过去。

补全和缺图检查都读 `tests/scripts/loader.mts` 里的 `controllerMap` / `resourceMap`：那是「测试文件里写的名字 → 截图目录名」的唯一依据。没有这个文件时，插件按同名处理，补全只给测试集里扫到的平台目录名。

图标 `icon.png` 用的是 MaaEnd 项目的 logo（512×512）。fork 之后要换成自己的图标，直接替换这个文件即可。

默认值来自 MaaEnd 纯粹是因为作者日常在测它。换一个仓库来用，一般只需要改 `maaNodeTest.testsetDir` 和 `maaNodeTest.configPath`；如果那个仓库的 `tests/scripts/loader.mts` 用了不一样的组名拼法，插件靠「组名 + 用例键」把用例从全量结果里挑出来这一步也要跟着调（见 [reference.md](.agents/skills/maa-node-test-dev/reference.md#过滤规则)）。

## 想改这个插件

- 常用命令：`pnpm run check`（类型检查）、`pnpm run build`（编译 + 打包到 `dist/`）、`pnpm test`（扩展单测）、`pnpm run test:runner`（runner 单测）、`pnpm run test:all`、`pnpm run package`（打 VSIX）；
- [AGENTS.md](AGENTS.md)：项目边界、代码地图、硬约束；
- [.agents/skills/maa-node-test-dev/SKILL.md](.agents/skills/maa-node-test-dev/SKILL.md)：改这个插件时的操作手册；同目录 [reference.md](.agents/skills/maa-node-test-dev/reference.md) 是命令行契约、退出码映射、内部实现细节；
- [.agents/notes/](.agents/notes/README.md)：设计取舍记录（为什么自带 runner、为什么独立成仓、为什么合成一批跑）。

## 致谢

- [neko-para/maa-support-extension](https://github.com/neko-para/maa-support-extension)：本插件的参考实现，扩展的组织方式、悬浮与补全里显示节点注释的写法都来自它；它的 `@nekosu/maa-tools` 还直接提供了节点测试的执行能力（`loadConfig` / `runTest` / `loadAllTestCases`），插件自己不实现识别与比对。
- [MaaXYZ/MaaFramework](https://github.com/MaaXYZ/MaaFramework)：节点（Pipeline）协议与识别算法，节点测试跑的就是它。
- [MaaEnd/MaaEnd](https://github.com/MaaEnd/MaaEnd)：节点测试的用例格式、`tests/MaaEndTestset` 的测试集目录约定、`tests/scripts/loader.mts` 里的控制器与资源映射；插件的默认值和图标都取自这个仓库。
- [he0119/vscode-bangumiplan](https://github.com/he0119/vscode-bangumiplan)：发布流程的参考，测试/发布两个 workflow 的结构（vsce 发布、Open VSX、GitHub Release 附件）照它配的。

## License

MIT
