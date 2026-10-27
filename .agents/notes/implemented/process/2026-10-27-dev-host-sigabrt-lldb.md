# Agent Note: 远端调试窗口每隔十来秒被 SIGABRT 杀掉，禁用 lldb 绕开

Status: implemented

## Problem

在 Remote-SSH 环境里按 F5 调试本插件，「扩展开发宿主」窗口常常起不来多久就整个关掉：窗口消失，客户端和服务端都**看不到任何 JavaScript 报错**。今天一天内 43 次调试窗口启动里有 12 次这样死掉，存活时间都停在 9～15 秒。

最先怀疑的是插件自己（那段时间正在改测试面板），但排查下来跟插件无关：

- 崩溃那个窗口里，「Maa 节点测试」输出通道是 0 字节，插件连一行日志都没打；
- 服务端日志里扩展激活成功，没有 `Activating extension failed`，也没有任何未捕获异常；
- 刷新测试面板的实际开销很小（47 个测试文件、158 条用例、解析 9 毫秒），不可能把宿主搞崩。

## Decision

调试配置里提供一个多带 `--disable-extension=vadimcn.vscode-lldb` 的版本（`.vscode/launch.json` 里的「运行 Maa 节点测试插件（禁用 lldb，远端调试窗口会崩时用）」），README 的「常见问题」里写明现象和绕开办法。本次排查用的其它试验配置（`--disable-extensions`、逐个禁用）保留一个「只加载本扩展（干净模式）」作为诊断用，其余删掉。

结论是「极可能是 `vadimcn.vscode-lldb`」，不是「已证明」：

- 禁用 lldb 后连跑 8 次调试窗口，**0 次崩溃**；不禁用的 35 次里崩了 12 次（约 34%）。按这个基线，8 次全绿纯靠运气的概率约 6%；
- 但今天也有 6 次崩溃发生在 lldb **还没激活**的宿主上（它们 9～12 秒就死了，还没轮到启动收尾那批扩展），所以严格说没有闭合；
- `nekosu.maa-support` 一度被怀疑，后来用「只排除它、保留 lldb」的配置复现了崩溃，已经排除。

## Alternatives considered

**继续抓到 core dump 为止。** 那才是能一锤定音的路：`ulimit -c` 现在是 0，`/etc/default/apport` 是开着的但收不到报告；需要往 `~/.bashrc` 里加 `ulimit -c unlimited` 和 `NODE_OPTIONS=--report-on-fatalerror`，再断开重连远程窗口。放弃的原因是这轮排查已经花了一整天，而「禁用一个用不到的扩展」这个绕开成本几乎为零 —— 留着以后真再犯时再抓。

**改插件的代码去规避。** 没有任何机制上的入口：插件的代码纯 JS，只 spawn 自己的 runner 子进程，没有任何能发出 SIGABRT 的调用。在插件里加 try/catch 也拦不到进程级的 abort。

## Consequences

- 远端调试不再动不动丢窗口；代价是用不了 LLDB 那个扩展的调试功能（在调试宿主窗口里也不需要 C++/Rust 调试）。
- 根因没闭合：如果哪天禁用了 lldb 还会崩，说明判断错了，那时再按上面的 core dump 路线走，重点是看 `/var/crash` 和 `report.*.json` 里的 native 栈。
- 记录这套排查手法，下次遇到「窗口无声消失」可以直接照抄：先看 `~/.vscode-server/data/logs/<时间戳>/remoteagent.log` 里的 `signal: SIGABRT`，再看对应 `exthost<N>/remoteexthost.log` 的最后一批激活记录，然后用 `--disable-extensions` + `--disable-extension=<id>` 二分。
