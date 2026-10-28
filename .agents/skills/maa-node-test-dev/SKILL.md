---
name: maa-node-test-dev
description: 修改 Maa 节点测试 VS Code 插件时使用。覆盖编辑辅助、测试面板、maa-tools 命令调用、结构化结果校验、运行文案，以及用例或结果显示不正确的排查。
---

# Maa 节点测试插件开发

先读 [README](../../../README.md) 了解用法与限制，再读 [reference](reference.md) 核对当前接口。此文件说明修改位置和验证方法；设计改变更新已有的 [设计记录](../../notes/README.md)。

## 数据流与边界

```text
被测仓库配置 + test.cases
  ├─ maa-tools test --list --json ──► maatools/list.ts ──► core/testExplorer.ts ──► testing.ts 建树
  └─ maa-tools test --jsonl ──► stdout 每行一个 JSON
       ├─ 三类进度事件 ──► flow.ts / progress.ts 校验 ──► testing.ts 逐项开始和结束
       └─ 最后一条 run-result ──► protocol.ts 校验与最终对账 ──► results.ts 转换显示
                                                               ├─ runner.ts 提示
                                                               └─ testing.ts 补全、runSummary.ts 摘要
编辑器当前文本 ──► core/document.ts / hits.ts / completion.ts ──► provider 编写辅助
截图目录与字符串映射 ──► core/testset.ts / loaderMaps.ts ──► 预览和缺图提示
```

收集与运行都使用被测仓库的配置和 maa-tools；收集也执行 `test.cases`，只是不用 MaaFramework。框架按文件绝对路径与原始用例下标选择和汇总，不按组名、截图或期望节点猜来源。

三个运行入口（CodeLens、命令、测试面板）共用 `startTestRun()` 和 `startRunFlow()`，统一使用 `test --jsonl`：stdout 每行一个 JSON，三类进度之后，最后唯一一条 `run-result` 携带完整报告；stderr 是日志。`onProgress` 只决定是否通知界面，所有运行都读取并校验同一标准输出流。

`case-result` 要等该来源本次实际计划的全部平台完成，`file-result` 要等文件全部所选用例完成；二者都带可完整校验的范围快照。普通 `--json` 仍可单独获取一份最终报告；扩展发现用 `--list --json` 读取一份清单，单独 `--list` 供人阅读，两种收集都不初始化 MaaFramework。

`maatools/progress.ts` 保存已完成事实，检查事件、重复和最终对账。相同重复消息不重新发布，矛盾消息报协议错误；没有收到的事件可由最终 JSON 补全。取消保留已校验的完成项、未完成项标跳过，协议错误不能因取消而被忽略。

没有独立运行脚本，也不解析人类日志来判断成败。扩展只检查结果格式与完整性、转换中文文案和 VS Code 对象，不重复测试文件结构校验或重新计算结论。版本用左侧 `StatusBarItem`，与 MaaSupport/MaaFramework 一样使用默认优先级；被测仓库中常显，点击整项刷新，悬浮查看完整来源。版本查询与兼容提示共用结果，并保留自动刷新和迟到保护。

本地文本解析与截图扫描服务于编辑辅助，可处理未保存文本，不能据此推定实际会运行哪些测试。自定义 loader、图片根目录和资源映射可能超出这些辅助支持的约定，文案必须说明这一点。

## 修改位置

| 修改内容 | 主要位置 | 需要同步 |
| --- | --- | --- |
| 图片悬浮内容、大小和排序 | `core/hover.ts`、`core/testset.ts`、`providers/hover.ts` | 对应用例、README 设置和限制 |
| 悬浮与 CodeLens 位置 | `core/document.ts`、`core/lens.ts` | 对应用例 |
| 测试收集接口 | `maatools/list.ts`、`core/runnerArgs.ts` | 框架接口、reference、建树用例 |
| 面板标题、目录和源码范围 | `core/testExplorer.ts`、`testing.ts` | 建树用例 |
| 运行范围、排除、取消、坏文件 | `testing.ts`、`runner.ts` | 面板操作验证、结果计数 |
| 命令参数 | `core/runnerArgs.ts` | 框架参数、reference |
| 机器结果校验 | `maatools/protocol.ts`、`maatools/flow.ts` | 必需字段、版本、来源与缺项测试 |
| 即时事件与最终对账 | `maatools/progress.ts`、`maatools/protocol.ts`、`maatools/flow.ts` | 跨平台完成、相同重复、矛盾、取消及完整性测试 |
| 失败原因的中文表述 | `maatools/results.ts`、`maatools/render.ts`、`core/testResult.ts` | 文案测试 |
| 结果摘要与计数 | `core/runSummary.ts`、`testing.ts` | 缺项、取消、部分失败用例 |
| 测试的选择、识别判定、文件或整批结论 | **maa-tools 对应模块** | 框架测试和两边 reference；不要在扩展另写一套 |
| 设置项 | `package.json`、`config.ts` | README |
| maa-tools 版本查询与状态栏 | `status.ts`、`core/toolStatus.ts`、`maatools/cli.ts` | 左侧位置、无图标标题、来源提示、刷新与查询异常测试 |
| maa-tools 版本门槛 | `maatools/cli.ts` | README 与状态栏；最低版本检查之外仍须检查结果格式 |

