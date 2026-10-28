# 参考：对接与内部细节

[SKILL](SKILL.md) 说明修改与验证步骤，这里记录文件职责、maa-tools 接口、结果显示、编辑辅助和构建发布。用户用法见 [README](../../../README.md)。

## 文件职责

下表路径均相对 `src/`。

| 文件 | 职责 |
| --- | --- |
| `extension.ts` | 创建输出面板、runner、测试面板、版本状态栏和 provider，注册命令，停用时清理 |
| `status.ts`、`core/toolStatus.ts` | 版本查询、左侧状态栏与完整来源提示；查询与兼容检查共用结果 |
| `config.ts` | 读取 `maaNodeTest.*`；优先选含配置路径的工作区文件夹，否则用第一个 |
| `runner.ts` | `startTestRun()` 共用运行入口、活动运行管理；`NodeTestRunner` 负责命令与 CodeLens 的输出和提示 |
| `testing.ts` | `NodeTestExplorer` 收集、建树、选择范围、排除与取消，将框架结果转换为 VS Code 标记 |
| `core/runnerArgs.ts` | 拼收集与运行参数、显示命令和标题 |
| `core/testExplorer.ts` | 收集条目转换为树描述：标题、说明、目录和源码范围 |
| `core/testResult.ts` | 结果消息与面板标记；不替代框架判定，缺项按错误处理 |
| `core/runSummary.ts` | 根据明确的逐用例状态计数，生成运行末尾的结果摘要 |
| `maatools/cli.ts` | 定位被测仓库的命令入口、读取和查询版本 |
| `maatools/list.ts` | 调用 `test --list --json`，检查收集结果格式和错误 |
| `maatools/flow.ts` | 起一次 `test --jsonl`、逐行读取进度与最终报告、转发日志、取消、校验并核对即时事实 |
| `maatools/protocol.ts` | 最终结果与事件的本地类型和运行时检查：版本、字段、来源、范围、覆盖及汇总一致性 |
| `maatools/progress.ts` | 已开始与已完成事实、相同重复去重、矛盾检查、最终对账，以及取消时可保留的结果 |
| `maatools/results.ts` | 将已校验的上游文件/用例结果转换为显示数据和中文原因 |
| `maatools/render.ts` | 把已知结果与实际截图路径排成日志 |
| `maatools/paths.ts` | 解析请求路径，绝对路径转换为显示用的相对路径 |
| `core/document.ts`、`core/lens.ts` | 编辑文本解析与 CodeLens 描述，不决定实际运行输入是否合法 |
| `core/testset.ts`、`core/png.ts`、`core/hover.ts` | 扫描编辑辅助截图目录、读取图片尺寸、排序和拼预览 |
| `core/missingImages.ts` | 编辑时的缺图提示及源码范围 |
| `core/loaderMaps.ts`、`core/resources.ts` | 读取 loader 字符串映射、interface 的控制器资源目录约定 |
| `core/completion.ts`、`core/hits.ts`、`core/pipeline.ts`、`core/repoIndex.ts` | 补全位置、节点名与注释、源码索引及缓存 |
| `providers/` | CodeLens、悬浮、补全、内联提示和定义跳转的 VS Code 转换 |

`core/` 和 `maatools/` 都不导入 `vscode`，因此数据转换可以在 Node 中测试。目录里也有文件与进程操作，不能把整层称作纯函数。

## 为什么使用仓库里的 maa-tools

扩展不自带 `@nekosu/maa-tools` 副本，只调用：

```text
<被测仓库>/node_modules/@nekosu/maa-tools/bin/maa-tools
```

仓库配置、命令行测试和编辑器测试使用同一版本的工具，减少版本差异；MaaFramework 的版本与准备方式仍由该仓库配置决定。实际识别结果还受配置、资源和框架版本影响，使用同一工具并不是“两处结果必然一致”的保证。

找不到入口时明确报错。最低版本要求为 1.1.3；运行时另检查 `schemaVersion: 1` 和必需字段，不能仅凭版本号接受任意 JSON。安装命令不会自动突破锁文件，升级提示应引导检查依赖声明、锁文件和实际安装的版本。

## 工具版本状态栏

`MaaToolsVersionStatus` 使用左侧 `StatusBarItem`，与 MaaSupport/MaaFramework 一样省略优先级参数，使用 VS Code 默认优先级。runner 显示运行数量的状态项仍为 priority 100。版本查询与兼容提示共用结果。

