# Agent Note: 远端调试宿主 SIGABRT 调查记录

Status: implemented

## Problem

在 Remote-SSH 环境里按 F5 调试本插件，「扩展开发宿主」窗口常常起不来多久就整个关掉：窗口消失，客户端和服务端都**看不到任何 JavaScript 报错**，服务端 `remoteagent.log` 里只有一句：

```text
Extension Host Process exited with code: null, signal: SIGABRT.
```

一天下来统计到 47 次调试窗口启动、8 次这样死掉（约 17%），存活时间集中在 9～15 秒，也就是扩展宿主启动收尾、`onStartupFinished` 那批扩展在激活的那几秒。主窗口那个长期运行的宿主（不加载本插件）一直没出过事。

## 当时捕获的现场

扩展宿主进程在事件循环里自己调用 `abort()`，栈是：

```text
frame #0  libc.so.6`abort
frame #1  libc.so.6`___lldb_unnamed_symbol_29974
frame #2  libc.so.6`__assert_fail
frame #3  node`uv__io_poll(loop=..., timeout=0) at linux.c:1427
frame #4  node`uv_run(...) at core.c:460
frame #5  node::SpinEventLoopInternal(...)
```

对应 libuv 1.52.1（node 24.22.1 自带，VS Code 1.143.1 的远端 server 用它）的这段代码：

```c
if (!epoll_ctl(epollfd, op, fd, &e))
  continue;

assert(op == EPOLL_CTL_ADD);
assert(errno == EEXIST);   /* ← 死在这里 */
```

即：libuv 把一个 fd 注册进 epoll 时，内核返回了**不是** `EEXIST` 的错误，libuv 没做任何降级处理，`assert` 失败直接把整个进程 abort 掉。

用 eBPF 抓到的那次失败是：

```text
13:32:40 EPOLL_FAIL pid=3730448 comm=MainThread epfd=14 op=1 fd=76 errno=9
```

`op=1` 是 `EPOLL_CTL_ADD`，`errno=9` 是 **EBADF**（文件描述符无效）。同一个进程在崩溃前 3 秒里还有 41 次 `errno=17`（EEXIST，正常，libuv 会改用 MOD）和 11 次 `errno=2`（ENOENT，正常），只有这一条 EBADF 是致命的。fd 快照显示 76 号在被关掉之前是个 socket，崩溃那一刻已经从 fd 表里消失。

所以链条是：**某处代码把一个仍被 libuv 监视队列引用的 fd 关掉了 → libuv 去注册这个已失效的编号 → 内核回 EBADF → libuv assert 失败 → 整个扩展宿主被 abort**。

调查时参照了 libuv 上游 issue [#5129](https://github.com/libuv/libuv/issues/5129) / [#5130](https://github.com/libuv/libuv/issues/5130)，其中讨论了并发关闭引发的错误处理。当时检查的 1.x 代码仍包含这处断言；本记录不持续跟踪上游修复，重新排查时应核对实际 libuv 版本。

当时还观察到：本插件输出通道为空；禁用 `nekosu.maa-support`、`vadimcn.vscode-lldb` 或 `ms-vsliveshare.vsliveshare` 后仍出现过崩溃；`Ctrl+F5` 不挂调试器也会崩。这些现象不足以定位关闭 socket 的代码，也不能仅凭“插件是 JavaScript”就排除其触发底层错误的可能。

另外还发现过第二类崩溃：`uv__epoll_ctl_flush` 里 `if (rc != (int) n) abort()`，因为 libuv 1.52.1 默认用 io_uring 批量提交 `epoll_ctl`，而内核 7.0.0-38 上 `io_uring_enter` 会部分完成。用 `kernel.io_uring_disabled=2` 可以让 libuv 退回普通 `epoll_ctl`（`io_uring_setup` 返回 EPERM，libuv 自己会降级），这一类崩溃随之消失；但 EBADF 这一条与 io_uring 无关，治不了。

## Decision

保留「只加载本扩展」调试配置，用于缩小排查范围；关闭后可重新打开。README 只写症状、临时操作和本记录的链接，不把本次现场推广成所有闪退的根因。

当前没有足够证据在扩展代码中添加针对性修复。进一步调查需定位关闭文件描述符的代码，或核对 libuv 对这类错误的处理；向上游反馈时应附具体版本与最小复现，而不是直接断言某个扩展无关。

## Alternatives considered

**仅凭输出为空或没有原生调用就排除插件。** 这不能排除 JavaScript 操作触发宿主底层错误，故只保留为当时观察，不作排除结论。

**为所有闪退禁用系统功能。** 当时关闭 io_uring 只影响其中一类崩溃，也改变系统全局行为，不作为插件的通用操作要求。

## 排查手法（下次遇到「窗口无声消失」可以直接照做）

1. 服务端日志 `~/.vscode-server/data/logs/<时间戳>/remoteagent.log` 里搜 `signal: SIGABRT`，确认是信号杀进程而不是正常退出；对应宿主细节在同目录 `exthost<N>/remoteexthost.log`。
2. 想留 core：`sudo sysctl -w kernel.core_pattern='/var/crash/core.%e.%p.%t'`，并让宿主进程的 `RLIMIT_CORE` 变成 unlimited（对已启动的进程用 `sudo prlimit --pid <pid> --core=unlimited`；也可以写进 shell 启动文件，但要注意 VS Code 会剔掉 `NODE_OPTIONS`、`LD_PRELOAD` 这类变量，`ulimit` 不受影响）。
3. 读栈：不必装 gdb，`vadimcn.vscode-lldb` 扩展自带一个 lldb，`lldb -c <core> <node 路径> --batch -o "bt 15"` 就能看；`frame variable` 还能把 libuv 的局部变量（出问题的 fd、op）读出来。
4. 抓 errno：`strace` 会把进程拖慢到让这类时序问题消失，改用 eBPF（`bpftrace`），只挂 `sys_enter_epoll_ctl` / `sys_exit_epoll_ctl` 两个点、只留 `comm == "MainThread"` 的记录。注意别把 `epoll_create`、全系统 `close` 也记进去，那会把日志撑到几百 MB，开销反而又把问题压掉。
5. 反查 fd：另起一个每秒 `ls -l /proc/<pid>/fd` 的快照循环，崩溃后就能知道出问题的编号当时是 socket、管道还是普通文件。

## Consequences

- 当时环境中的闪退会中断调试，需要重新打开窗口；历史观测比例不能作为其他机器的发生概率，也不能保证不影响正在进行的操作。
- `kernel.io_uring_disabled=2` 消掉了 io_uring 那类崩溃，是这台机器上的一个缓解措施，不是修复；设回默认值 0 就恢复原状（libuv 会重新使用 io_uring）。
- 排查期间留下的产物（core 文件、`core_pattern`、后台脚本、`~/.zshenv` 里的试探性变量）都已清理。
