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
| `core/testResult.ts` | 解析 `RESULT-FILE:` / `RESULT-CASE:` 行、退出码映射、失败文案（短标题 + 明细列表）、拼 Markdown、`planFileMarking()` 决定每个节点标什么 |
| `core/missingImages.ts` | 探测阶段查缺图：哪些声明平台没有这张截图、平台目录是否压根不存在，以及对应的诊断文案 |
| `core/loaderMaps.ts` | 解析 `tests/scripts/loader.mts` 的 `controllerMap` / `resourceMap`（显示名 → 截图目录名），供补全、缺图检查、悬浮共用 |
| `core/completion.ts` | 用 `jsonc-parser` 的 `getLocation` 判断光标在哪一层，给出该位置的候选（纯逻辑） |
| `core/repoIndex.ts` | 补全的数据来源：loader 映射、测试集截图名、pipeline 节点索引，各自带缓存 |
| `core/hits.ts` | 解析测试文件里 `hits` 的每一项（字符串和 `{node: ...}` 两种写法）及其位置，供内联提示用；提示文案的截断也在这里 |
| `core/pipeline.ts` | 解析 pipeline 文件里每个节点的位置与说明（`desc` / `focus` / 识别 / 动作），以及 `hits` 路径判断 |
| `providers/inlayHints.ts` | `hits` 节点名后面的注释（`desc`），点击跳定义 |
| `providers/definition.ts` | `hits` 里的节点名 Ctrl+Click / F12 跳到 pipeline 里的定义 |
| `core/testExplorer.ts` | 把测试文件翻成测试面板的树描述（id、label、description、range）；`folderSegments()` 决定目录分组层级 |

### `runner/`

| 文件 | 职责 |
| --- | --- |
| `run-single-test.mjs` | 唯一入口：参数 → 读测试文件 → 算 target → 加载配置 → 过滤 → 截图预检 → dry-run 或 `runTest` → RESULT + 退出码 |
| `lib/args.mjs` | 手写参数解析 + 用法文本；`--case` 只收非负整数 |
| `lib/test-file.mjs` | 读目标文件（jsonc）、结构规整、`buildTarget`（`--case` 越界抛专用错误） |
| `lib/case-key.mjs` | 用例键 = `<图片名>\|<命中节点按字典序去重后逗号连接>`；`hits` 支持字符串与 `{node, box}` |
| `lib/filter.mjs` | `filterGroupsForFiles()` 批量过滤（不就地改入参）：留下目标文件的组和用例，并给出「组名 → 哪些文件」的归属；`filterGroups()` 是单文件版本 |
| `lib/results.mjs` | 从 maa-tools 的输出里逐组判定通过/失败，再按归属汇总成逐文件结论；`RESULT-FILE:` / `RESULT-CASE:` 行格式也在这里；`locateCaseFailures()` 把 `error_details.json` 的条目分发到具体用例下标 |
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
  --file <测试 json> [--file <测试 json> ...] \
  [--case <用例下标，从 0 开始>] \
  [--dry-run]
