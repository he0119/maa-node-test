# Agent Note: 自带 runner 只跑单个文件或用例

Status: implemented

## Problem

MaaEnd 的节点测试只有全量入口 `pnpm test`（`maa-tools test`），没有过滤参数。几十个测试文件、上百条用例一起跑一遍要等很久，而开发时的实际动作是「改了一个识别节点，想确认这一条用例」——反馈太慢，人就会跳过测试。

插件要提供「点一下跑一条」，就必须绕开全量入口，但不能自己重写识别与调度：`maa-tools` 里的 `runTest` 已经处理好了 MaaFW 版本准备、资源打包、worker 池并行、box 比对和错误明细落盘，重写一遍等于把这些坑再踩一遍。

## Decision

插件自带一个独立脚本 `runner/run-single-test.mjs`，**复用 `maa-tools` 的库函数**，只在「跑哪些用例」上做裁剪：

1. `loadConfig(maatools.config.mts)` —— 走和全量入口完全同一套配置加载（含 `tests/scripts/loader.mts` 的 `fetchCases`）；
2. 把 `cfg.test.cases` 包一层，用 `lib/filter.mjs` 的 `filterGroupsForFiles()` 只留下属于目标文件的组和用例，同时记下「组名 → 哪些文件」的归属（`owners`）；
3. 读目标测试文件，算「用例键」＝图片名 + 命中节点集合；
4. 自己做截图存在性预检；
5. 调 `runTest(cfg)`，把结果翻译成固定接口：逐文件 `RESULT-FILE: <路径> pass|fail|error`、最后一行 `RESULT: pass|fail|error|empty` ＋ 退出码 `0/1/2/3`。

**逐用例原因**来自 maa-tools 自己写的 `cfg.test.errorDetailsPath`（MaaEnd 里是 `tests/maatools/error_details.json`），每条含 `imagePath`、`node`、`hit`、`detail.{algorithm, box}`。runner 用「组的 imageRoot + 用例图片名」推出期望路径去匹配条目，再用**用例自己的期望**重新判一遍（该命中没命中 / 不该命中却命中 / 框超出范围），产出 `RESULT-CASE: {json}` 行，面板直接显示这句话。只有本次运行更新过这个文件才采信（比 mtime），避免把上一次运行的失败张冠李戴。之前的做法只给一句「断言失败，自己去看红色组名」，定位一条用例要重跑一次，这是本轮补掉的主要体验缺口。

`--file` 支持重复：**一批文件共用一次进程**。MaaFW 初始化 + `assets/` 加载是单次运行的固定大头（实测单文件 4~5 秒，而只做配置加载与过滤的 dry-run 只要 0.56 秒），一个文件一个进程等于把这份开销重复几十次。合并之后逐文件的结论这样拿到：`runTest` 只给整批一个布尔值，但它会为每个组打印一行组名、失败时紧跟行首两空格的明细行，于是把 stdout 抄一份，按「组名行 / 明细行」判定每组，再按 `owners` 分发到文件（`lib/results.mjs`）。截图全缺、或过滤后一个组都没匹配到的文件，结论强制记 `error`，不允许显示成通过。

扩展侧只认这个接口：`src/core/runnerArgs.ts` 负责拼参数、`src/runner.ts` 统一起进程、`src/testing.ts` 和 `src/runner.ts` 各自把退出码翻成人话。

过滤为什么用「controller/resource + 组名后缀 + 用例键」三条：`fetchCases` 展开后的每组只剩 `configs` 和 `cases`，「来自哪个文件」已经丢了，组名也只有 `(controller-resource)name`。三条一起才既能圈住目标文件，又不会顺带跑掉同 controller/resource 下别的文件。

截图预检是必须的：`maa-tools` 遇到不存在的截图只打印 `not exists, ignored` 然后跳过，跳过＝通过。不预检的话，把图片路径写错会得到一个绿色的「通过」，比报错更有害。

