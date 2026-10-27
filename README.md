# Bubu AI · Local-first AI File Workspace

> **当前状态：Issue #1 最小桌面工程已实现，Owner 已完成人工 dev/start 启动验收，待最终 Code Review。** 当前仅包含应用壳和版本 IPC；下列 V0.1 业务功能仍为 planned。

Bubu AI 是以「一二布布」为情感化交互主题的桌面 AI 工作台，通过自然语言搜索、读取、理解并整理**用户主动授权的本地文件**。

## V0.1 范围

- AI 对话和可配置第三方模型
- 用户选择授权目录、搜索本地文件与读取有限文本格式
- 文件分类整理：结构化方案 → 审批 → 执行 → 核对
- 任务状态和真实结果记录，一二布布状态反馈

不包括：屏幕/鼠标控制、任意 Shell、静默删除或覆盖、MCP 商店、知识库/向量索引。

## 先读什么

1. [AGENTS.md](AGENTS.md)：Codex 等编程助手必须遵守的约束
2. [docs/README.md](docs/README.md)：产品、设计、功能和开发文档导航
3. [产品 PRD](docs/product/PRD-v0.1.md)
4. [工作台设计规范](docs/design/WORKBENCH-V1.2.md)
5. [开发与分支规范](docs/development/workflow.md)

## 开发说明

工程使用 pnpm workspace，唯一应用在 `apps/desktop/`。Electron Main、sandbox Preload 和 React Renderer 分离，通过 electron-vite 构建，不包含 Agent、模型连接或文件业务。

环境要求：Node.js `>=22.22.3 <23`、pnpm `10.33.0`。`package.json` 固定直接依赖版本，`pnpm-lock.yaml` 固定完整依赖树；仓库 `.npmrc` 使用公共 npm registry，不修改系统配置。

```bash
pnpm install --frozen-lockfile
pnpm setup:electron
pnpm typecheck
pnpm lint
pnpm test
pnpm build
node scripts/check-repo-hygiene.mjs
```

以上命令均不打开 GUI。`pnpm test` 只运行 Node 环境的 Vitest，Electron API 被 mock；HMR/CSP 测试只在内存中转换 HTML，不监听端口，不启动 Electron 或浏览器。Mock 测试不代表 Electron 运行验收已经通过。

安装脚本采用 pnpm 10 白名单与 `strictDepBuilds`：仅允许锁定的 `esbuild` 版本执行脚本，新增脚本必须单独审查。Electron `45.0.0` 没有安装期脚本，不额外授予其安装脚本权限。

**Electron 首次准备与恢复**：Electron 45 的官方 CLI 支持按需下载，但当前 `electron-vite 5.0.0` 直接读取 Electron 包的 `path.txt`，不会触发这一步。因此首次安装依赖后，或恢复 `node_modules` 后遇到 `Electron uninstall`、缺少 `path.txt` / 可执行文件时，先运行 `pnpm setup:electron`。该命令仅调用项目已安装的官方 `install-electron`，为当前平台与架构准备锁定版本的二进制，不启动桌面程序；Windows 与 macOS 使用同一命令。官方安装器检测到匹配版本、路径和可执行文件已存在时直接退出，可重复运行；普通 `pnpm install` 不会自动调用它。

首次准备需要网络访问官方 Electron GitHub Releases，并使用包内校验和校验下载；下载缓存由官方安装器管理。失败时保留具体错误，排查网络或权限后重试 `pnpm setup:electron`，不要删除全部依赖、关闭 TLS 校验或修改系统代理来绕过错误。该步骤和路径检查通过仍不代表 GUI 启动已验收。参见 [Electron 官方二进制安装说明](https://www.electronjs.org/docs/latest/tutorial/installation#binary-download-step)。

以下命令会打开 **Bubu AI 桌面窗口**。自动化助手必须先按 [AGENTS.md](AGENTS.md) 说明目的、命令、窗口和清理方式，并获得 Owner 本次明确许可；用户可在自己的终端主动执行。

```bash
pnpm dev        # Vite 开发服务 + Electron 窗口；占用 127.0.0.1:5173
pnpm build
pnpm start      # 用 Electron 加载 out/ 中的构建产物
```

开发服务端口被占用时直接失败，不切换到其他端口。结束 GUI 验证后，在启动命令的终端按 `Ctrl+C` 退出；macOS 上仅关闭窗口可能保留应用进程。只清理本次任务启动的进程。

**验证状态**：Owner 已亲自验证 `pnpm dev` 与 `pnpm start` 正常启动 Electron，窗口显示初始化页面和应用版本 `0.1.0`，Electron 二进制缺失问题已解决。HMR、完整刷新、Renderer 运行期 Node.js 隔离、普通/最小窗口尺寸及应用窗口截图尚未单独验证；Mock 测试与 Build 不能代替这些检查。`pnpm build` 只编译应用，不生成安装包或发布版本。

当前主分支为 `master`；Issue #1 的唯一开发分支是 `chore/1-electron-bootstrap`，以 `master` 为基线。分支、提交、推送和 PR 按授权分别执行，不自动将主分支改为 `main`。

## 角色素材

一二布布形象遵循原作者相关使用约定。可追溯来源和实际纳入应用的素材在接入时单独登记，源代码的开源许可不代表拥有对角色素材的再许可权。具体见 [素材接入规范](docs/design/ASSET-HANDOFF.md)。

`docs/design/reference/preview.html` 是独立的离线设计演示；当前应用壳没有导入其中的模拟业务或角色图。原版角色素材仍待逐张核验，见 [素材来源](docs/design/ASSET-CANDIDATES.md) 与 [接入规范](docs/design/ASSET-HANDOFF.md)。