```

- `--file` 可以重复：多个文件就是**批量跑**，一次进程跑完，省掉每个文件重新准备 MaaFW 的固定开销。
- 不传 `--case`：跑目标文件里的全部用例；批量跑时不允许带 `--case`（下标含义会歧义）。
- `--dry-run`：只解析、过滤、检查截图，打印计划；不加载 MaaFW、不执行识别。
- stdout 是人话日志，随后是**逐用例结论** `RESULT-CASE: {json}`（只打失败和被跳过这两类）、**逐文件结论** `RESULT-FILE: <相对路径> pass|fail|error`，**最后一行固定** `RESULT: pass|fail|error|empty`；退出码与最后一行一致。
- 逐用例行 `RESULT-CASE` 的载荷是 `{"file","case","verdict","title","detail":[...]}`：`title` 是面板节点上显示的那一行短标题（例如 `CloudADB-官服 失败`），`detail` 是展开后逐条列出的明细（节点、原因、截图、哪些平台通过）。用 JSON 是因为原因里带空格、逗号和反引号。
- 逐用例原因来自 maa-tools 写的 `cfg.test.errorDetailsPath`（MaaEnd 里是 `tests/maatools/error_details.json`）：条目含 `imagePath`、`node`、`hit`、`detail.{algorithm, box}`。**只有本次运行更新过这个文件才采信**（比 mtime），否则宁可没有原因，也不张冠李戴。
- 运行日志里有一块「平台覆盖」：每个平台涉及多少张截图、缺几张，以及声明了却没有匹配到测试组的 controller（后者多半是 controller 名字写错或 loader 没映射）。缺图必须在日志里显式出现 —— 否则「跳过即通过」会被误读成没问题。
- 逐文件结论怎么来的：`runTest` 只返回整批一个布尔值，所以跑的时候把 stdout 抄一份，按「组名行 = 该组开始、行首两空格 = 该组有失败明细」判定每组，再按 `owners`（组名 → 文件）分发到文件。相关纯函数都在 `lib/results.mjs`，有单测。
- 文件级结论还会被两条规则覆盖成 `error`：该文件一张截图都不存在、或它在过滤后一个组都没匹配到 —— 这两种情况下「通过」是假的。
- 脚本自己不做「静默降级」：缺少 `--workspace`/`--file`、配置文件加载失败、目标文件不存在、截图一张都不存在、MaaFW 起不来，全部按前置错误报出来。

## 为什么一批文件合成一次进程

`runTest` 的固定开销（配置加载、`setupMaa` 准备 MaaFW、加载 `assets/`）按进程算，跟跑了几个文件无关。实测本机（8 核、maa-tools 默认 2 个 worker）：

| 场景 | 耗时 |
| --- | --- |
| dry-run（只加载配置 + 过滤 + 检查截图，不跑识别） | 0.56 秒 |
| 单个文件（2~3 条用例） | 4~5 秒 |
| 10 个文件（Common/Button 全目录）批量 | 5.3 秒 |
| 同 10 个文件逐个进程跑 | 约 45 秒 |
| 全仓 47 个文件 / 1491 个识别任务，批量 | 与 `pnpm test` 同量级（同一批任务、同样 worker 数） |

所以逐文件起进程时，几十个文件里有 2~3 分钟是纯重复开销；合成一批后这份开销只付一次。代价是逐用例结论要靠解析输出和错误明细（见下一节），单条用例仍然单独起进程以保证精确。

## 逐用例结论怎么产生

1. 跑的时候把 stdout 抄一份，按「组名行 = 该组开始、行首两个空格 = 该组有失败明细」判定每组通过与否（`attributeGroupResults()`）；
2. 过滤阶段就记了 `owners`（组名 → 哪些文件），据此把组结论分发到文件（`aggregateFileResults()`）；
3. 逐用例原因读 `error_details.json`（`imagePath`、`node`、`hit`、`detail.{algorithm, box}`），用「组的 `imageRoot` + 用例图片名」推期望路径去匹配条目，再用**用例自己写的期望**重判一遍（该命中没命中 / 不该命中却命中 / 框超出范围），并顺带统计这条用例在哪些平台跑过、哪些失败、哪些缺图（`locateCaseFailures()` + `formatCaseFailure()`）。

只有本次运行确实更新过 `error_details.json` 才采信（比 mtime），否则宁可没有原因，也不张冠李戴。

## 退出码 → 扩展行为

| 退出码 | 来源 | `NodeTestRunner`（CodeLens / 命令） | `NodeTestExplorer`（测试面板） |
| --- | --- | --- | --- |
| `0` | 全部用例通过 / dry-run 有匹配 | 弹「通过」提示（dry-run 不弹） | 标记 passed |
| `1` | 有用例断言失败 | 弹「失败」+「打开错误详情」按钮 | 标记 failed，提示看输出与 `error_details.json` |
| `2` | 前置错误（参数、配置、截图全缺、MaaFW） | 弹「没能跑起来」+「查看输出」 | 标记 **errored**（不是 failed）；有逐用例失败行时仍按行标记 |
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
<img src="file:///…" alt="ADB / Official_CN" width="400" height="225">

**CloudADB / Official_CN** · 缺失
```