- 被测仓库有配置或 maa-tools 包时常显，编辑普通文件也显示；无工作区，或普通项目两者都没有时隐藏。
- 正常标题为无图标的 `maa-tools <版本>`；查询中、未安装、过旧和查询失败均显示对应文字。
- 优先使用 `maa-tools --version`。查询失败时，安装包版本只供排错：过旧仍标过旧，其余标未确认或版本未知，不能据包声明确认命令可运行。
- 点击整项执行 `maaNodeTest.refreshToolVersion`，只查询、不运行测试或打开新面板。悬浮提示保留版本来源、最低版本、仓库、命令入口、软链接实际文件、Node、配置和失败原因。
- 工作区、`nodePath`、`configPath`、配置文件、相关包清单与锁文件、工具入口及安装位置变化后刷新，也监视软链接实际目标。
- 查询与防抖刷新有序号，旧结果不能覆盖新状态；停用时清理定时器、监听和状态栏项。

## 测试定义与来源

收集和运行均加载同一份配置并展开 `test.cases`；它可以是数组或异步函数。收集只省略 MaaFramework 初始化与识别，不绕过 loader，也不固定扫描某个目录来代替配置。

maa-tools 的 `loadTestCases()` 和 `loadAllTestCases()` 共用文件读取与结构校验，并给每条用例填 `origin: {file, case}`：`file` 是规范化绝对路径，`case` 是源文件 `cases` 数组的原始下标。loader 展开控制器或资源时必须保留它，例如复制用例时保留 `...testCase`。手写 origin 也必须满足绝对路径和非负安全整数下标，格式非法时报 `test-source-invalid`，与完全没有来源的程序组不同。组名只用于显示，重复组名、相同截图、相同节点或不同期望框不构成来源依据。

收集仅列出实际进入配置展开结果的文件与原始下标，不把“曾被读取但配置主动排除”的有效文件当成可运行测试。读取失败的文件保留 `error` 条目，供面板单独报错。没有来源的程序生成组会产生清楚的收集错误；全量库调用可运行这种组并返回 `groups`，但按文件选择不能猜来源。

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
- `--file` 按规范化绝对来源精确匹配，可重复；相对路径相对命令工作目录。
- `--case` 为文件内原始下标，从 0 开始，可重复选择多条，但必须配单个文件。CLI 要求完整的非负十进制安全整数；越界属于参数错误。
- 控制器、资源和来源过滤取交集。展开时先固定完整待检查节点，选择单条不会删除该组其他节点的“不应命中”检查。
- `--list` 选择收集，`--json` 选择格式，可组合：单独 `--list` 显示人类列表，扩展用 `--list --json` 读取一份清单。两种列表都不初始化 MaaFramework。
- 默认运行输出文本，`--json` 输出完整运行 JSON，`--jsonl` 输出进度并以唯一 `run-result` 结束。`--json` 与 `--jsonl` 互斥；`--list` 不支持 `--jsonl` 或 `--case`。
- 所有收集及机器格式输出都从配置加载前把 JavaScript 日志转到 stderr。单独 `--list` 的错误不输出 JSON，组合 `--list --json` 保留完整错误 JSON；含 `--jsonl` 的非法组合仍以 `run-result` 错误报告结束。`--version` 输出普通版本字符串。
- 扩展转发 stderr，但不从日志行、退出码或错误明细文件推算逐用例结论。命令、配置或结果错误依靠结构化错误代码与说明区分。

## 收集结果

