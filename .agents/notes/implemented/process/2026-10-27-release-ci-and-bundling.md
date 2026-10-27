# Agent Note: 发版链路——esbuild 打包 + 两段式 CI

Status: implemented

## Problem

插件得能让别人装进 VS Code。发布链路上有三个绕不开的问题：

1. **包怎么打**。仓库用 pnpm，而 `@vscode/vsce` 判断「要带哪些生产依赖」靠的是内部执行 `npm list`。pnpm 的软链接 `node_modules` 会让它报出一串 missing（`math-intrinsics`、`dunder-proto` 这类间接依赖被当成直接依赖检查），打包直接失败。
2. **包里的运行时依赖从哪来**。扩展和 runner 都 import `jsonc-parser`，装到别人的 VS Code 里没有 `node_modules` 可用。
3. **怎么自动发**。手工在本地 `vsce publish` 依赖本机环境和登录状态，不可复现，也容易把错版本发出去。

## Decision

**用 esbuild 把运行时依赖打进 `dist/`，包里不带 `node_modules`。**

- `scripts/bundle.mjs` 产出两个文件：`dist/extension.js`（CommonJS，`vscode` external，`package.json` 的 `main` 指向它）和 `dist/run-single-test.mjs`（ESM，扩展 spawn 的就是它）。
- `jsonc-parser` 从 `dependencies` 挪到 `devDependencies`，`package.json` 里不再有 `dependencies`；`scripts/bundle.mjs` 里设 `mainFields: ["module", "main"]`，强制用它的 esm 版（umd 版在运行期 `require("./impl/xxx")` 懒加载，打不进包）。
- `.vscodeignore` 只留 `package.json`、`README.md`、`dist/**`、`LICENSE`（有的话）。打出来 9 个文件约 127KB。
- `src/runner.ts` 里 runner 路径改成 `<extensionPath>/dist/run-single-test.mjs`；改了 `runner/**` 必须重新 bundle（`pnpm run watch:bundle`）。

**CI 参考 `he0119/vscode-bangumiplan` 的结构，拆成两个工作流。**

- `.github/workflows/test.yml`：push / PR 到 `main` → `pnpm install --frozen-lockfile` → `pnpm run check` → `pnpm run test:all` → `pnpm run package`（试打包本身也是检查）→ 上传 VSIX artifact。
- `.github/workflows/release.yml`：打 `v*` 标签 → 核对标签与 `package.json` 版本一致 → 类型检查 + 单测 → `HaaLeo/publish-vscode-extension@v2` 发 VS Marketplace（`secrets.VS_MARKETPLACE_TOKEN`）→ 配了 `secrets.OPEN_VSX_TOKEN` 才发 Open VSX → `softprops/action-gh-release@v2` 建 Release 附 vsix。

**`pnpm install` 的构建脚本白名单写进 `pnpm-workspace.yaml` 的 `allowBuilds`**：`esbuild: true`、`@vscode/vsce-sign: false`。

## Alternatives considered

**不打包，直接发 `out/` + 生产依赖。** 三种写法都试过，全不通：`vsce package` 因 `npm list` 报错；`vsce package --no-dependencies` 能出包但 `node_modules` 进不去（`.vscodeignore` 里对 `node_modules` 的否定规则无效），装上去就 `Cannot find module 'jsonc-parser'`；改用 `node-linker=hoisted` 生成 npm 风格实体目录，`npm list` 照样把 hoisted 的间接依赖当直接依赖报 missing。

**用 rolldown 打包。** rolldown 1.2.15 实测能打，但同样要设 `resolve.mainFields` 才绕过 `jsonc-parser` 的 umd 坑，产物和耗时基本一致（esbuild 约 15ms / 79KB + 69KB，rolldown 约 40ms / 79KB + 70KB）。它擅长多入口拆包、Rollup 插件生态、生成 `.d.ts`，我们这两入口、各 80KB、无 CSS 无 webview 的规模用不上，多一套工具链只是多一处要维护的配置。

**webpack。** VS Code 老模板的选择，要 `webpack.config.js` 加 `ts-loader`/`swc` 和一堆 loader 配置，对两个入口的项目明显过重。

**只手工维护一个精简 `node_modules`。** `jsonc-parser` 自己还有 6 个 `impl/*` 文件，升级依赖时得手工同步，迟早漏。

**release-drafter（参考仓库有这一份）。** 它要配合 PR 标签才能分出「新功能/修复」的条目。这个仓库的提交本身是中文约定式提交，`generate_release_notes: true` 已经够用，少一个工作流少一处配置。

## Consequences

- 新增运行时依赖必须让 esbuild 打进去，且不能写进 `dependencies`，否则装上去就 `Cannot find module`（`AGENTS.md` 硬约束里有这条）；
- 改了 `runner/**` 或 `src/**` 后，扩展跑的是 `dist/` 里的产物，忘了 bundle 就会以为「改了没生效」；
- 发布是不可逆操作，所以 release 工作流在发布前比对标签和版本号，不一致就停在核对那一步；
- 包里只带 `dist/` 与 `dist/*.map`，用户报错时主要看输出面板日志——这是「包小 + 自包含」的代价，暂时可接受；
- CI 用 Node 22（插件的最低要求），顺带守住「别用 Node 24 才有的 API」这条线。