- 平台/资源组合来自扫描 `maaNodeTest.testsetDir`，不写死；
- 行尾两个空格是 Markdown 硬换行，让图片紧跟描述；
- 一个都没找到时只给一句人话提示（「没有任何平台包含 xxx.png…」），不铺空表格；
- URI 里的括号要转义成 `%28`/`%29`，否则文件名带括号时链接会断。
- **图片用 `<img>` 才能控制尺寸**：Markdown 图片语法没法指定大小，1280×720 会按原样铺开，占掉大半个悬浮框。宽度取 `maaNodeTest.hoverImageWidth`（默认 400），高度按 PNG 原比例算（读不出尺寸就不写 `height`）。用 HTML 的前提是 provider 里 `MarkdownString.supportHtml = true`，这个已经设了。
- **声明了但扫描不到的平台要单独写出**：扫描只列存在的平台目录，本文件 `configs.controller` 里有、测试集里没有的，会补一行「`<testsetDir>` 下没有这个平台的目录」。名字对不上（loader 里的映射和目录名不同）也会落到这一行，这是有意的：宁可多一句提示，也不要静默忽略。
- 把宽度设成 `0` 会回落到 `![](uri)` 的 Markdown 语法 —— 这是留给「某天 HTML 渲染出问题」的开关，别删。

## 测试面板语义

- **发现**：`findFiles` 扫 `test_*.json` 与 `test_*.jsonc`，按 `isTestFilePath()` 过滤；按相对路径排序后用 `folderSegments()` 建「目录 → 文件 → 用例」三层树（`tests` 这层省略，目录灰字是「含 N 个测试文件」）。JSON 坏掉的跳过并 `console.warn`，不影响整个面板。保存文件后 300ms 防抖刷新。
- **探测阶段就报缺图**（`reportMissingImages()` + `core/missingImages.ts`）：刷新时对每个用例算「本文件声明的平台里，哪些没有这张截图」，然后（1）在 `image` 值上画 Warning 级诊断（`DiagnosticCollection("maaNodeTest")`），（2）把「缺 ADB、CloudADB 截图」拼进用例节点的 description。这样写用例的时候就知道声明了却没截图，不用等跑完 —— 跑完 maa-tools 会把缺图的用例当通过。整个扫描对 48 个测试文件实测约 60ms（同一图片名的扫描结果按名字缓存），可以放心跟着刷新走。
- 缺图诊断只判断「某些声明平台没有这张图」，不做资源服（`Official_CN` 之类）的匹配 —— 测试集的一级目录是平台，二级目录是资源，而用例声明的 `configs.resource` 是显示名（`官服`），两者没有对应关系可依赖。
- **节点的身份**：每个叶子节点（文件、用例）登记在 `leaves: Map<id, {filePath, relativePath, caseIndex?}>` 里，运行时只认这张表，不靠解析 id 字符串 —— 目录节点因此不需要挂 uri，也不会被误当成可运行的东西。
- **运行**：`collectTargets()` 递归遍历选中的节点 —— 没有 `include`（Run All）时取全部叶子；目录节点展开成它下面所有文件；文件节点就是它自己；用例节点只跑那一条。同一文件既有整文件又有单用例时，整文件优先去重。结果分成两类：**文件级目标合成一次进程**（解析 `RESULT-FILE` 行逐文件标记），**用例级目标各自一次进程**（退出码即结论）。
- **串行**：多个目标用一个 promise 队列逐个跑，避免同时起一堆 MaaFW。
- **取消**：`CancellationToken` → `process.cancel()`，被取消的标 skipped。
- **结果标记**：文件节点用 `**短标题**` + Markdown 列表（明细来自 `RESULT-CASE`）；有逐用例信息时子用例各按自己的结论标记，没被点名的按通过处理；一条逐用例信息都没有时，子用例跟随文件结论。
- **「文件通过」不等于「每条都验证过」**：声明的平台缺图时 maa-tools 会跳过该用例并判通过，文件也就没有断言失败。所以标记规则单独抽成了 `core/testResult.ts` 的 `planFileMarking()`：只要有用例没验证到，文件节点标成 errored（标题「N 条用例没有验证到」），子用例各自标 —— 不允许「文件通过 → 子用例全绿」。
- **单条用例运行**：各自一次进程，退出码即结论，失败文案同样优先用 `RESULT-CASE` 给的原因。

## 换一个仓库来用要改什么

插件的机制是通用的（`maa-tools` 的节点测试），默认值是 MaaEnd 的。换到别的仓库一般只改设置：

| 设置 | MaaEnd 的值 | 换仓库时 |
| --- | --- | --- |
| `maaNodeTest.configPath` | `maatools.config.mts` | `maa-tools` 的默认约定，通常不用改 |
| `maaNodeTest.testsetDir` | `tests/MaaEndTestset` | 指到那个仓库的测试集目录 |

如果那个仓库的 `tests/scripts/loader.mts` 用了别的组名拼法（不是 `(controller-resource)name`）或者 `imageRoot` 不是 `controller/resource`，`runner/lib/filter.mjs` 的收窄条件要跟着改 —— 这是本项目唯一「贴着 MaaEnd 写」的地方。