## 验证

按改动范围和任务分工选择检查，不重复其他人已负责的完整构建。只修改文档时检查事实、链接和 Markdown 格式。

1. 修改 TypeScript 后运行类型检查，并构建需要执行的文件；对数据转换与结果校验运行相关单元测试。
2. 收集接口改动后，在被测仓库运行 `node node_modules/@nekosu/maa-tools/bin/maa-tools test --list --json`，检查版本、绝对文件路径、原始下标、源码范围、坏文件及无来源说明；另用单独 `--list` 检查人类列表与同一收集结果一致。非默认配置传相同路径，两种收集都不准备 MaaFramework。
3. 运行接口改动后，用该仓库存在的用例执行：

   ```bash
   node node_modules/@nekosu/maa-tools/bin/maa-tools test --jsonl --file tests/example/test_example.json --case 0
   ```

   检查文件计划下标与实际结果是否一一对应、同名或同图用例是否区分、各平台结论及耗时是否完整。单条选择不能删掉同组的负例检查。截图全缺、识别未返回结果、没有待检查节点都不能得到通过。
4. 改即时结果时，用 `--jsonl` 验证进度先于最后报告出现，一个平台先完成不能提前结束用例；一张图全部节点块完成后可及时判定。检查分块、中文、Windows 换行（CRLF）、大行、重复或缺少最后报告、正常结束截断，以及取消时的未完成末行；普通 `--json` 仍应是单份报告。
5. 改面板时验证整文件、单条、目录、排除、坏文件，以及取消发生在部分完成之后的情况。完成事实应保留，未完成项跳过；相同重复不重置节点，矛盾或最终不一致改标错误，缺失事件由完整最终结果补全。
6. 改版本状态栏时，验证左侧默认优先级、无图标标题、悬浮完整来源和点击整项刷新；被测仓库编辑普通文件仍显示，普通项目隐藏。正常、未安装、过旧、查询失败、工作区/Node 切换、依赖变化、迟到查询和销毁都需覆盖；兼容提示不重复查询，运行数量仍用原 priority 100 状态项。
7. 格式化本次修改的文件并检查 Markdown，命令见 [AGENTS](../../../AGENTS.md#构建与验证)。测试结论写实际执行结果，不在长期说明中固定测试数、仓库文件数或某台机器的耗时。

需要单独验证扩展编排时，可从构建后的 `out/maatools/flow.js` 调用 `startRunFlow`；输入包括 `workspaceRoot`、`nodePath`、`configPath`、`testFiles` 和可选 `caseIndex`。`testFiles` 是相对被测仓库的路径列表；这不能代替对 VS Code 入口的验证。临时脚本用任务专属名字，验证后清理。

## 容易误判的地方

- `schemaVersion: 1` 和正确类型声明不等于返回值可信；最终结果与每条即时快照都要检查来源和完整性，不能把任意子进程消息交给面板。
- 快照只对自己的文件/用例范围负责；与最终结果核对具体事实，不要求快照的整批状态或经过时间等于整批最终值。
- 缺图是 `skipped`，不是通过；全缺图文件由框架报错。扩展直接消费框架 verdict，不根据有没有失败明细自行推断。
- 摘要只统计明确返回的通过，不能用“总数减失败数”推算；未返回结果必须单列。
- 用例和文件的时间是分摊后的识别执行时间，运行末尾的时间是实际经过的时间；同图复用不能重复计数。
- 编辑辅助允许宽松解析未完成文本，并不表示 maa-tools 允许尾逗号。运行文件由框架读取和校验。
- 块注释不要直接嵌入带 `*/` 的目录通配符。
- `.code-workspace` 是纯 JSON，不能被格式化成带尾逗号。
- `core/` 和 `maatools/` 不导入 `vscode`；有文件或进程操作的模块不称纯函数。

## 同步与提交

行为改变更新 README；接口改变更新 reference；设计改变更新已有记录。没有授权时不切共享目录分支、不提交、不推送。获得提交授权后使用中文约定式提交；推送仍需明确授权。
