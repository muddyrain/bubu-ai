# Bubu AI · Local-first AI File Workspace

> **当前状态：Issue #3 工作台已合并；Issue #5 模型供应商配置已实现，Owner 已完成 macOS Electron 保存、真实连接与 Tool Calling 检测，待 GitHub 最终 Review。** 当前 UI 可作为交付基线，后续独立迭代；退出重启后的恢复解密尚未单独确认，聊天、文件和 Agent 仍未开放。

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

工程使用 pnpm workspace，唯一应用在 `apps/desktop/`。Electron Main、sandbox Preload 和 React Renderer 分离，通过 electron-vite 构建。模型检测仅由 Main 发起，不包含 Agent、真实聊天或文件业务。

Renderer 按 Workbench V1.2 拆为 Header、Sidebar、ChatWorkspace、ContextPanel 和独立素材槽位。工作台右栏支持收起/恢复；通过「添加模型」或侧栏「设置」进入独立 Settings 主页面，返回后保留右栏开合状态。Settings 采用方案 A 的纵向模型列表与横向设置行；检测/删除使用模态确认，保存操作仅在有修改时出现。聊天输入、目录授权及文件/任务导航仍禁用。三个用法示例是静态说明，不会生成会话或执行任务。角色仍使用中性占位。

模型配置支持新建、编辑、删除、启用、选择和重启恢复；只有当前配置版本通过连接检测后才能选中。保存不联网，连接测试和工具能力检测分别确认接收方、固定测试消息和可能产生的 API 用量后才发起；不自动重试。工具探针只检查回复，不执行工具。仅支持公网域名 HTTPS/443 的 Chat Completions，使用 `max_completion_tokens: 64`；不支持该参数的端点会报告协议错误，不猜测模型能力。

API Key 仅在输入时短暂存在密码框，并经具名 IPC 交给 Main。使用 Electron 45 异步 safeStorage 加密，密文与普通配置分离；macOS 使用 Keychain，可能要求系统授权；Windows 代码路径未经实机验收，Linux 因无法可靠确认异步安全后端而暂拒绝保存。安全存储失败不降级明文。数据在 `app.getPath('userData')/model-providers/`，开发态另放 `development/model-providers/`，不进入仓库；不要把真实凭据用于截图或 Mock 测试。详见 [模型配置](docs/features/model-providers.md)。

布局以 renderer CSS 视口为准：1440px 下左右栏为 216/354px，1100px 为 216/318px，1024px 为 70/296px。中央和右栏分别滚动，Composer 留在中央底部；中央变窄时 Hero 上下排，三项示例始终保留。本期最小目标为 1024×720，不提供更窄窗口的抽屉。

Renderer 直接铺满 Electron 原生窗口客户区，不绘制第二层窗口边框、圆角或阴影。Settings 独立于工作台断点，在 1250px 以下将主导航收为 70px 图标栏；1440/1100/1024 三档的配置列分别为 224/224/208px，详情使用剩余空间。

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

以上命令均不打开 GUI。Vitest 默认使用 Node 环境，Electron、Provider 网络、安全存储和存储写入测试均 Mock；Renderer 的 `.test.tsx` 文件单独使用 jsdom。普通测试不访问真实 Keychain、不调用外部模型、不消耗 Token，也不启动 Electron 或浏览器。HMR/CSP 测试仅在内存中转换 HTML。jsdom 不进行真实页面排版，不能替代视觉验收。

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

**验证状态**：Issue #1 的初始化页面已由 Owner 验证 dev/start 启动和版本 `0.1.0`，Electron 二进制缺失问题已解决。Issue #3 已完成本地源码 Review，Owner 已在真实 Electron 标准窗口确认三栏配色、欢迎页、底部输入区域和版本显示。1440×900、1100×800、1024×720 及右栏折叠态已有 Renderer 无头预览，使用模拟版本桥接，不代表真实 Electron 验收；紧凑占位文案修复另有 1440×900、1024×720 无头预览。三档实际 Electron 视口、独立滚动、右栏开合与键盘焦点、系统深色模式、减少动态效果、HMR、完整刷新及 Renderer 运行期 Node.js 隔离仍未单独验证，紧凑占位新文案待真实窗口确认。真实应用截图尚未归档；无界面测试与 Build 不能代替这些检查。`pnpm build` 只编译应用，不生成安装包或发布版本。

Issue #5 的 [Owner 验收记录](https://github.com/muddyrain/bubu-ai/issues/5#issuecomment-6463177879) 确认配置保存、Key 不回显、真实连接与 Tool Calling 探针成功；这是当时的真实测试结果，不代表持续在线或执行了文件工具。退出重启后的恢复解密，以及选为工作台模型后返回的独立验收仍未确认。当前视觉可接受但不是最终 UI/UX 版本。自动化与无头预览仍全部使用 Mock，不能代替这些人工检查。

当前主分支为 `master`；Issue #5 的唯一开发分支是 `feat/5-model-providers`，以已合并 Issue #3 的 `master` 为基线。分支、提交、推送和 PR 按授权分别执行，不自动将主分支改为 `main`。后续真实 Keychain、供应商探针及 Electron GUI 操作仍须 Owner 本次单独授权。

## 角色素材

一二布布形象遵循原作者相关使用约定。可追溯来源和实际纳入应用的素材在接入时单独登记，源代码的开源许可不代表拥有对角色素材的再许可权。具体见 [素材接入规范](docs/design/ASSET-HANDOFF.md)。

`docs/design/reference/preview.html` 是独立的离线设计演示；当前应用壳没有导入其中的模拟业务或角色图。原版角色素材仍待逐张核验，见 [素材来源](docs/design/ASSET-CANDIDATES.md) 与 [接入规范](docs/design/ASSET-HANDOFF.md)。