## 设置项

| 设置 | 默认 | 用途 |
| --- | --- | --- |
| `maaNodeTest.nodePath` | `node` | 跑测试的 node，要求 22+ |
| `maaNodeTest.configPath` | `maatools.config.mts` | 认定仓库根；runner 的 `--config` |
| `maaNodeTest.testsetDir` | `tests/MaaEndTestset` | hover 扫描截图的根目录 |

## 补全

- **数据来源全是仓库自己的**：`controller` / `resource` 取自 `tests/scripts/loader.mts` 的映射表（不写死名字，`Win32-Front` 这种别名也会出现，detail 里标出它对应哪个截图目录）；`image` 取测试集里真实存在的 png，按本文件 `configs.controller` 换算成目录后收窄；`hits`（含 `{node: ...}` 写法）取 `assets/resource/pipeline/**` 的顶层键。
- **判断光标在哪一层用 `jsonc-parser` 的 `getLocation`**，别自己扫文本。有个坑：**在写键时它会把「已经敲进去的半截键名」当成最后一个路径段**（`{"configs": {` → `['configs','']`），所以 `completionContextAt()` 在 `atKey` 时 `path.pop()` 一次，路径才是「光标所在的那个对象」。
- **拿不准就不给候选**：`name`、`imageRoot`、`box` 这些没有可枚举取值的字段返回空数组，宁可不弹也别给错的值。
- **插入文本看上下文**：光标已经在字符串里（`inString`）就只插内容，否则连引号一起插。
- **缓存**：loader 映射按 mtime 缓存；截图列表按各平台目录 mtime 合成戳；节点索引懒加载、缓存 10 秒，并且**按文件 mtime 增量重建** —— 421 个 pipeline 文件首次约 340ms（6082 个节点），文件都没改时重建只要 6ms。不触发补全就不会扫。
- **节点注释照参考实现（maa-support-extension）的做法**：补全候选只带节点名，`resolveCompletionItem` 展开时才去查注释（`documentation = desc + Reco/Act + 定义位置`），不给 6082 个候选预先拼字符串。
- **别名一致性**：`loaderMaps.resolveControllerDir()` 是唯一的换名入口，缺图检查和悬浮也走它 —— 否则 `Win32-Front` 会被误报成「测试集里没有这个平台的目录」。
- **loader 解析用正则**：只取两个对象字面量的键值，注释掉的条目要剔除（loader 里常用注释占位）。别为了 4KB 文件引入 TypeScript 解析器。

## 节点注释与跳转

`hits` 里的节点名有三处能力，数据都来自 `core/pipeline.ts` 解析出的节点索引：

| 场景 | 表现 | 实现 |
| --- | --- | --- |
| 内联提示 | 节点名后面贴一句 `desc`（压成一行、最多 32 字），点一下跳到定义 | `providers/inlayHints.ts`，只处理可见范围内的 | 
| 补全（展开候选） | `desc` + `Reco: X · Act: Y` + `定义在 \`path:line\`` | `resolveCompletionItem` 懒填 |
| 悬浮节点名 | 名称 + `path:line`，`desc`、Reco/Act，**节点源码 JSON 片段**（超过 40 行截断） | `providers/hover.ts` 的 `nodeHover()` |
| Ctrl+Click / F12 | 跳到节点名在 pipeline 文件里的位置 | `providers/inlayHints.ts` | `hits` 节点名后面的注释（`desc`），点击跳定义 |
| `providers/definition.ts` |

- 三种能力都只认 `cases[n].hits[m]` 和 `cases[n].hits[m].node` 这两个路径（`isHitsEntryPath()`），在 `name`、`image` 里点到同名文字不跳也不弹；
- 节点名写错时：悬浮说「pipeline 里没有这个节点」，跳转给空；
- 识别/动作的取值要兼容两种写法：字符串（`"recognition": "TemplateMatch"`）和对象（`{"type": "TemplateMatch"}`），没写就退回 `custom_recognition` / `custom_action`；
- 源码片段按 `keyOffset` 到 `endOffset` 从原文截，所以悬浮里看到的就是 pipeline 里真实的那一段，不是重新序列化的结果；
- 内联提示的开关是 `maaNodeTest.hitsInlayHints`（默认开）。位置取节点名字符串的末尾，紧跟原文；目标文件位置按索引里的行号算，点击用 `vscode.open` + `selection`，不需要先打开目标文件；
- 内联提示只对**能解析出 `desc` / `focus` / 识别方式**的节点出现，也只在 `hits` 里出现，写错的节点名不提示（免得满屏噪音）；
- 悬停里的图片、节点合并结果这些参考实现有的东西**没做** —— 那是给 pipeline 编辑器看的，节点测试只需要「这是哪个节点、它想识别什么」。

