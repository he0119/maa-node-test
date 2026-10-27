# Agent Note: 远端调试窗口每隔十来秒被 SIGABRT 杀掉（原因未定）

Status: implemented

## Problem

在 Remote-SSH 环境里按 F5 调试本插件，「扩展开发宿主」窗口常常起不来多久就整个关掉：窗口消失，客户端和服务端都**看不到任何 JavaScript 报错**，服务端 `remoteagent.log` 里只有一句：

```text
Extension Host Process exited with code: null, signal: SIGABRT.
```

截至写这份记录：44 次调试窗口启动，13 次这样死掉（约三成），存活时间全部停在 9～15 秒，也就是「宿主启动收尾、`onStartupFinished` 那批扩展在激活」的那几秒。

## Decision

调试配置保留两个：原配置，以及带 `--disable-extensions` 的「只加载本扩展（调试窗口会闪退时用）」。日常调试优先用后者，README 的「常见问题」里写明现象、已排除的对象和继续排查的入口。**不把这个当作已解决的问题**，只是绕开。

排查过并排除的：

| 对象                  | 证据                                                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 本插件                | 崩溃那个窗口里「Maa 节点测试」输出通道是 0 字节；代码纯 JS、只 spawn 自己的 runner 子进程，没有任何能发出 SIGABRT 的调用；刷新面板实测 9 毫秒（47 个文件 158 条用例） |
| `nekosu.maa-support`  | 用「只排除它、保留 lldb」的配置复现了崩溃                                                                                                                             |
| `vadimcn.vscode-lldb` | 禁用后连跑 8 次没崩（一度以为找到了），但随后在禁用状态下又崩了一次（`exthost56`，19:35:35 起、11 秒死，lldb 根本没激活）                                             |

那个「8 次全绿」的教训：基线崩溃率约 34% 时，连续 8 次不崩的概率仍有约 6%，两三次更数不出来，得跑十几二十次才有区分度 —— 而每跑一次要人盯着窗口，成本很高。所以别再用「跑几次」猜，直接抓崩溃现场。

## Alternatives considered

**继续用「禁用某个扩展 → 跑几次」的方式二分。** 十几次才发现一次假阳性，而且每次要人工按 F5、等 15 秒、关窗口，一天也就跑几十次；崩溃率三成的情况下，要把 40 多个扩展二分开需要几百次试验。

**抓 core dump。** `ulimit -c` 是 0，`/etc/default/apport` 虽然开着但收不到报告，需要改 `~/.bashrc`（`ulimit -c unlimited`）再断开重连远程窗口；而且在没装 gdb 的情况下，apport 报告也只是个 core 文件加地址，未必能直接读出符号。

**改用 Node 的崩溃报告（下一步采用这条）。** 实测可用：给进程加上 `--report-on-signal --report-signal=SIGABRT --report-directory=/tmp` 之后，收到 SIGABRT 时 node 会写一份 `report.*.json`，里面有 `nativeStack`、`sharedObjects`（进程加载过的所有原生库）、`userLimits`、`environmentVariables` —— 足以看出是哪个原生库在地址空间里、崩在哪。落地方式是给远程 shell 的 `NODE_OPTIONS` 加这几个参数再重连；因为要改用户 shell 配置，留到下一次专门做。

## Consequences

- 日常调试用「只加载本扩展」这个配置，窗口不再动不动消失；代价是调试宿主里看不到其它扩展的行为（调本插件不需要）。
- 根因没闭合，README 里写的也是「原因还没定位」，不假装已经查清。
- 下次再犯时的动作顺序：先在 `remoteagent.log` 里搜 `SIGABRT` 找到 `exthost<N>`，看它最后一批激活的是哪些扩展、活了多久；然后开 Node 崩溃报告复现一次，读 `report.*.json` 的 `nativeStack`。这套手法本身也写进了 README。
