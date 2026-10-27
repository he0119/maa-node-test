# 参考：契约与内部细节

`SKILL.md` 讲流程，这里放「改之前必须知道的事实」：文件职责、runner 命令行契约、退出码映射、过滤规则、hover 文本格式、测试面板语义。

## 文件职责

### `src/`

| 文件 | 职责 |
| --- | --- |
| `extension.ts` | 装配层：建输出面板、实例化 runner 与测试面板、注册两个 provider 和四个命令；`deactivate` 收掉子进程 |
| `config.ts` | 读 `maaNodeTest.*` 设置；认定哪个 workspace folder 是仓库根（含 `configPath` 的那个） |
| `runner.ts` | `startTestProcess()` 统一起进程/收输出/给退出码；`NodeTestRunner` 负责输出面板、状态栏、退出码提示 |
| `testing.ts` | `NodeTestExplorer`：TestController 的发现、运行、结果映射；`collectTargets()` 挑本次目标 |
| `providers/codeLens.ts` | 把 `core/lens.ts` 的描述翻成 `vscode.CodeLens`；导出共用的文件选择器 |
| `providers/hover.ts` | 定位 image 字段 → 扫测试集 → `MarkdownString`，range 限定在图片值上 |
| `core/document.ts` | jsonc 解析：configs（字符串/数组统一成数组）、cases（offset、image 键/值 span、hitCount、endOffset）、problems |
| `core/testset.ts` | 扫一级目录=平台、二级目录=资源；按平台找同名截图；读 PNG 头拿尺寸 |
| `core/hover.ts` | 拼 hover 的 Markdown 正文（绝对路径→URI 由回调注入，不 import vscode） |
| `core/lens.ts` | 生成 CodeLens 描述 + 命令 id 常量 |
| `core/runnerArgs.ts` | 拼 runner 参数、拼可打印命令行、拼运行标题 |
| `core/testExplorer.ts` | 把测试文件翻成测试面板的树描述（id、label、description、range） |

### `runner/`

| 文件 | 职责 |
| --- | --- |
| `run-single-test.mjs` | 唯一入口：参数 → 读测试文件 → 算 target → 加载配置 → 过滤 → 截图预检 → dry-run 或 `runTest` → RESULT + 退出码 |
| `lib/args.mjs` | 手写参数解析 + 用法文本；`--case` 只收非负整数 |
| `lib/test-file.mjs` | 读目标文件（jsonc）、结构规整、`buildTarget`（`--case` 越界抛专用错误） |
| `lib/case-key.mjs` | 用例键 = `<图片名>\|<命中节点按字典序去重后逗号连接>`；`hits` 支持字符串与 `{node, box}` |
| `lib/filter.mjs` | `filterGroups()` 纯函数（不就地改入参）+ 组名/组简称 |
| `lib/images.mjs` | 截图路径（与 `runTest` 内算法逐字一致）、存在性扫描、统计 |
| `lib/png.mjs` | 读 PNG 头拿宽高 |
| `lib/paths.mjs` | 相对仓库根解析路径、日志里显示相对路径 |
| `lib/report.mjs` | 退出码映射与 `RESULT:` 行 |
| `lib/maa-tools.mjs` | 加载 `@nekosu/maa-tools`：**优先**用仓库里的那份，包名解析只作兜底；返回本次实际加载的来源与版本 |

## 依赖策略：为什么不自带 maa-tools

`@nekosu/maa-tools` **故意没有写进本仓库的 `package.json`**。插件和 runner 直接调它的函数（`loadConfig`、`runTest`），但加载的是**被测试仓库自己装的那一份**：

```text
<workspace>/node_modules/@nekosu/maa-tools/dist/index.mjs   ← 优先
@nekosu/maa-tools（按包名解析）                              ← 兜底，仅用于脚本被搬到别处做实验
```

理由：

1. **版本一致才能结论一致**。`maatools.config.mts` 是照仓库那份 maa-tools 写的（类型、`test.cases` 的返回结构、组名拼法、`imageRoot` 都由它决定），CI 里的 `pnpm test` 跑的也是那份。插件自带副本就可能出现「插件说通过、CI 说失败」。
2. **它决定 MaaFW 版本**。`setupMaa` 用 `maaVersion: 'latest'` + `~/.maa-tools` 缓存，两份副本可能解析出不同的 MaaFW，识别结果就不可比。
3. **省一份重复依赖**。它拖着 jiti / workerpool / maa-version-manager / maa-pipeline-manager 等一串包。

代价：仓库依赖没装好时插件跑不起来（README 的前置条件里写了）。所以每次运行都会在日志第二行打出实际用的是哪一份、什么版本：

```text
库：@nekosu/maa-tools 1.1.2（用仓库里的副本：node_modules/@nekosu/maa-tools/dist/index.mjs）
```

排查「本地和 CI 不一致」时先看这一行。

## runner 命令行契约

```text
node runner/run-single-test.mjs \
  --workspace <仓库根绝对路径> \
  [--config <相对仓库根的 maatools 配置，默认 maatools.config.mts>] \
  --file <测试 json：绝对路径或相对仓库根> \
  [--case <用例下标，从 0 开始>] \
  [--dry-run]
```

- 不传 `--case`：跑该文件全部用例。
- `--dry-run`：只解析、过滤、检查截图，打印计划；不加载 MaaFW、不执行识别。
- stdout 是人话日志，**最后一行固定** `RESULT: pass|fail|error|empty`；退出码与之一致。
- 脚本自己不做「静默降级」：缺少 `--workspace`/`--file`、配置文件加载失败、目标文件不存在、截图一张都不存在、MaaFW 起不来，全部按前置错误报出来。

