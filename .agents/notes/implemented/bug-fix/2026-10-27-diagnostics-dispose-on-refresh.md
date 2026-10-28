# Agent Note: 刷新面板时清诊断，不销毁它

Status: implemented

## Problem

修改任意一个 `test_*.json` 之后，后台进程日志里出现一条没人接的异常：

```text
Error: illegal state - object is disposed
    at r.clear (…extensionHostProcess.js)
    at NodeTestExplorer.reportMissingImages (src/testController.ts)
    at NodeTestExplorer.refresh (src/testController.ts)
```

症状比一条日志严重得多：测试面板先被清空、再没建回来（保存测试文件后面板变空），`image` 下面的缺图黄色波浪线从此整场会话都不再出现。

原因是 `scheduleRefresh()` 里调了 `this.diagnostics.dispose()`，想「把旧黄线擦掉」。VS Code 的诊断集合一旦 `dispose()` 就永久作废，此后的 `clear()` / `set()` 全抛 `illegal state - object is disposed`。而 300 毫秒后的 `refresh()` → `reportMissingImages()` 第一行就是 `clear()`，必然抛；抛点在 `controller.items.replace([])` 之后，于是面板被清空、树没重建。

## Decision

1. `scheduleRefresh()` 里用 `this.diagnostics.clear()`，不是 `dispose()`。「擦掉旧黄线」和「销毁这个集合」是两件事，前者只需要 `clear()`。
2. `dispose()` 是诊断集合唯一的销毁点，和 `controller.dispose()`、事件订阅放在一起，只在插件停用时执行。
3. 加一个 `disposed` 标记：`dispose()` 置位，`refresh()` 在入口和 `await collectTestFiles()` 之后各查一次，`scheduleRefresh()` 入口查一次。窗口关闭、扩展停用之后迟到的文件监听事件和防抖定时器就不会再去碰已销毁的 `TestController` / `DiagnosticCollection`。

## Alternatives considered

**每次刷新新建一个诊断集合，旧的直接 dispose。** 能绕开「销毁后复用」，但会漏掉一整套集合的注册与注销，长会话里集合越来越多；而且 `dispose()` 之后仍然没有约束，下一个人照样可能拿到旧引用。

**在 `reportMissingImages` 外面包一层 `try/catch` 把异常吞掉。** 报错没了，面板还是空的（抛点在清空之后），只是从「报错 + 空面板」变成「静默 + 空面板」，更难查。

**不用诊断集合，改成测试面板节点描述里写缺图。** 节点描述本来就有（「缺 ADB 截图」），但黄色波浪线要的是「写用例时眼前就能看到」的效果，去掉等于把探测阶段的价值砍掉一半。

## Consequences

- 保存测试文件后面板能正常刷新，缺图黄线在一次运行内持续有效；
- 刷新路径和销毁路径彻底分开：现在只有 `dispose()` 一个地方会让诊断集合失效；
- 代价是 `scheduleRefresh()` 与 `reportMissingImages()` 都会 `clear()` 一次（重复但幂等），换来的是「文件一改立刻擦掉旧黄线，300ms 后重扫再画」的即时感；
- 验证方式：用假 `vscode` 模块加载 `out/testController.js`，连续触发两次文件变更事件。旧代码复现 2 条 `illegal state - object is disposed` 且面板节点数 1 → 0；改后 0 条异常、面板节点数保持 1。
