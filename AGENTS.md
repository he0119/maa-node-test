# AGENTS.md

这是 Maa 节点测试的 VS Code 扩展。它调用**被测仓库安装的 maa-tools** 收集和运行测试，提供结果展示、截图预览和编写辅助。默认配置路径为 `maatools.config.mts`，编辑辅助的默认截图目录为 `tests/MaaEndTestset`；MaaEnd 只是默认值和调试配置的示例。

范围包括运行节点测试、展示失败原因、查看截图和辅助写用例。Pipeline 链路校验、资源打包、任务运行调试及识别算法由各仓库工具和 MaaFramework 负责。

先读 [README.md](README.md)、[开发技能](.agents/skills/maa-node-test-dev/SKILL.md) 和 [reference.md](.agents/skills/maa-node-test-dev/reference.md)。设计取舍更新已有的 [设计记录](.agents/notes/README.md)，不要为同一件事再建一份。

## 职责边界

- **maa-tools**：加载配置和 `test.cases`、解析测试文件、保留来源、收集与选择用例、固定待检查节点、运行识别、判定并汇总文件和整批结果。
- **扩展**：把用户选择转换为命令参数、调用与取消进程、检查机器结果是否支持且完整、显示中文原因与 VS Code 标记。不从日志或截图反推运行结论，不再次解析目标文件来判定是否能运行。
- **编辑辅助**：[core/document.ts](src/core/document.ts) 可以解析未保存文本用于 CodeLens、补全、悬浮和缺图提示。这些结果不决定测试的实际范围或通过与否。测试集目录扫描和 loader 字符串映射不能代替运行时配置。

## 代码地图