## Alternatives considered

**给 `maa-tools` 上游加过滤参数。** 这才是最干净的做法，但要等上游发版、要设计参数语义，而且会把这个插件的开发节奏绑在别人手上。当前阶段先在自己这侧做裁剪，逻辑集中在 `lib/filter.mjs`，将来上游有原生过滤能力时可以整块删掉。

**插件里直接用 `@maaxyz/maa-node` 自己跑识别。** 看起来更自主，实际要把资源加载、界面截图缩放、worker 并行、box 比对、错误明细全部实现一遍；这些正是 `maa-tools` 已经调好的部分，重写只会引入一堆「为什么 CI 里能过、本地不过」的问题。

**只按图片文件名过滤。** 实现最省事，但同一张截图被多个测试文件复用是常态（同一个界面测不同节点），按文件名会把别人的用例一起跑进来，结果里冒出无关的组名，失败时也分不清是谁。所以用「图片名 + 命中节点集合」组成用例键。

**把 `tests/` 子集拷到临时目录再跑。** 依赖 `maatools.config.mts` 里的相对路径和 `casesCwd`，拷出去之后配置要跟着改，临时目录清理也容易出错；相比包装一个函数，成本和出错面都更大。

**一个文件一个进程（第一版做法）。** 判定粒度最细、实现最简单，但固定开销按文件数重复：45 个文件实测要 3~4 分钟。批量跑之后同样的量十几秒，代价只是「失败定位到文件、定位不到用例」，而这一点本来就是整文件运行的既有边界。

**并行跑多个单文件进程（限制并发 2~4）。** 不改契约，但每个进程都要自己加载 MaaFW 与 ONNX/OpenCV，内存翻几倍；而且 `runTest` 内部已经用 worker 池按 CPU 并行，外面再叠一层并行收益很低、互相抢 CPU。

**解析 maa-tools 打印的失败文本行（`  <图> <节点> should hit but missed`）来定位用例。** 也能做，但要自己写正则去啃四类文案（`missing detail.`、`should hit but missed`、`box mismatch. Expect …`、`should missed but hit`），而且拿不到算法名和识别框数值——`error_details.json` 里这些都是结构化字段。文本解析只在日志里给人看，机器判定一律走明细文件。

**直接调 maa-tools 的全量 `test`（不过滤）。** 一次进程、改动最小，但它会跑本不该跑的用例（用户只选了一个目录），而且同样拿不到我们需要的归属关系，还得多写一层「哪些文件属于这次选择」的反推。

## Consequences

- 一条用例从「改完代码到看到结果」大约 3～15 秒（MaaFW 已缓存），比全量快一个数量级；
- 文件级目标合成一批之后，10 个文件 5.3 秒、45 个文件十几秒（早期的逐文件进程是 3~4 分钟）；
- 批量跑的结论粒度是**文件**：靠解析 maa-tools 打印的组名分发，因此它一旦改输出格式，`lib/results.mjs` 要跟着改（单测覆盖了解析规则）；要精确到用例就单独跑那一条；
- 代价是**过滤逻辑依赖 loader 的组名格式**（`(controller-resource)name`）和 `imageRoot` 字段。`tests/scripts/loader.mts` 改了这两处拼法，`runner/lib/filter.mjs` 要同步改，dry-run 能立刻暴露问题；
- 整文件运行只能得到「有没有失败」一个结论，说不出第几条 —— 这是 `runTest` 返回值决定的，测试面板里只能把子用例统一标记，并提示用户展开后单跑定位；
- 部分截图缺失时仍会继续跑（`maa-tools` 行为），我们只能把缺失清单打出来，不能替它判失败；
- 极端情况下（两个文件的 controller、resource、`configs.name`、图片名与命中节点全都相同）无法区分，两个文件的用例都会被跑到。当前 MaaEnd 仓库实测没有这种冲突。