`--list --json` 成功收集的顶层为 `{schemaVersion: 1, files: [...]}`。收集失败含 `errorCode`、`reason`，CLI 顶层错误结果还带 `status: 'error'`、`groups` 和 `durationMs`；可以保留已经识别的文件。单独 `--list` 将同一结果显示为文件、原始下标、名称或截图、文件错误及总数，不输出这份 JSON。

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
schemaVersion: 1
status: passed | failed | error | empty
groups: TestGroupRunResult[]
files: TestFileRunResult[]
durationMs: number
errorCode?: string
reason?: string
```

`files[]` 由 maa-tools 统一汇总，是扩展显示文件和用例结论的依据。每个文件包含收集元数据、`selectedCases`、`verdict`、可选 `reason` 和 `cases`。`selectedCases` 是本次计划运行的原始下标；`cases` 必须完整覆盖该列表，不要求从 0 连续排列。

每条文件用例包含收集元数据、`verdict`、`durationMs`、可选 `reason` 和 `platforms[]`。每个平台项含 `controller`、`resource`、`result`；平台结果给出检查明细、单个 `origin` 和结论。已解析图片路径时，`imagePath` 是实际绝对路径；尚未执行的 error 占位结果可以为空字符串，不能当成实际尝试过该路径。控制器及资源是组配置声明值，不是截图目录别名。

`groups[]` 保留按配置分组的原始结果；无文件来源的全量库调用也可用这些组汇总状态，不能因 `files` 为空就判为空运行。扩展需要文件身份，不能把无来源组强行挂到某个文件。

### 判定与验证是否完整

判定由 maa-tools 负责，扩展不从失败或缺图数组重新计算：

| 层级 | 规则 |
| --- | --- |
| 单平台用例 | 检查为 pass/fail，应返回却缺失节点结果也为 fail；缺图为 skipped；没有待检查节点或计划未能执行为 error |
| 跨平台用例 | fail 优先，其次 error；有平台缺图则 skipped；其余为 pass |
| 文件 | 有用例失败为 fail，其次 error；至少有一个平台完成有效检查且其余只是缺图跳过时可 pass；没有有效检查为 error |
| 整批 | error 优先于 failed，再是 passed；没有匹配用例为 empty，错误代码为 `no-tests-matched` |

**用例标灰不等于它在所有平台都没运行。** 例如 A 平台已有有效检查并通过、B 平台缺图，该用例汇总为 skipped，文件可为 pass，同时列明 B 未验证。即使每条用例汇总都是 skipped，也不能只看这个值就断言文件“全缺图”；应直接用框架给出的文件结论。

预期命中和预期不命中的节点都必须返回识别结果。没有结果不能默认为未命中；识别无明细会报错。用例设置了期望框时，识别必须返回实际框，且实际框完整落在期望框内；未设置期望框的用例不做框检查。

扩展检查顶层格式、合法状态、必要字段、文件身份、`selectedCases` 与用例结果的覆盖关系，并对照面板传入的所选下标。缺项或不支持的格式明确报错，不把没返回的用例补成通过。TypeScript 接口只是本地类型说明，读取边界上的值仍需校验。

### 耗时

同组按规范化绝对截图路径复用识别任务。同图被多个所选用例使用时，真实任务耗时在这些用例间分摊，避免同图运行多次或重复累计。组时间等于组内用例时间之和；文件时间为对应所选用例各平台的时间之和。顶层 `durationMs` 是运行实际经过的时间，包含准备和等待，不与并行任务时间求和等同。

### 中文失败信息

`describeCheck()` 等显示函数把框架原因翻成中文：期望命中却未命中、不该命中却命中、识别框不符、缺少识别详情、缺失节点结果。原因、实际图片路径和期望框来自结果；不猜算法故障、不重新比较识别框、不读取旧错误文件。

## 运行中的即时结果

所有扩展运行固定使用 `--jsonl`，子进程的 stdio 为 `ignore/pipe/pipe`。标准输出每行一个紧凑 JSON，并以换行结束；stderr 是人类日志。`RunFlowHandlers` 和 `TestProcessHandlers` 的可选 `onProgress` 只接收校验后的三类 `TestRunEvent`，不决定输出格式。

流中每条记录都带 `schemaVersion: 1`：

| type | 其他字段 | 含义 |
| --- | --- | --- |
| `case-started` | `origin` | 第一次提交该原始用例相关识别任务，跨平台只开始一次 |
| `case-result` | `origin`、`result` | 本次实际计划的全部平台完成；result 是仅含该文件这一条原始下标的完整 TestRunResult 快照 |
| `file-result` | `file`、`result` | 文件所有 selectedCases 都有确定结果；快照只含该文件的本次选择范围 |
| `run-result` | `result` | 唯一且最后，包含完整 TestRunResult；由运行入口处理，不传给面板的进度回调 |

框架在每张图的全部节点块完成后立即判定，同图复用用例分别比较自己的期望；来源的最后一个计划平台结束后才发用例结果。缺图、无节点等可以直接完成，不伪造识别开始；尚未形成计划的配置错误仅由最终结果说明。资源组和测试组仍按计划处理，组内识别任务并行，不改成逐文件进程。

快照的 groups 同样限定在对应范围，并复用最终报告的汇总规则。用例快照按单文件、单原始下标校验；文件快照按该文件的 expectedCases 校验。记录还检查版本、类型、请求来源、原始下标和快照身份，未经校验的标准输出记录不能直接交给面板。

`RunProgress` 保存已开始和已完成事实，相同重复消息不再发布，包括完成后重复收到已记录的开始消息。重复结果矛盾、此前未报告开始却在完成后首次报告开始、文件结果遗漏已开始或已完成用例都报协议错误。平台返回顺序不影响比较，但来源、元数据、结论、检查和识别耗时必须一致。

最终结果先通过完整协议校验，再核对已完成的用例与文件；未收到完成事件的项目由最终结果补全。核对对应范围的实际事实，不比较快照的整批状态和实际经过时间与整批最终值是否相同。

取消时只返回已经校验的完成事实：完整文件快照可结束文件，只有单条快照不能说整个文件完成；尚未完成项由面板标 skipped。信号终止等非协议错误也可保留已校验事实，但不能据此判整批通过。

标准输出按 UTF-8 解码并按换行缓冲，支持中文、Windows 换行（CRLF）、一块多行和大行，不能逐个 data 块直接 JSON.parse。完整畸形行、未知记录、重复 `run-result` 或其后再有记录立即按 `invalid-result` 处理；正常退出时，缺少最后报告或残留截断行也报错。

用户取消或信号终止时，尚未完成的末行不覆盖已经校验的完成事实；此前完整行的协议错误仍优先。格式错误或最终对账矛盾会清除可疑的即时通过，同一次调用的所选节点改标 error。

## 面板与运行操作

- 收集结果通过 `core/testExplorer.ts` 生成目录、文件和用例；源码位置由字符偏移转换为行列。坏文件保留读取错误，运行时单独标 error，正常文件继续。
- 叶子信息表记录绝对路径、相对显示路径和原始下标。运行时使用这张表，不解析节点 id 来找测试。
- 没有排除项的文件目标合并为一批，节省重复准备。单条目标各自调用；排除个别用例时，把文件展开为其余所选原始下标，不能仍提交整文件。
- 一次面板运行中的目标依次执行。所选项先标 enqueued；case-started 才标该用例及文件运行中；case-result 立即结束用例，file-result 立即结束文件并补此前未逐条报告的子用例。最终报告只补未完成项，不把已完成项重新标为 started。
- 取消请求传给共用运行入口并终止 maa-tools 子进程。面板保留已校验完成的用例和文件，未完成项标 skipped；摘要仍只显示取消与耗时，不给部分运行作整批判断。跨平台的子进程退出行为需要分别验证。
- `caseInfoToVerdict()` 使用上游 verdict，只转换中文消息和耗时。`planFileMarking()` 不把无结果的子节点标通过，也不重新覆盖正确的文件判定。
- 摘要统计明确的 pass、fail、error、skipped；缺少结果单列。前置错误不能显示“全部通过”。合法的整批 error 可以保留已经完成的通过/失败结果，但另列“运行错误”并说明整批没通过；格式或完整性不符合要求时，不把不可信的部分结果算通过。原始日志在前、摘要在后；“没有完成验证”与“断言失败”分开表达。
- 并发刷新仅应用最新一次收集；停用后迟到的收集不再操作已销毁的面板。

## 编辑辅助的范围

`core/document.ts`、`hits.ts` 和 `completion.ts` 解析编辑器文本，允许宽松处理注释和未完成内容。maa-tools 读取运行文件时允许注释，不允许尾逗号；两者用途不同，不宣称解析行为完全相同。

图片预览和黄线根据 `testsetDir` 扫描一级平台、二级资源目录；`loaderMaps.ts` 只读 `tests/scripts/loader.mts` 中 `controllerMap`、`resourceMap` 的对象字面量字符串。它不是 TypeScript 求值器，也不执行 loader。缺图诊断只比较声明控制器是否有图，不核对资源服；带子目录的 image、自定义 imageRoot 或动态映射可能与实际运行不同。

因此，运行缺图信息必须使用返回的 `imagePath`，排错应检查配置里的 `cwd`、`casesCwd`、`imageRoot` 和用例 `image`。工作区根不一定是截图根；改变编辑辅助的 `testsetDir` 不改变运行路径。

预览按声明控制器顺序排序，未声明平台接在后面。默认使用 HTML 图片，宽度 400、按比例设置高度，并启用 `MarkdownString.supportHtml`；宽度设 0 时使用原图尺寸。始终保留打开原图链接；文件 URI 中的括号应编码。

节点候选按 `assets/interface.json` 中的控制器资源目录约定收窄，包含基础 `assets/resource`；缺少 interface 时退回扫描 `assets` 中的 pipeline 目录。节点注释取 `desc`、`focus` 和识别/动作说明。只在 `cases[].hits[]` 或其 `.node` 上提供节点跳转与提示；多处定义返回列表，源码片段从原文截取。

`repoIndex.ts` 按文件修改时间缓存解析结果，按控制器组合缓存资源和节点清单；扩展可后台预热，停用时清理定时器。缓存只改善编辑辅助，不成为测试结果来源。新增缓存应先说明失效条件，不把某次本机速度写成保证。

## 验证

命令和分工见 [AGENTS](../../../AGENTS.md#构建与验证)。框架测试负责来源、配置展开、选择不改变检查语义、识别判定和汇总；扩展测试负责参数、边界校验、缺项错误、结果转换、面板排除、标记和计数。文案或接口变化同步对应测试，不用固定的测试数代替覆盖说明。

在被测仓库终端运行收集与指定用例命令可验证框架。要验证扩展编排，可调用构建后的 `startRunFlow`；验证 VS Code 操作仍需打开以被测仓库为工作区的调试窗口。不要把一条特定截图的识别时间当作所有机器的期望。

## 构建与发布

### 打包

`pnpm run build` 编译到 `out/` 并由 `scripts/bundle.mjs` 生成唯一运行产物 `dist/extension.js`。扩展入口为 CommonJS，`vscode` 不打包，`jsonc-parser` 等运行依赖打进产物；使用 `mainFields: ["module", "main"]` 以避免 jsonc-parser 的 UMD 懒加载文件缺失。

pnpm 的依赖布局可能让 vsce 调用 `npm list` 时解析失败，因此不让 vsce 收集生产依赖。VSIX 包含扩展清单、README、图标、许可证和 `dist`；源码、单测和被测仓库依赖不放进包。`dist`、`out`、VSIX 不提交。

```bash
pnpm run build
pnpm run package
code --install-extension dist/maa-node-test-<版本>.vsix
```

`package` 会触发 `vscode:prepublish` 再构建。改源码后要重新构建，开发时可用 watch；`.code-workspace` 保持纯 JSON，不参与会添加尾逗号的格式化。

### 自动检查与发布工作流

- `test.yml`：向 main 推送或提 PR 时安装依赖、类型检查、构建和测试、试打包 VSIX，再上传产物。
- `release.yml`：手动从 main 触发，确认该提交仍为 main 最新提交，读取扩展版本，检查标签是否可用，再检查、测试和打包。
- 发布工作流创建 `v<版本>` 标签、建立 GitHub Release 并上传 VSIX，随后发布 Marketplace 和可选的 Open VSX。标签已指向同一提交时可重跑；同名标签指向其他提交时要求更新版本，不能移动已发布标签。

使用 `GITHUB_TOKEN` 创建的标签不会再触发其他工作流，所以建标签与发布在同一次手动运行中完成。版本更新本身也通过 PR，不直接向默认分支提交。

Marketplace 使用 `vsce publish --oidc`，需要 publisher 的 Trusted Publishing 策略和工作流的 `id-token: write` 权限。Open VSX 使用仓库 secret `OPEN_VSX_TOKEN`，未配置时跳过。不要把密钥写进源码。

GitHub Release 在发布市场之前创建：市场鉴权不可用或策略尚未配置时，仍可下载已生成的 VSIX，排查后重跑，或由维护者手动上传。是否支持某项发布功能应以当前服务响应为准，不把历史预计上线日期写成长期前提。

pnpm 允许依赖执行安装脚本的规则在 `pnpm-workspace.yaml` 的 `allowBuilds` 中：esbuild 需要安装二进制；不使用的签名工具脚本显式禁用。只有依赖或构建方式改变时才调整这份配置。