文件职责集中维护在 [reference 的逐文件表](.agents/skills/maa-node-test-dev/reference.md#文件职责)，源码注释解释局部约束或容易误解的行为。

| 位置 | 职责 |
| --- | --- |
| [src/extension.ts](src/extension.ts) | 装配编辑辅助、命令、输出面板、测试面板和版本状态栏，管理仓库索引预热 |
| [src/config.ts](src/config.ts) | 读取设置，选择被测工作区，解析配置和编辑辅助目录 |
| [src/toolVersionStatus.ts](src/toolVersionStatus.ts) | `MaaToolsVersionStatus` 管理版本状态栏、查询与兼容提示；[core/toolStatus.ts](src/core/toolStatus.ts) 生成文字，共用一次版本查询 |
| [src/testRunner.ts](src/testRunner.ts) | `NodeTestRunner` 管理命令与 CodeLens 的运行、输出和提示；测试面板复用 `startTestRun()` |
| [src/testController.ts](src/testController.ts) | `NodeTestExplorer` 收集后建树、选择运行范围、排除与取消，更新逐文件和用例标记 |
| `src/providers/` | 将编辑辅助的普通数据和文字转换为 VS Code 对象 |
| `src/core/` | 编辑文本解析、截图与仓库资料读取、路径、树描述、标记计划、标题和计数；不导入 VS Code |
| `src/maatools/` | 命令参数、安装入口与版本、进程读取、收集、运行、机器协议校验、显示转换和日志排版；不导入 VS Code |

收集与运行直接共用 [maatools/process.ts](src/maatools/process.ts)；机器结论类型归 [maatools/protocol.ts](src/maatools/protocol.ts)，标题归 [core/runSummary.ts](src/core/runSummary.ts)。截图扫描使用 [core/screenshots.ts](src/core/screenshots.ts)，PNG 文件头读取独立放在 [core/png.ts](src/core/png.ts)。

## 硬约束

1. `src/core/`、`src/maatools/` 不得导入 `vscode`；文件操作和进程操作不叫纯函数，便于单测的字符串与数据转换应保持独立。
2. 收集调用 `maa-tools test --list --json`，三个运行入口统一调用 `maa-tools test --jsonl`，都传相同的仓库配置。命令入口只能来自 `<被测仓库>/node_modules/@nekosu/maa-tools/bin/maa-tools`，工作目录为被测仓库根。实际收集与运行读取已安装包的版本，只接受稳定版 `>=1.2.0 <2.0.0`；允许 `v` 前缀和构建元数据，未知、格式无效、预发布、过低和过新的版本都拒绝。不为每次操作额外执行 `--version`，包声明通过后仍须检查实际启动与数据。
3. 运行标准输出每行一个 JSON，以 `type` 区分三类进度和最后唯一的 `run-result`，最后记录包含完整报告；stderr 是日志。逐行解析处理分块，最后报告重复、其后还有记录、正常退出缺报告或截断均报错。取消或信号终止的未完成末行不能覆盖此前完成事实，完整错误行仍优先报错。公开报告由 `status`、`files`、`durationMs` 和可选的 `errorCode`、`reason` 构成，`files` 按文件、用例和平台保存结果明细。文件/用例快照只含对应范围的 `files`。结果须检查必需结构、类型、来源、所选下标、覆盖、汇总及最终一致性，不能补成通过；包版本、类型声明、编辑辅助和未知字段检查都不能代替来源校验。
4. 只支持文件测试，测试身份是实际测试 JSON 文件的绝对路径与原始下标。展开后的 `TestCases.cases.origin` 与平台结果 `TestCaseRunResult.origin` 在类型和运行时都必填；缺少、格式无效或无法对应实际文件与原始下标时，在加载计划阶段报 `test-source-invalid`，不进入识别。普通 JSON 不用手写 origin，`loadTestCases()`/`loadAllTestCases()` 自动补齐，自定义 loader 必须保留，动态生成的展开对象也须关联实际文件与下标。Windows 的规范化来源路径忽略大小写，用于匹配、去重和对账；其他系统区分大小写，显示路径保留原有大小写。不用组名、截图、节点名或框猜来源，结论由 maa-tools 返回。平台结果位于 `files` 中所属用例的 `platforms[].result`。框架按执行组展开、固定节点、调度与并行判定，普通文本日志显示组名和结果。
5. 缺图为 `skipped`，不是通过。有待验证用例时，全缺图、无有效验证或缺结果仍报错。只有过滤后本次 cases 为空且无文件错误时，文件才为 `skipped`，reason 为 `no-cases-selected`，通过范围校验后面板标跳过；不影响其他文件结论，全空仍为 `empty`。前置错误不得把子用例标绿。
6. 默认值可取自 MaaEnd，不能把平台名、资源服名或 loader 组名格式写成运行规则。编辑辅助只支持特定目录约定时，要在文档和提示中写明限制。
7. 预览默认使用 HTML 图片，宽度由 `maaNodeTest.hoverImageWidth` 控制，默认 400；设为 `0` 时按原图尺寸显示。「打开原图」链接必须保留。
8. 扩展运行依赖打进 `dist/extension.js`，不要放入 `dependencies` 让 vsce 在 pnpm 的依赖树中解析。`vscode` 由宿主提供，不打进包。
9. `maa-node-test.code-workspace` 保持纯 JSON，不带尾逗号；它已在 `.prettierignore` 中排除。
10. 用例完成必须等本次实际计划中的全部平台，不能因第一个平台通过就标绿；文件等所选用例全部完成后结束。取消保留已校验的完成事实、跳过未完成项；协议错误优先于取消，可疑的已显示结果也要标错。
11. 版本用左侧 `StatusBarItem`，与 MaaSupport/MaaFramework 一样不指定优先级，标题不加图标。被测仓库有配置或工具包即常显，普通项目隐藏；悬浮保留完整来源，点击整项刷新。版本与兼容提示共用查询，支持自动刷新和迟到保护；运行数量状态项使用 priority 100。

## 构建与验证

在插件目录运行：

```bash
pnpm run check        # 类型检查
pnpm run compile      # 编译到 out/
pnpm run bundle       # 打包到 dist/extension.js
pnpm run build        # compile + bundle
pnpm test             # out/core 与 out/maatools 的单元测试
pnpm run test:all     # 构建与测试
pnpm run package      # 生成 VSIX
```

按本次改动选择检查，已有明确分工时不要重复别人的全套验证。只改文档时检查格式、链接和事实，无需运行识别。

验证框架接口时，在**被测仓库根**运行以下命令；第二条中的测试文件替换成该仓库实际存在的用例：

```bash
node node_modules/@nekosu/maa-tools/bin/maa-tools test --list --json
node node_modules/@nekosu/maa-tools/bin/maa-tools test --jsonl --file tests/example/test_example.json --case 0
```

配置不是默认路径时，两条命令都添加配置路径。收集要加载配置和用例，但不初始化 MaaFramework；运行会准备 MaaFramework、加载资源并写识别日志。检查文件与原始下标、源码范围、逐平台原因和耗时，不把某台机器的固定文件数或耗时作为通过条件。

验证扩展操作时，在打开被测仓库的调试窗口分别试文件、单条、目录、排除、取消和坏文件；确认所选结果不完整时明确报错。三种调试入口见 [README](README.md#开发态)，仓库自带的工作区和 launch 配置目前使用相邻的 MaaEnd，换仓库要修改路径。

格式工具可使用本机 MaaEnd 安装的版本；路径按实际安装位置调整。只格式化本次修改的文件，文档改动只传 Markdown 文件：

```bash
~/dev/MaaEnd/node_modules/.bin/prettier --config ~/dev/MaaEnd/.prettierrc.mjs --write <本次修改的文件>
~/dev/MaaEnd/node_modules/.bin/markdownlint <本次修改的Markdown文件>
```

## 同步说明与提交

- 面向使用者的行为、设置、限制和排错改动更新 README；接口和内部机制更新 reference；设计改变更新已有设计记录。
- `dist/`、`out/` 和 `*.vsix` 不提交；发布步骤见 [reference](.agents/skills/maa-node-test-dev/reference.md#构建与发布)。
- 提交信息用中文约定式提交，一次提交说明一件事。没有授权时不切共享目录的分支，不覆盖同伴修改。
- 不主动推送。只有用户明确要求推送时才执行；不得直接向默认分支提交或推送。
