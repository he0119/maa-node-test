# 参考：对接与内部细节

[SKILL](SKILL.md) 说明修改与验证步骤，这里记录文件职责、maa-tools 接口、结果显示、编辑辅助和构建发布。用户用法见 [README](../../../README.md)。

## 文件职责

下表逐个列出 `src/` 中的生产文件；测试和构建入口见[验证](#验证)。文件职责集中维护在这里，源码注释解释局部约束或容易误解的行为。

| 文件 | 职责 |
| --- | --- |
| [extension.ts](../../../src/extension.ts) | 装配输出面板、运行器、测试面板、版本状态栏和编辑辅助，注册命令；管理仓库索引与后台预热，停用时清理 |
| [config.ts](../../../src/config.ts) | 读取 `maaNodeTest.*` 设置，选择被测工作区，解析配置路径和编辑辅助截图根目录 |
| [testRunner.ts](../../../src/testRunner.ts) | 提供共用的 `startTestRun()`，管理活动运行与取消；`NodeTestRunner` 处理命令和 CodeLens 的输出、运行数量状态栏及提示 |
| [testController.ts](../../../src/testController.ts) | `NodeTestExplorer` 管理 VS Code 测试树、收集刷新、运行队列、范围与排除、取消、缺图诊断，以及逐文件和用例标记 |
| [toolVersionStatus.ts](../../../src/toolVersionStatus.ts) | `MaaToolsVersionStatus` 管理左侧版本状态栏、版本查询与兼容提示、依赖监听、自动刷新和迟到结果保护 |
| [maatools/command.ts](../../../src/maatools/command.ts) | 保存默认配置文件名，生成收集与运行参数；`quoteArgument()`、`formatCommandLine()` 生成供人查看的命令文字，不参与实际参数传递 |
| [maatools/installation.ts](../../../src/maatools/installation.ts) | 定位被测仓库安装的命令入口，读取包版本并检查支持范围，提供状态栏的命令版本查询和来源说明 |
| [maatools/process.ts](../../../src/maatools/process.ts) | `runChild()` 启动子进程，按 UTF-8 读取标准输出，支持单份 JSON 或逐行消费，转发 stderr，记录退出码、信号和读取错误；收集与运行直接共用 |
| [maatools/collect.ts](../../../src/maatools/collect.ts) | `collectTests()` 接收 `TestCollectionRequest`，执行 `test --list --json`，检查收集清单及错误，并转换显示路径 |
| [maatools/run.ts](../../../src/maatools/run.ts) | `startMaaToolsRun()` 接收 `MaaToolsRunRequest`，编排一次 `test --jsonl` 的启动、取消、记录校验、最终对账、结果转换和日志输出；对外提供 `MaaToolsRun*` 类型 |
| [maatools/protocol.ts](../../../src/maatools/protocol.ts) | 定义收集、事件、运行报告及 `FileVerdict`、`CaseOutcome` 等机器数据类型；在读取边界检查必需结构、记录 `type`、来源、选择范围、覆盖与汇总一致性 |
| [maatools/progress.ts](../../../src/maatools/progress.ts) | `RunProgress` 保存已开始和已完成事实，相同重复去重、矛盾检查、最终对账，并提供取消或异常时可保留的完成结果 |
| [maatools/resultAdapter.ts](../../../src/maatools/resultAdapter.ts) | 将已校验的上游文件和用例结果转换为显示数据，翻译原因，整理平台明细、耗时及面板文案；使用上游结论 |
| [maatools/output.ts](../../../src/maatools/output.ts) | 将平台覆盖、实际缺图路径、文件结果和有问题的用例排成中文日志 |
| [core/completion.ts](../../../src/core/completion.ts) | 根据光标处的 JSON 路径和注入的仓库数据生成字段、控制器、资源、截图及节点候选，决定插入文本是否需要引号 |
| [core/controllerResources.ts](../../../src/core/controllerResources.ts) | 解析 interface 文本中的控制器附加资源路径，规范目录名，按控制器选取编辑辅助需要扫描的资源目录 |
| [core/document.ts](../../../src/core/document.ts) | 宽松解析编辑器文本中的配置、用例、图片字段和字符范围，定位图片字段并识别测试文件路径；这些解析结果只服务编辑辅助 |
| [core/hits.ts](../../../src/core/hits.ts) | 解析 `hits` 条目及位置，判断光标路径是否为节点条目（`isHitsEntryPath()`），并压缩内联注释文字 |
| [core/hover.ts](../../../src/core/hover.ts) | 根据截图查找结果生成预览 Markdown、尺寸、平台顺序和缺图说明；图片 URI 的转换由宿主传入 |
| [core/lens.ts](../../../src/core/lens.ts) | 保存运行命令标识，根据编辑文本解析结果生成文件和单条用例的 CodeLens 位置、标题与参数描述 |
| [core/loaderMaps.ts](../../../src/core/loaderMaps.ts) | 解析 loader 文本中的控制器、资源字符串映射，通过 `dirOf()`、`resolveControllerDir()` 解析编辑辅助的截图目录别名 |
| [core/missingImages.ts](../../../src/core/missingImages.ts) | 根据注入的截图查找结果，比较声明控制器并生成缺图警告、字符范围与短说明 |
| [core/paths.ts](../../../src/core/paths.ts) | 按系统规则规范路径身份、匹配与去重，解析相对仓库的请求路径，生成保留大小写的显示路径 |
| [core/pipeline.ts](../../../src/core/pipeline.ts) | 解析 pipeline 文本中的节点定义位置、注释、识别及动作说明，生成节点摘要 |
| [core/png.ts](../../../src/core/png.ts) | 从字节数据解析 PNG 尺寸；`readPngSizeFromFile()` 只读取文件头，供截图扫描直接使用 |
| [core/repoIndex.ts](../../../src/core/repoIndex.ts) | 读取被测仓库的 loader、interface、截图目录和 pipeline 文件，按修改时间及有效期缓存编辑辅助索引，提供候选、定义和节点说明 |
| [core/runSummary.ts](../../../src/core/runSummary.ts) | `buildRunTitle()`、`buildBatchRunTitle()` 生成运行标题；根据明确的逐用例状态生成末尾摘要、计数和耗时文字 |
| [core/screenshots.ts](../../../src/core/screenshots.ts) | 扫描编辑辅助的一级平台、二级资源目录，查找同名截图并直接读取 PNG 尺寸；按声明控制器顺序排列查找结果 |
| [core/testMarks.ts](../../../src/core/testMarks.ts) | 生成文件和用例的标记计划、缺项错误、短标题及 Markdown 消息；不创建 VS Code 对象或重新判定识别结果 |
| [core/testTree.ts](../../../src/core/testTree.ts) | 将收集清单转换为稳定节点身份、目录、标题和源码范围描述；`collectRunTargets()` 按树关系与排除项选择运行目标 |
| [core/toolStatus.ts](../../../src/core/toolStatus.ts) | 检查版本字符串，生成版本状态栏标题和完整来源提示文字；不执行版本查询 |
| [providers/codeLens.ts](../../../src/providers/codeLens.ts) | 声明编辑辅助的测试文件选择范围，将 CodeLens 描述转换为 VS Code 位置、命令参数和 `CodeLens` 对象 |
| [providers/completion.ts](../../../src/providers/completion.ts) | 将光标位置和仓库索引交给补全计算，转换为 VS Code 补全项，展开节点候选时再读取说明 |
| [providers/definition.ts](../../../src/providers/definition.ts) | 将图片字段及 `hits` 节点转换为 VS Code 定义位置；多处截图或节点定义返回列表 |
| [providers/hover.ts](../../../src/providers/hover.ts) | 将图片预览和节点说明转换为 VS Code 悬浮对象，处理图片 URI、HTML 支持、悬浮范围和节点源码片段 |
| [providers/inlayHints.ts](../../../src/providers/inlayHints.ts) | 按设置与可见范围生成 VS Code 内联提示，将节点短注释和跳转命令放到 `hits` 节点名后 |

`core/` 和 `maatools/` 都不导入 `vscode`。文本解析、命令参数和显示数据转换与宿主对象分开；[截图扫描](../../../src/core/screenshots.ts)、[PNG 文件读取](../../../src/core/png.ts)、[仓库索引](../../../src/core/repoIndex.ts)有文件操作，工具安装定位与子进程模块也有外部操作，不能把整个目录称作纯函数。

## 主要调用流程

1. **收集与建树**：[testController.ts](../../../src/testController.ts) 从配置取得被测仓库，调用 `collectTests()`；[collect.ts](../../../src/maatools/collect.ts) 用安装入口和命令参数直接调用 `runChild()`，由协议模块检查清单，再通过 [testTree.ts](../../../src/core/testTree.ts) 生成描述，由宿主创建目录、文件和用例节点。命令面板选择单条用例也使用同一收集入口。
2. **启动运行**：CodeLens 和命令交给 `NodeTestRunner`，测试面板先通过 `collectRunTargets()` 处理范围和排除；二者共用 [testRunner.ts](../../../src/testRunner.ts) 的 `startTestRun()`，再调用 [run.ts](../../../src/maatools/run.ts) 的 `startMaaToolsRun()`。运行模块直接使用进程模块执行 `test --jsonl`，取消沿同一调用链终止子进程。
3. **读取与显示结果**：[process.ts](../../../src/maatools/process.ts) 将 stdout 完整行交给运行模块，stderr 作为日志转发；[protocol.ts](../../../src/maatools/protocol.ts) 与 [progress.ts](../../../src/maatools/progress.ts) 检查事件、最终报告及其一致性。[resultAdapter.ts](../../../src/maatools/resultAdapter.ts) 转换显示数据，[output.ts](../../../src/maatools/output.ts) 排版日志；运行器显示提示，测试面板用标记计划更新节点，并追加 [runSummary.ts](../../../src/core/runSummary.ts) 的摘要。
4. **编辑辅助**：provider 将当前文本、光标位置和设置交给对应的 core 模块；[repoIndex.ts](../../../src/core/repoIndex.ts) 读取并缓存仓库资料，[screenshots.ts](../../../src/core/screenshots.ts) 查图，[png.ts](../../../src/core/png.ts) 读取尺寸。core 返回普通数据或文字，provider 创建 VS Code 对象；这些结果不决定实际收集范围或测试结论。
5. **工具版本**：[toolVersionStatus.ts](../../../src/toolVersionStatus.ts) 根据配置和依赖变化调用安装模块查询版本，由 [toolStatus.ts](../../../src/core/toolStatus.ts) 生成文字，再更新状态栏与兼容提示；二者共用查询结果。

测试树的文件灰字只保留组名，未命名时留空；用例标题优先取非空 `name`，否则用截图名或原始序号。普通用例不加描述，负例、缺少截图名、缺图和读取失败保留短提示；树节点不设置额外 tooltip。控制器、资源及预期节点详情在源文件和运行输出中查看，不在每行重复。

## 为什么使用仓库里的 maa-tools

扩展不自带 `@nekosu/maa-tools` 副本，只调用：

```text
<被测仓库>/node_modules/@nekosu/maa-tools/bin/maa-tools
```

仓库配置、命令行测试和编辑器测试使用同一版本的工具，减少版本差异；MaaFramework 的版本与准备方式由该仓库配置决定。实际识别结果还受配置、资源和框架版本影响，使用同一工具并不是“两处结果必然一致”的保证。

找不到入口时明确报错。`collectTests()` 与 `startMaaToolsRun()` 都在 `findMaaToolsCli()` 后调用 `requireSupportedMaaTools()`，从该安装包的 `package.json` 取得版本并在启动命令前检查支持范围，不为每次操作额外执行 `--version`。包版本通过后仍须检查启动、退出与实际返回的数据。安装命令不会自动突破锁文件，升级提示应引导检查依赖声明、锁文件和实际安装的版本。

## 包版本与 JSON 兼容

插件只接受稳定版 `>=1.2.0 <2.0.0`。版本号可带 `v` 前缀或构建元数据，例如 `v1.2.0+local.1`；预发布版、未知或格式无效的版本，以及低于下界或达到上界的版本均拒绝。安装包声明只用于选择受支持的版本，不能证明命令可以启动或返回可信结果。收集清单、运行报告和逐行记录按必需结构、合法 `type`、来源、所选下标、结果覆盖及进度与最终报告一致性严格校验。

JSON 兼容性随 maa-tools 包版本管理。1.x 内可以增加调用方无需处理的可选字段；改名、删除必需字段、改变字段类型或结论语义，以及增加调用方必须处理的新记录 `type` 或枚举值，都属于不兼容变更，须发布新主版本。新主版本要等插件明确支持后才接收。

## 工具版本状态栏

`MaaToolsVersionStatus` 使用左侧 `StatusBarItem`，与 MaaSupport/MaaFramework 一样省略优先级参数，使用 VS Code 默认优先级。运行器显示运行数量的状态项使用 priority 100。版本查询与兼容提示共用结果。

- 被测仓库有配置或 maa-tools 包时常显，编辑普通文件也显示；无工作区，或普通项目两者都没有时隐藏。
- 正常标题为无图标的 `maa-tools <版本>`；查询中、未安装、版本不受支持和查询失败均显示对应文字。
- 优先使用 `maa-tools --version`，与兼容提示共用查询结果。命令查询失败时，安装包版本只供说明版本范围与排错；包声明在支持范围内也只能显示未确认，不能据此确认命令可运行。实际收集与运行的包版本检查独立于这项显示查询。
- 点击整项执行 `maaNodeTest.refreshToolVersion`，只查询、不运行测试或打开新面板。悬浮提示保留版本来源、支持范围、仓库、命令入口、软链接实际文件、Node、配置和失败原因。
- 工作区、`nodePath`、`configPath`、配置文件、相关包清单与锁文件、工具入口及安装位置变化后刷新，也监视软链接实际目标。
- 查询与防抖刷新有序号，旧结果不能覆盖新状态；停用时清理定时器、监听和状态栏项。

## 测试定义与来源

收集和运行均加载同一份配置并展开 `test.cases`；它可以是数组或异步函数。收集只省略 MaaFramework 初始化与识别，不绕过 loader，也不固定扫描某个目录来代替配置。

只支持文件测试。展开后的 `TestCases.cases.origin` 与平台结果 `TestCaseRunResult.origin` 在类型和运行时都必填，内容为 `origin: {file, case}`：`file` 是实际测试 JSON 文件的规范化绝对路径，`case` 是源文件 `cases` 数组的原始下标，须为非负安全整数。普通测试 JSON 写 `name`、`image`、`hits` 等字段，不用手写 origin；`loadTestCases()` 和 `loadAllTestCases()` 共用文件读取与结构校验，自动补齐来源。自定义 loader 展开控制器或资源时必须保留它，例如复制用例时保留 `...testCase`；动态生成的展开对象也须关联实际文件和原始下标。

收集仅列出实际进入配置展开结果的文件与原始下标，不把“曾被读取但配置主动排除”的有效文件当成可运行测试。读取失败的文件保留 `error` 条目，供面板单独报错。缺少、格式无效或无法对应文件元数据与原始下标的 origin 在加载计划阶段报 `test-source-invalid`，不能进入识别。组名只用于显示，重复组名、相同截图、相同节点或不同期望框不构成来源依据。

## 命令接口

所有命令以被测仓库根为工作目录：

```bash
node node_modules/@nekosu/maa-tools/bin/maa-tools test --list [配置路径]
node node_modules/@nekosu/maa-tools/bin/maa-tools test --list --json [配置路径]
node node_modules/@nekosu/maa-tools/bin/maa-tools test --jsonl --file <测试路径> [--file <另一文件>] [配置路径]
node node_modules/@nekosu/maa-tools/bin/maa-tools test --jsonl --file <测试路径> --case 0 [配置路径]
node node_modules/@nekosu/maa-tools/bin/maa-tools test --json --file <测试路径> [配置路径]
node node_modules/@nekosu/maa-tools/bin/maa-tools --version
```

- 非默认 `configPath` 同时传给收集与运行。`testsetDir` 是编辑辅助设置，不传给运行以覆盖框架图片路径。
- `--file` 按规范化绝对来源匹配，可重复；相对路径相对命令工作目录。Windows 匹配、去重与进度及最终对账忽略来源路径大小写，其他系统区分大小写；显示路径保留原有大小写。
- `--case` 为文件内原始下标，从 0 开始，可重复选择多条，但必须配单个文件。CLI 要求完整的非负十进制安全整数；越界属于参数错误。
- 控制器、资源和来源过滤取交集。展开时先固定完整待检查节点，选择单条不会删除该组其他节点的“不应命中”检查。
- `--list` 选择收集，`--json` 选择格式，可组合：单独 `--list` 显示人类列表，扩展用 `--list --json` 读取一份清单。两种列表都不初始化 MaaFramework。
- 默认运行输出文本，`--json` 输出完整运行 JSON，`--jsonl` 输出进度并以唯一 `run-result` 结束。`--json` 与 `--jsonl` 互斥；`--list` 不支持 `--jsonl` 或 `--case`。
- 所有收集及机器格式输出都从配置加载前把 JavaScript 日志转到 stderr。单独 `--list` 的错误不输出 JSON，组合 `--list --json` 保留完整错误 JSON；含 `--jsonl` 的非法组合仍以 `run-result` 错误报告结束。`--version` 输出普通版本字符串。
- 扩展转发 stderr，但不从日志行、退出码或错误明细文件推算逐用例结论。命令、配置或结果错误依靠结构化错误代码与说明区分。

## 收集结果

`--list --json` 成功收集的顶层为 `{files: [...]}`。收集失败含 `errorCode`、`reason`，CLI 顶层错误结果还带 `status: 'error'` 和 `durationMs`；可以保留已经识别的文件。单独 `--list` 将同一结果显示为文件、原始下标、名称或截图、文件错误及总数，不输出这份 JSON。

| 字段 | 含义 |
| --- | --- |
| `files[].file` | 规范化绝对路径；扩展检查后转换为相对仓库路径显示 |
| `name` | 测试文件组名，缺省为 null；错误条目可省略 |
| `controllers`、`resources` | 源文件声明的控制器与资源，只用于显示；实际运行平台来自配置展开 |
| `cases[].index` | 源文件原始下标，可能不连续，不能用返回数组的位置替代 |
| `cases[].name`、`image`、`hits` | 用例说明、截图名、用于显示的期望节点名 |
| `cases[].start`、`end` | 源文件字符范围，从 0 开始，end 不包含在范围内 |
| `error` | 文件读取或结构错误，作为坏文件显示 |

源码位置对应收集时的磁盘内容。编辑器有未保存修改时，不能假设旧位置仍准确；保存并重新收集后再跳转或运行。

## 运行结果

`--jsonl` 最后记录的 `result` 和普通 `--json` 的整个文档都是完整 `TestRunResult`，包含以下字段：

```text
status: passed | failed | error | empty
files: TestFileRunResult[]
durationMs: number
errorCode?: string
reason?: string
```

`files` 按文件、原始用例和实际平台组织结果明细。框架按执行组展开、固定节点、调度与并行判定，普通文本日志显示组名和结果。

`files[]` 由 maa-tools 汇总，包含元数据、`selectedCases`、`verdict`（pass/fail/error/skipped）、可选 `reason` 和 `cases`。`selectedCases` 是本次计划下标，允许不连续，`cases` 必须完整覆盖它。无文件错误且过滤后本次 cases 为空时，文件为 skipped、reason 为 `no-cases-selected`，两个数组都为空。

扩展严格检查请求范围：指定单条 `caseIndex`，或已知 `expectedCases` 非空时，拒绝这种空的跳过结果。只有未指定单条，且预期下标列表为空或未提供时才可接收；不重读文件猜计划，也不放行有选择却缺结果的报告。

每条文件用例包含收集元数据、`verdict`、`durationMs`、可选 `reason` 和 `platforms[]`。每个平台项含 `controller`、`resource`、`result`；平台结果给出检查明细、单个 `origin` 和结论。已解析图片路径时，`imagePath` 是实际绝对路径；尚未执行的 error 占位结果可以为空字符串，不能当成实际尝试过该路径。控制器及资源是组配置声明值，不是截图目录别名。

每个实际平台用例结果只在 `files[].cases[].platforms[].result` 中出现一次，且必须带有效 origin，与所属文件和用例原始下标一致。

### 判定与验证是否完整

判定由 maa-tools 负责，扩展不从失败或缺图数组重新计算：

| 层级 | 规则 |
| --- | --- |
| 单平台用例 | 检查为 pass/fail，应返回却缺失节点结果也为 fail；缺图为 skipped；没有待检查节点或计划未能执行为 error |
| 跨平台用例 | fail 优先，其次 error；有平台缺图则 skipped；其余为 pass |
| 文件 | 有用例失败时为 fail，其次看文件 error 或用例 error；无文件错误且本次 cases 为空时为 skipped/no-cases-selected；有有效检查且其余仅缺图时可 pass，全缺图无验证仍为 error |
| 整批 | error 优先于 failed，再是 passed；文件错误仍使整批 error，空选择文件不影响其他文件的真实结论，全部过滤为空才为 empty/no-tests-matched |

**用例标灰不等于它在所有平台都没运行。** 例如 A 平台已有有效检查并通过、B 平台缺图，该用例汇总为 skipped，文件可为 pass，同时列明 B 未验证。即使每条用例汇总都是 skipped，也不能只看这个值就断言文件“全缺图”；应直接用框架给出的文件结论。

预期命中和预期不命中的节点都必须返回识别结果。没有结果不能默认为未命中；识别无明细会报错。用例设置了期望框时，识别必须返回实际框，且实际框完整落在期望框内；未设置期望框的用例不做框检查。

扩展检查顶层格式、合法状态、必要字段、文件身份、`selectedCases` 与用例结果的覆盖关系，并对照面板传入的所选下标。缺项或不支持的格式明确报错，不把没返回的用例补成通过。TypeScript 接口只是本地类型说明，读取边界上的值仍需校验。编辑辅助解析和对未知字段的检查不能代替来源结构、类型及文件身份校验。

### 耗时

同组按规范化绝对截图路径复用识别任务。同图被多个所选用例使用时，真实任务耗时在这些用例间分摊，避免同图运行多次或重复累计。用例时间等于其各平台分摊时间之和，文件节点显示所选用例的总时间。顶层 `durationMs` 是运行实际经过的时间，包含准备和等待，不与并行任务时间求和等同。

### 中文失败信息

`describeCheck()` 等显示函数把框架原因翻成中文：期望命中却未命中、不该命中却命中、识别框不符、缺少识别详情、缺失节点结果。原因、实际图片路径和期望框来自运行报告，显示函数只负责转换文案。

## 运行中的即时结果

所有扩展运行固定使用 `--jsonl`，子进程的 stdio 为 `ignore/pipe/pipe`。标准输出每行一个紧凑 JSON，并以换行结束；stderr 是人类日志。`MaaToolsRunHandlers` 和 `TestProcessHandlers` 的可选 `onProgress` 只接收校验后的三类 `TestRunEvent`，不决定输出格式。

记录的 `type` 字段表示事件类型，事件与其结果快照都要通过结构和范围校验：

| type | 其他字段 | 含义 |
| --- | --- | --- |
| `case-started` | `origin` | 第一次提交该原始用例相关识别任务，跨平台只开始一次 |
| `case-result` | `origin`、`result` | 本次实际计划的全部平台完成；result 是仅含该文件这一条原始下标的完整 TestRunResult 快照 |
| `file-result` | `file`、`result` | 文件所有 selectedCases 都有确定结果；快照只含该文件的本次选择范围 |
| `run-result` | `result` | 唯一且最后，包含完整 TestRunResult；由运行入口处理，不传给面板的进度回调 |

框架在每张图的全部节点块完成后立即判定，同图复用用例分别比较自己的期望；来源的最后一个计划平台结束后才发用例结果。缺图、无节点及空选择文件可以直接完成，不伪造识别开始；空文件快照的状态为 skipped/no-cases-selected，并执行范围校验。尚未形成计划的配置错误仅由最终结果说明。框架按资源组和测试组组织计划，组内识别任务并行执行。

文件/用例快照只含对应范围的 `files`，复用最终报告的汇总规则。用例快照按单文件、单原始下标校验；文件快照按该文件的 expectedCases 校验。记录还检查合法 `type`、必需结构、请求来源、原始下标、覆盖、汇总和快照身份，未经校验的标准输出记录不能直接交给面板。

`RunProgress` 保存已开始和已完成事实，相同的重复消息只处理一次，包括完成后重复收到已记录的开始消息。重复结果矛盾、此前未报告开始却在完成后首次报告开始、文件结果遗漏已开始或已完成用例都报协议错误。平台返回顺序不影响比较，但来源、元数据、结论、检查和识别耗时必须一致。

最终结果先通过完整协议校验，再核对已完成的用例与文件；未收到完成事件的项目由最终结果补全。核对对应范围的实际事实，不比较快照的整批状态和实际经过时间与整批最终值是否相同。

取消时只返回已经校验的完成事实：完整文件快照可结束文件，只有单条快照不能说整个文件完成；尚未完成项由面板标 skipped。信号终止等非协议错误也可保留已校验事实，但不能据此判整批通过。

标准输出按 UTF-8 解码并按换行缓冲，支持中文、Windows 换行（CRLF）、一块多行和大行，不能逐个 data 块直接 JSON.parse。完整畸形行、未知记录、重复 `run-result` 或其后再有记录立即按 `invalid-result` 处理；正常退出时，缺少最后报告或残留截断行也报错。

用户取消或信号终止时，尚未完成的末行不覆盖已经校验的完成事实；此前完整行的协议错误仍优先。格式错误或最终对账矛盾会清除可疑的即时通过，同一次调用的所选节点改标 error。

## 面板与运行操作

- 收集结果通过 [core/testTree.ts](../../../src/core/testTree.ts) 生成目录、文件和用例；源码位置由字符偏移转换为行列。坏文件保留读取错误，运行时单独标 error，正常文件继续。
- 叶子信息表记录绝对路径、相对显示路径和原始下标。运行时使用这张表，不解析节点 id 来找测试。
- 没有排除项的文件目标合并为一批，节省重复准备。单条目标各自调用；排除个别用例时，把文件展开为其余所选原始下标，不能仍提交整文件。
- 一次面板运行中的目标依次执行。所选项先标 enqueued；case-started 才标该用例及文件运行中；case-result 立即结束用例，file-result 立即结束文件并补此前未逐条报告的子用例。最终报告只补未完成项，不把已完成项重新标为 started。
- 取消请求传给共用运行入口并终止 maa-tools 子进程。面板保留已校验完成的用例和文件，未完成项标 skipped；摘要只显示取消与耗时，不给部分运行作整批判断。跨平台的子进程退出行为需要分别验证。
- `caseInfoToVerdict()` 使用上游 verdict，只转换中文消息和耗时。`planFileMarking()` 不把无结果的子节点标通过，也不重新覆盖正确的文件判定。
- 摘要统计明确的 pass、fail、error、skipped；筛选跳过单列文件数，缺图跳过按用例计数，缺少结果单列。前置错误不能显示“全部通过”。合法的整批 error 可以保留已经完成的通过/失败结果，但另列“运行错误”并说明整批没通过；格式或完整性不符合要求时，不把不可信的部分结果算通过。原始日志在前、摘要在后；“没有完成验证”与“断言失败”分开表达。
- 并发刷新仅应用最新一次收集；停用后丢弃迟到的收集结果。

## 编辑辅助的范围

[core/document.ts](../../../src/core/document.ts)、[hits.ts](../../../src/core/hits.ts) 和 [completion.ts](../../../src/core/completion.ts) 解析编辑器文本，允许宽松处理注释和未完成内容。maa-tools 读取运行文件时允许注释，不允许尾逗号；两者用途不同，不宣称解析行为完全相同。

图片预览、图片跳转、文件名补全和黄线根据 `testsetDir` 扫描一级平台、二级资源目录，再使用当前文件声明的 `configs.imageRoot` 子目录。省略、空字符串和 `.` 使用原资源目录；支持相对多级目录，拒绝绝对路径、离开资源目录的路径和指向资源目录之外的目录链接。`image` 保持为文件名，指定子目录缺图时不回退到其他目录。文件名索引的修改时间包含所选子目录，缺图扫描缓存同时区分 `imageRoot` 与图片名。

[loaderMaps.ts](../../../src/core/loaderMaps.ts) 只读 `tests/scripts/loader.mts` 中 `controllerMap`、`resourceMap` 的对象字面量字符串，不执行 loader。缺图诊断只比较声明控制器是否有图，不核对资源服；绝对或目录外的 `imageRoot`、带子目录的 `image` 以及动态映射可能与实际运行不同。

因此，运行缺图信息必须使用返回的 `imagePath`，排错应检查配置里的 `cwd`、`casesCwd`、`imageRoot` 和用例 `image`。工作区根不一定是截图根；改变编辑辅助的 `testsetDir` 不改变运行路径。

预览按声明控制器顺序排序，未声明平台接在后面。默认使用 HTML 图片，宽度 400、按比例设置高度，并启用 `MarkdownString.supportHtml`；宽度设 0 时使用原图尺寸。始终保留打开原图链接；文件 URI 中的括号应编码。

节点候选按 `assets/interface.json` 中的控制器资源目录约定收窄，包含基础 `assets/resource`；缺少 interface 时退回扫描 `assets` 中的 pipeline 目录。节点注释取 `desc`、`focus` 和识别/动作说明。只在 `cases[].hits[]` 或其 `.node` 上提供节点跳转与提示；多处定义返回列表，源码片段从原文截取。

[repoIndex.ts](../../../src/core/repoIndex.ts) 按文件修改时间缓存解析结果，按控制器组合缓存资源和节点清单；扩展可后台预热，停用时清理定时器。缓存只改善编辑辅助，不成为测试结果来源。新增缓存应先说明失效条件，不把某次本机速度写成保证。

## 验证

框架测试负责来源、配置展开、选择不改变检查语义、识别判定和汇总；扩展测试负责参数、边界校验、缺项错误、结果转换、面板排除、标记和计数。文案或接口变化同步对应测试，不用固定的测试数代替覆盖说明。

以下命令在插件目录运行，定义见 [package.json](../../../package.json)。按改动范围和分工选择入口，只改文档时检查格式、链接与事实。

| 入口 | 用途与前提 |
| --- | --- |
| `pnpm run check` | 只做 TypeScript 类型检查，不生成产物 |
| `pnpm run compile` | 将源码及单元测试编译到 `out/` |
| `pnpm run bundle` | 通过 [bundle.mjs](../../../scripts/bundle.mjs) 生成扩展运行文件 `dist/extension.js` |
| `pnpm run build` | 依次执行 compile 和 bundle |
| `pnpm test` | 用 Node 测试运行器执行 `out/core/*.test.js` 与 `out/maatools/*.test.js`；先编译，避免测试旧产物 |
| `pnpm run test:all` | 先构建，再执行单元测试 |
| `pnpm run watch` | 持续编译源码和测试到 `out/` |
| `pnpm run watch:bundle` | 持续更新扩展运行包；与 watch 分别负责对应产物 |
| `pnpm run package` | 触发 `vscode:prepublish` 构建，再在 `dist/` 生成 VSIX |

单元测试使用两类独立资料，不放入生产文件职责表：

| 文件 | 用途 |
| --- | --- |
| [result-builders.test-helper.ts](../../../src/maatools/result-builders.test-helper.ts) | 构造可按来源、下标和状态调整的最小结果，供协议、事件、显示转换等测试使用 |
| [upstream-reports.test-helper.ts](../../../src/maatools/upstream-reports.test-helper.ts) | `upstreamReports` 保留 maa-tools 实际生成的报告样本，覆盖合法未执行占位、部分缺图、全缺图和无匹配；独立于结果构造器保留 |

在被测仓库终端运行收集与指定用例命令可验证框架。要验证扩展编排，可从构建后的 `out/maatools/run.js` 调用 `startMaaToolsRun()`；验证 VS Code 操作仍需打开以被测仓库为工作区的调试窗口。手动检查范围和 Markdown 格式工具见 [AGENTS](../../../AGENTS.md#构建与验证)，调试入口见 [README](../../../README.md#开发态)。不要把一条特定截图的识别时间当作所有机器的期望。

## 构建与发布

### 打包

`pnpm run build` 编译到 `out/` 并由 [bundle.mjs](../../../scripts/bundle.mjs) 生成唯一运行产物 `dist/extension.js`。扩展入口为 CommonJS，`vscode` 不打包，`jsonc-parser` 等运行依赖打进产物；使用 `mainFields: ["module", "main"]` 以避免 jsonc-parser 的 UMD 懒加载文件缺失。

pnpm 的依赖布局可能让 vsce 调用 `npm list` 时解析失败，因此不让 vsce 收集生产依赖。VSIX 包含扩展清单、README、图标、许可证和 `dist`；源码、单测和被测仓库依赖不放进包。`dist`、`out`、VSIX 不提交。

```bash
pnpm run build
pnpm run package
code --install-extension dist/maa-node-test-<版本>.vsix
```

`package` 会触发 `vscode:prepublish` 再构建。改源码后要重新构建，开发时可用 watch；`.code-workspace` 保持纯 JSON，不参与会添加尾逗号的格式化。

### 自动检查与发布工作流

- [test.yml](../../../.github/workflows/test.yml)：向 main 推送或提 PR 时安装依赖、类型检查、构建和测试、试打包 VSIX，再上传产物。
- [release.yml](../../../.github/workflows/release.yml)：手动从 main 触发，确认该提交仍为 main 最新提交，读取扩展版本，检查标签是否可用，再检查、测试和打包。
- 发布工作流创建 `v<版本>` 标签、建立 GitHub Release 并上传 VSIX，随后发布 Marketplace 和可选的 Open VSX。标签已指向同一提交时可重跑；同名标签指向其他提交时要求更新版本，不能移动已发布标签。

使用 `GITHUB_TOKEN` 创建的标签不会再触发其他工作流，所以建标签与发布在同一次手动运行中完成。版本更新本身也通过 PR，不直接向默认分支提交。

Marketplace 使用 `vsce publish --oidc`，发布工具须为 4.1.0 或更高版本，需要 publisher 的 Trusted Publishing 策略和工作流的 `id-token: write` 权限。Open VSX 使用仓库 secret `OPEN_VSX_TOKEN`，未配置时跳过。不要把密钥写进源码。

GitHub Release 在发布市场之前创建。若只需重试市场上传，从 main 触发 `Release` 时选择 `publish_existing`：工作流下载当前扩展版本已有的 VSIX，核对包名、publisher 和版本后上传；这个模式只有仓库读取权限，不构建、不创建标签，也不改写 Release 附件。

令牌交换报 `No api-version was supplied` 时，先核对锁文件实际安装的 vsce 版本。4.1.0 的请求包含 `api-version=7.2-preview.1`，并使用 `FederatedToken` 认证头，接口要求见[官方修复](https://github.com/microsoft/vscode-vsce/pull/1337)。是否支持某项发布功能应以当前服务响应为准，不把历史预计上线日期写成长期前提。

pnpm 允许依赖执行安装脚本的规则在 [pnpm-workspace.yaml](../../../pnpm-workspace.yaml) 的 `allowBuilds` 中：esbuild 需要安装二进制；不使用的签名工具脚本显式禁用。只有依赖或构建方式改变时才调整这份配置。
