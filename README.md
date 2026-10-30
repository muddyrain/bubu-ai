# Bubu AI · Local-first AI File Workspace

> **当前状态：Issue #1/#3/#5/#6 已合并；Issue #9 方案 A「对话优先」已完成源码 Review 和发布准备检查，Git 发布待 Owner 授权。** 文件和 Agent 仍未开放；Issue #9 无头截图只使用 Mock，真实 Electron 验收范围见下文。

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

工程使用 pnpm workspace，唯一应用在 `apps/desktop/`。Electron Main、sandbox Preload 和 React Renderer 分离，通过 electron-vite 构建。模型检测和聊天流只由 Main 发起，不包含 Agent 或文件业务。

Renderer 按 Workbench V1.2 拆为 Header、Sidebar、ChatWorkspace、ContextPanel 和独立素材槽位。工作台右栏支持收起/恢复；通过「添加模型」或侧栏「设置」进入独立 Settings 主页面，返回后保留右栏开合状态。Settings 采用方案 A 的纵向模型列表与横向设置行；检测/删除使用模态确认，保存操作仅在有修改时出现。聊天现可新建/切换/删除本地会话、选择已验证模型、发送纯文本、查看流式回答和停止。Enter 发送、Shift+Enter 换行，中文输入法合成期间不发送；阅读旧消息时不强制滚到底部，可主动回到最新。目录授权、附件和文件/任务能力仍未开放；欢迎页的三项文本建议只填入草稿，不自动发送。正式角色素材尚未接入，聊天页不使用替代插画。

模型配置支持新建、编辑、删除、启用、选择和重启恢复；只有当前配置版本通过连接检测后才能选中。保存不联网，连接测试和工具能力检测分别确认接收方、固定测试消息和可能产生的 API 用量后才发起；不自动重试。工具探针只检查回复，不执行工具。仅支持公网域名 HTTPS/443 的 Chat Completions，使用 `max_completion_tokens: 64`；不支持该参数的端点会报告协议错误，不猜测模型能力。

API Key 仅在输入时短暂存在密码框，并经具名 IPC 交给 Main。使用 Electron 45 异步 safeStorage 加密，密文与普通配置分离；macOS 使用 Keychain，可能要求系统授权；Windows 代码路径未经实机验收，Linux 因无法可靠确认异步安全后端而暂拒绝保存。安全存储失败不降级明文。数据在 `app.getPath('userData')/model-providers/`，开发态另放 `development/model-providers/`，不进入仓库；不要把真实凭据用于截图或 Mock 测试。详见 [模型配置](docs/features/model-providers.md)。

Issue #6 阶段 A 提供 `ChatService`、版本化会话存储、受限 SSE 和具名 `chat.*` IPC，阶段 B 通过 `useChat` 与纯文本组件接入。准备发送不联网、不写消息，发送先持久化占位再请求；跨配置历史绑定一次性许可，模态框明确接收方、消息类别/数量/字节和用量费用；停止实际 Abort，最终提交阶段明确返回 committing。离开工作台、切换/删除活动会话须确认，等待真实终态后继续。**聊天正文以明文 JSON 保存在 userData/chat/conversations 中**，开发态为 development/chat/conversations；这与 API Key 的 safeStorage 加密不同。草稿仅在 Renderer 内存按会话保留，不承诺重启恢复。没有自动重试、工具执行或自动迁移。配额、事件握手、断流和崩溃恢复边界见 [AI 对话](docs/features/chat.md)。

聊天布局以 Renderer CSS 视口为准：1440/1100/1024px 下侧栏为 224/216/208px，右栏按需展开为 264/264/248px；1250px 以下展开右栏时暂将侧栏收为 64px 图标栏，并保留最近会话模态入口。正文最大阅读宽度 760px，消息与右栏分别滚动，Composer 始终留在中央底部。主验收为 1100×800，最小目标为 1024×720，不设计更窄窗口的新导航系统。

Renderer 直接铺满 Electron 原生窗口客户区，不绘制第二层窗口边框、圆角或阴影。Settings 与工作台共用全局侧栏规则，1440/1100/1024px 下宽度均为 224/216/208px，不因进入设置页自动收成图标栏，也不受工作台右栏开合状态影响。Settings 保留紧凑的配置列表与详情双栏，详情使用剩余空间。

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

Issue #5 的 [Owner 验收记录](https://github.com/muddyrain/bubu-ai/issues/5#issuecomment-6463177879) 确认配置保存、Key 不回显、真实连接与 Tool Calling 探针成功，Owner 在 Issue #6 开始前又确认重启恢复和工作台模型选择；这些结果不代表持续在线、执行了文件工具或已验收真实流式聊天。当前视觉可接受但不是最终 UI/UX 版本。自动化与无头预览仍全部使用 Mock，不能代替人工检查。

Issue #6 的 [Stage C Owner 验收记录](https://github.com/muddyrain/bubu-ai/issues/6#issuecomment-6486475136) 确认真实模型回答、两轮连续流式与上下文、停止生成、会话切换及重启恢复、中文 IME/Enter/Shift+Enter/滚动，以及接收方、跨供应商历史确认和异常反馈共 6 项通过。这些是 Owner 的人工结果；自动化与隔离无头预览仍全部使用 Mock。单张实机截图只证明其中可见状态，不替代其余操作记录。Windows、其他输入法及供应商 SSE 兼容性、Keychain 异常和断电恢复仍未全面实测；停止不保证供应商已产生的用量免费。

Issue #9 采用对话优先布局：右栏默认收起，按需查看发送模型、最近回复来源及明文记录状态；中小窗口展开右栏时临时折叠会话侧栏，「最近会话」仍可键盘访问。欢迎页只提供文本提问建议或模型配置入口，不自动发送。用户消息使用气泡，助手正文支持有限的安全排版，没有新增 Markdown 依赖。用户主动点击后直接复制整条回答或代码正文，写入失败或 API 不可用时才提供手动复制降级。Main 仅向当前存活、聚焦且身份和完整页面 URL 均通过校验的可信主窗口主 Frame 授予 `clipboard-sanitized-write`；剪贴板读取、子框架及其他权限仍默认拒绝。该授权针对可信页面，不限定某个复制按钮、单次用户手势或纯文本格式；没有新增剪贴板 IPC。

Owner 已在真实 macOS Electron 中确认 Issue #9 回答与代码一键复制正常，不再弹出手动复制窗口；自动化和无头预览仍使用 Mock，不触碰真实系统剪贴板。Issue #9 真实聊天 B 组尚未完成本版本复验，不能用 Issue #6 的历史验收替代，也不能据此宣称新版全部实机验收通过。文本排版与聊天契约的其他限制见 [AI 对话](docs/features/chat.md)。

当前主分支为 `master`；Issue #9 唯一开发分支为 `feat/9-chat-ux`，基于 PR #8 合并提交 `b7870dc`。提交、推送和创建 PR 需 Owner 单独明确授权，不自动合并；自动化检查不启动 GUI 或调用真实模型。

## 角色素材

一二布布形象遵循原作者相关使用约定。可追溯来源和实际纳入应用的素材在接入时单独登记，源代码的开源许可不代表拥有对角色素材的再许可权。具体见 [素材接入规范](docs/design/ASSET-HANDOFF.md)。

`docs/design/reference/preview.html` 是独立的离线设计演示；当前应用壳没有导入其中的模拟业务或角色图。原版角色素材仍待逐张核验，见 [素材来源](docs/design/ASSET-CANDIDATES.md) 与 [接入规范](docs/design/ASSET-HANDOFF.md)。