## 单测地图

| 单测 | 覆盖 |
| --- | --- |
| `src/core/document.test.ts` | 解析真实形态（注释、尾逗号）、offset 切片、configs 两种写法、image 键/值命中、坏 JSON |
| `src/core/testset.test.ts` | 平台/资源扫描、按平台找图、PNG 尺寸、目录不存在 |
| `src/core/hover.test.ts` | hover 命中/缺失/测试集不存在/无平台目录 |
| `src/core/lens.test.ts` | CodeLens 条数与命令参数 |
| `src/core/runnerArgs.test.ts` | 参数拼装（有/无 `--case`、`--dry-run`）、命令行转义、标题 |
| `src/core/testExplorer.test.ts` | 测试面板节点 label 回退、id 稳定、range 覆盖用例对象 |
| `src/core/testResult.test.ts` | 结论行解析、坏载荷、退出码映射、文件/用例文案、Markdown 列表 |
| `runner/lib/*.test.mjs` | 用例键、过滤四条规则（含批量归属）、参数非法输入、`--case` 越界、截图路径与统计、PNG、RESULT 映射、逐用例失败分类与平台统计 |

## 目录结构

```text
maa-node-test/
├─ package.json          # 扩展清单：命令、设置项、激活事件
├─ icon.png              # 扩展图标（512×512），取自 MaaEnd 仓库 assets/locales/MaaEnd-Tiny.png
├─ tsconfig.json
├─ src/
│  ├─ extension.ts       # 只做装配：输出面板、provider、命令
│  ├─ config.ts          # 读设置、解析仓库根
│  ├─ runner.ts          # 起 runner 进程、收输出、按退出码提示
│  ├─ testing.ts         # 测试面板：发现用例、运行、结果标记
│  ├─ providers/         # CodeLens 与 hover 的薄适配层
│  └─ core/              # 纯函数：解析测试文件、扫截图、拼 hover 文本、拼参数、解析结论行
└─ runner/
   ├─ run-single-test.mjs # 入口：一批文件或其中一条用例
   └─ lib/                # 参数、用例键、过滤、结果判定、截图预检、PNG 尺寸、退出码
```

`src/core/` 不 import `vscode`，所以能直接在 Node 里跑单测；`runner/` 是独立的 ESM 脚本，不依赖插件进程，也能在终端里手动跑。

## 自查命令

```bash
pnpm run check        # 类型检查（tsc --noEmit）
pnpm run compile      # 编译到 out/
pnpm test             # 扩展纯函数单测
pnpm run test:runner  # runner 单测
pnpm run test:all     # 上面三件事一起
```

格式化沿用 MaaEnd 仓库的 prettier 配置（本仓库不重复写一份）：

```bash
~/dev/MaaEnd/node_modules/.bin/prettier --config ~/dev/MaaEnd/.prettierrc.mjs \
  --write "package.json" "tsconfig.json" ".vscode/*.json" "src/**/*.ts" "runner/**/*.mjs"
~/dev/MaaEnd/node_modules/.bin/markdownlint .
```

`maa-node-test.code-workspace` 刻意排除在格式化之外（`.prettierignore` 里有说明）：它是纯 JSON，不能带尾逗号。

手动在终端里跑（不加载 MaaFW，几秒出结果）：

```bash
node runner/run-single-test.mjs --workspace ~/dev/MaaEnd \
  --file tests/Common/Button/test_close_button.json --dry-run
```

真实跑一条用例，或者批量跑一个目录：

```bash
node runner/run-single-test.mjs --workspace ~/dev/MaaEnd \
  --file tests/DeliveryJobs/test_region.json --case 0

node runner/run-single-test.mjs --workspace ~/dev/MaaEnd \
  --file tests/Common/Button/test_close_button.json \
  --file tests/Common/Button/test_change_region_button.json
```

## 构建与发布

### 为什么要用 esbuild 打包

发布前必须把扩展和 runner 各自打成一个文件，原因是 vsce 的工作方式：

