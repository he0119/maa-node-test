# Agent Note: 打包扩展并分开检查与发布

Status: implemented

## Problem

VSIX 需要包含扩展运行依赖。pnpm 的链接布局可能让 vsce 使用 `npm list` 收集依赖时失败，直接省略依赖又会在用户机器上缺模块。发布还需要避免使用过期提交或覆盖已有版本。

## Decision

- `scripts/bundle.mjs` 用 esbuild 生成唯一运行产物 `dist/extension.js`，入口为 CommonJS。`vscode` 由宿主提供，`jsonc-parser` 等运行依赖打入产物。
- `package.json` 不设置生产依赖供 vsce 收集。bundle 选择 jsonc-parser 的 ES module 入口，避免 UMD 懒加载找不到相邻实现文件。
- VSIX 包含扩展清单、README、图标、许可证和 `dist`，不带源码、单测、插件自己的 `node_modules` 或被测仓库依赖。
- 检查工作流在向 main 推送或提 PR 时运行类型检查、构建、测试和试打包。发布工作流从 main 手动触发，检查仍为最新提交及版本标签是否可用。
- 发布工作流先创建标签与 GitHub Release、上传 VSIX，再通过官方命令发布 Marketplace 和可选的 Open VSX。市场发布失败时，已生成的版本包仍可下载排查。
- Marketplace 使用 Trusted Publishing 和短期身份凭据；Open VSX 的 token 来自仓库 secret，未配置则跳过。发布前必须配置对应服务的发布权限。

## Alternatives considered

**让 vsce 收集 pnpm 的生产依赖。** 当前布局中曾出现解析失败；使用 `--no-dependencies` 而不打包又会缺模块。因此把依赖交给 esbuild 处理。

**换用另一个打包器。** 当前只有一个运行入口，没有必须更换工具才能实现的需求。换工具不能省去 jsonc-parser 入口选择等实际约束。

**推标签后另起发布流程。** 使用 `GITHUB_TOKEN` 创建的标签不会触发其他工作流。手动触发后在一次运行里创建标签和发布，步骤更直接。

**只在本机手动发布。** 容易受本机登录与构建状态影响。常规发布走工作流；市场服务暂不可用时，可由维护者下载已有 VSIX 手动上传。

## Consequences

- 新的扩展运行依赖必须进入打包产物；被测仓库的 maa-tools 仍在运行时通过命令调用，不打进 VSIX。
- 改源码后重新构建，开发时可持续运行 watch。没有额外运行脚本或第二个产物需要同步。
- 版本变更通过 PR，发布工作流自己创建 `v<版本>` 标签。已有标签只允许指向同一提交以便重跑，不能移动到其他提交。
- `dist`、`out` 和 VSIX 不提交。pnpm 的依赖安装脚本规则由 `pnpm-workspace.yaml` 的 `allowBuilds` 管理。
- 检查使用 Node 22，代码仍须遵守插件声明的最低版本。实际命令及发布前提见 [reference](../../../skills/maa-node-test-dev/reference.md#构建与发布)。