## 退出码 → 扩展行为

| 退出码 | 来源 | `NodeTestRunner`（CodeLens / 命令） | `NodeTestExplorer`（测试面板） |
| --- | --- | --- | --- |
| `0` | 全部用例通过 / dry-run 有匹配 | 弹「通过」提示（dry-run 不弹） | 标记 passed |
| `1` | 有用例断言失败 | 弹「失败」+「打开错误详情」按钮 | 标记 failed，提示看输出与 `error_details.json` |
| `2` | 前置错误（参数、配置、截图全缺、MaaFW） | 弹「没能跑起来」+「查看输出」 | 标记 **errored**（不是 failed） |
| `3` | 过滤后没有可跑用例 | 弹「没有匹配到任何用例」+「查看输出」 | 标记 errored，提示查 loader 映射 |
| `null` | 进程没起来或被杀 | 弹「没能跑起来」，提示查 `nodePath` | 标记 errored / skipped |

`1` 和 `2` 必须分开：一个是用例真的不通过，一个是根本没跑起来，排查方向完全不同。

## 过滤规则

`maa-tools` 的 `runTest` 只接受配置里的 `test.cases`，而 `fetchCases` 展开后每个组只剩 `configs` 和 `cases`，「来自哪个文件」的信息已经丢了，组名只带 `(controller-resource)name`。所以 `filterGroups()` 用四条一起收窄：

1. `group.configs.controller` ∈ 目标文件声明的 controller；
2. `group.configs.resource` ∈ 目标文件声明的 resource；
3. 目标文件写了 `configs.name` 时，组名必须以 `)<name>` 结尾；
4. 组内只保留「用例键在目标集合里」的用例，滤空的组整个丢掉。

第 4 条是关键：同一个 controller/resource 下往往有几十个测试文件，只靠 1～3 会顺带跑掉别人的用例。

**已知边界**：两个文件若 controller、resource、`configs.name`、图片名和命中节点全都相同，就无法区分，两边都会保留（当前 MaaEnd 仓库实测无此冲突）。

## 截图预检

路径算法必须与 `runTest` 内一致，否则会出现「预检说存在、maa-tools 说 not exists」：

```text
path.resolve(cfg.cwd, cfg.test.casesCwd, group.configs.imageRoot ?? '.', case.image)
```

- 全部缺失 → 退出码 2（否则 maa-tools 会把所有用例跳过并判通过，假阳性）。
- 部分缺失 → 打警告后继续跑（maa-tools 自己的行为，我们改不了它的判定）。

## hover 文本格式

```text
**帝江号_大世界.png** · 在 `tests/MaaEndTestset` 下找到 3 张（共 3 个平台/资源组合） · 本文件声明平台：Win32、ADB

**ADB / Official_CN** · 1280×720 · [打开原图](file:///…)
![](file:///…)

**CloudADB / Official_CN** · 缺失
```

- 平台/资源组合来自扫描 `maaNodeTest.testsetDir`，不写死；
- 行尾两个空格是 Markdown 硬换行，让图片紧跟描述；
- 一个都没找到时只给一句人话提示（「没有任何平台包含 xxx.png…」），不铺空表格；
- URI 里的括号要转义成 `%28`/`%29`，否则文件名带括号时链接会断。

## 测试面板语义

- **发现**：`findFiles` 扫 `test_*.json` 与 `test_*.jsonc`，按 `isTestFilePath()` 过滤；JSON 坏掉的跳过并 `console.warn`，不影响整个面板。保存文件后 300ms 防抖刷新。
- **运行**：`collectTargets()` 决定跑什么 —— 没有 `include`（Run All）时每个文件一次；`include` 是文件节点时该文件一次；是用例节点时那一条一次。同一文件既有整文件又有单用例时，整文件优先去重。
- **串行**：多个目标用一个 promise 队列逐个跑，避免同时起一堆 MaaFW。
- **取消**：`CancellationToken` → `process.cancel()`，被取消的标 skipped。
- **整文件运行**：进程只给一个总结果，所以文件和它的子用例统一标记；失败信息提示「展开后单跑以定位」。

## 设置项

| 设置 | 默认 | 用途 |
| --- | --- | --- |
| `maaNodeTest.nodePath` | `node` | 跑测试的 node，要求 22+ |
| `maaNodeTest.configPath` | `maatools.config.mts` | 认定仓库根；runner 的 `--config` |
| `maaNodeTest.testsetDir` | `tests/MaaEndTestset` | hover 扫描截图的根目录 |

## 单测地图

| 单测 | 覆盖 |
| --- | --- |
| `src/core/document.test.ts` | 解析真实形态（注释、尾逗号）、offset 切片、configs 两种写法、image 键/值命中、坏 JSON |
| `src/core/testset.test.ts` | 平台/资源扫描、按平台找图、PNG 尺寸、目录不存在 |
| `src/core/hover.test.ts` | hover 命中/缺失/测试集不存在/无平台目录 |
| `src/core/lens.test.ts` | CodeLens 条数与命令参数 |
| `src/core/runnerArgs.test.ts` | 参数拼装（有/无 `--case`、`--dry-run`）、命令行转义、标题 |
| `src/core/testExplorer.test.ts` | 测试面板节点 label 回退、id 稳定、range 覆盖用例对象 |
| `runner/lib/*.test.mjs` | 用例键、过滤四条规则、参数非法输入、`--case` 越界、截图路径与统计、PNG、RESULT 映射 |