1. vsce 判断「要带哪些生产依赖」靠的是 `npm list`。仓库用 pnpm，`node_modules` 是软链接树，`npm list` 会报一堆 missing（`math-intrinsics`、`dunder-proto` 之类），打包直接失败；换 `--no-dependencies` 又不会把依赖放进包，装到 VS Code 里就会 `Cannot find module 'jsonc-parser'`。
2. 把运行时依赖打进 `dist/` 之后，`package.json` 里没有 `dependencies`，vsce 不需要解析依赖，包也更小。

两个产物（`scripts/bundle.mjs`）：

| 产物 | 格式 | 说明 |
| --- | --- | --- |
| `dist/extension.js` | CommonJS | 扩展入口，`package.json` 的 `main` 指向它；`vscode` 必须 external |
| `dist/run-single-test.mjs` | ESM | runner 入口，扩展 spawn 的就是它；终端里也能直接跑 |

两个容易踩的点：

- **`jsonc-parser` 必须用 esm 版**：它的 umd 版在运行期 `require("./impl/xxx")` 懒加载，打不进包，会报 `Cannot find module './impl/format'`。所以 bundle 里设了 `mainFields: ["module", "main"]`。
- **runner 是 ESM 且有顶层 await**，不能改成 CommonJS。

顺带记一笔：rolldown 1.2.15 实测同样会踩 `jsonc-parser` 的 umd 坑，产物大小和构建时间与 esbuild 基本一致（我们这两个入口，esbuild 约 15ms / 79KB + 69KB，rolldown 约 40ms / 79KB + 70KB）。它擅长的是多入口拆包、Rollup 插件生态、生成 .d.ts，这些我们目前都用不到，所以先留在 esbuild。

### VSIX 里有什么

`.vscodeignore` 只留五类东西：`package.json`、`README.md`、`icon.png`、`dist/**`、`LICENSE`（有的话）。`src/`、`out/`、`runner/`、`scripts/`、`.github/`、`.agents/`、`pnpm-workspace.yaml` 都不进包。打出来的包约 127KB、9 个文件，解包后**没有 node_modules**也能跑（已验证：从解包目录直接执行 `dist/run-single-test.mjs` 正常）。

### 本地怎么打包

```bash
pnpm run build      # tsc 编译到 out/（单测用） + esbuild 打包到 dist/
pnpm run package    # 打 VSIX 到 dist/maa-node-test-<版本>.vsix
code --install-extension dist/maa-node-test-0.1.0.vsix
```

`pnpm run package` 会自动先跑 `vscode:prepublish`（= `pnpm run build`）。`.vsix` 和 `dist/` 都在 `.gitignore` 里。

### CI 工作流

| 工作流 | 触发 | 做什么 |
| --- | --- | --- |
| `.github/workflows/test.yml` | push / PR 到 `main` | `pnpm install --frozen-lockfile` → 类型检查 → 两个单测套件 → 试打包 VSIX → 上传 artifact |
| `.github/workflows/release.yml` | 打 `v*` 标签 | 核对标签与 `package.json` 版本一致 → 类型检查 + 单测 → 发布到 VS Marketplace → （可选）Open VSX → 建 GitHub Release 并附 vsix |

需要的 secret：

| secret | 用途 | 不给会怎样 |
| --- | --- | --- |
| `VS_MARKETPLACE_TOKEN` | 发布到 Visual Studio Marketplace 的 PAT（要带 Marketplace 的 Manage 权限，且账号能访问 `MaaEnd` 这个 publisher） | 发布那一步直接失败 |
| `OPEN_VSX_TOKEN` | 发布到 Open VSX（VSCodium 用户） | 那一步自动跳过 |

### 发版步骤

```bash
pnpm version patch    # 或 minor / major：改版本号并打 v0.1.1 这样的标签
git push --follow-tags
```

标签必须是 `v` 开头并和 `package.json` 的版本号一致，否则 release 工作流会在核对那一步停下（防止把错的版本发出去）。

### pnpm 的构建脚本白名单

pnpm 12 把「允许哪些依赖在安装时跑脚本」放在 `pnpm-workspace.yaml` 的 `allowBuilds` 里（`package.json` 的 `pnpm` 字段已经无效）。当前配置：`esbuild: true`（它要装二进制）、`@vscode/vsce-sign: false`（只在签名发布时用，我们不用）。不加这个的话 CI 的 `pnpm install` 会以 `ERR_PNPM_IGNORED_BUILDS` 失败。
