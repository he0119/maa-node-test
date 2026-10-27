# Maa 节点测试

在 VS Code 里跑 MaaEnd 的节点测试：点一下就只跑你想验证的那条用例，鼠标放在 `image` 上就能看见各平台的截图。只做这一件事。

## 有什么用

- **只跑一条**：改完一个识别节点，不用为验证它等一次全量 `pnpm test`。
- **失败直接说原因**：哪个平台失败、哪个节点没命中、还是识别框不对，直接写在测试面板里。
- **各平台截图对比**：鼠标一放就能看见 Win32 / ADB / CloudADB 上的同名截图，缺哪张一眼就知道。
- **测试面板全都在**：左侧烧瓶图标里是「目录 → 测试文件 → 用例」，点目录、点文件、点单条都能跑。

## 装之前

| 需要 | 说明 |
| --- | --- |
| Node 22 或更高 | `maa-tools` 和仓库脚本都依赖 Node 22 的 API；不在 PATH 里可以设 `maaNodeTest.nodePath` |
| pnpm，以及一个装好依赖的 MaaEnd 仓库 | 工作区根要有 `maatools.config.mts`，并且跑过 `pnpm install` |
| VS Code 1.85 或更高 | |

插件不改 MaaEnd 仓库，也不往仓库里加文件。

## 装（开发态）

现在还没发布到市场，用调试方式跑：

```bash
cd ~/dev/maa-node-test
pnpm install
pnpm run compile
```

关键点：**运行插件的那个窗口，工作区必须是 MaaEnd 仓库**。插件要靠它读 `maatools.config.mts`、`tests/` 和截图；工作区不对，测试面板就是空的。下面三种方式都行：

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
![](file:///…)

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

## 常见问题

**测试面板是空的。**
当前窗口的工作区不是 MaaEnd 仓库，或者仓库里没有 `tests/**/test_*.json`。按上面的方式一重新打开。

**点运行，提示「没跑起来」。**
大多是 node 版本低于 22，用 `maaNodeTest.nodePath` 指到 22+ 的 node。也可能是第一次运行要联网下载 MaaFW 失败，看「Maa 节点测试」输出面板里的 prepare 日志。

**提示「没有匹配到任何用例」。**
`configs.controller` 或 `configs.resource` 写得不在 `tests/scripts/loader.mts` 的映射里。命令面板的「查看运行计划」能看出到底解析出了哪些组。

**为什么全量跑要几分钟？**
节点测试本身就是几百上千次识别，时间花在识别上，不是插件。插件已经把「一个文件一个进程」改成「一批文件一个进程」，和 `pnpm test` 的速度基本一致；机器核越多越快（maa-tools 默认开 `核数/4` 个 worker）。

**悬浮里的图片不显示。**
远程 / WSL / 虚拟工作区下 `file://` 可能加载不出来，点「打开原图」看。

**改了测试文件没生效。**
面板和运行都读磁盘上的文件，先保存（`Ctrl+S`）。

## 已知限制

1. **两条用例共用同一张截图、同一批节点时，会被同时点名**：结论按「图片 + 期望命中的节点」归位，这种情况区分不了。
2. **缺图的用例仍算通过**：这是 `maa-tools` 自己的行为（缺图跳过视为通过）。插件会把缺哪张图、哪些平台没验证到打出来，但不会替它判失败。
3. **逐用例原因依赖 maa-tools 的错误明细**：它写 `tests/maatools/error_details.json`，插件只在本次运行确实更新过这个文件时才采信；拿不到就退化成「整个文件失败，原因未知」。
4. **悬浮图片按原尺寸渲染**：图大时悬浮框会很高。

## 和 MaaEnd 仓库的关系

这个扩展是 MaaEnd 节点测试的配套开发工具，但**不放在 MaaEnd 仓库里**：仓库 CI 只为 Pipeline / 资源 / Agent 服务，加一个需要 `tsc` 构建的 VS Code 扩展会平白多一套构建产物和依赖。

插件对 MaaEnd 仓库的假设只有三条：工作区根有 `maatools.config.mts`、截图在 `tests/MaaEndTestset` 下按 `<控制器>/<资源服>` 分目录、测试文件叫 `tests/**/test_*.json`。

## 想改这个插件

- 常用命令：`pnpm run check`（类型检查）、`pnpm run compile`、`pnpm test`（扩展单测）、`pnpm run test:runner`（runner 单测）、`pnpm run test:all`；
- [AGENTS.md](AGENTS.md)：项目边界、代码地图、硬约束；
- [.agents/skills/maa-node-test-dev/SKILL.md](.agents/skills/maa-node-test-dev/SKILL.md)：改这个插件时的操作手册；同目录 [reference.md](.agents/skills/maa-node-test-dev/reference.md) 是命令行契约、退出码映射、内部实现细节；
- [.agents/notes/](.agents/notes/README.md)：设计取舍记录（为什么自带 runner、为什么独立成仓、为什么合成一批跑）。
