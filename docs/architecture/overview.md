# Bubu AI V0.1 架构总览

> **状态：业务架构 planned；Issue #1 工程骨架已合并，Issue #3 三栏欢迎工作台已实现并通过本地源码 Review 和 Owner 标准窗口视觉验收，待 GitHub 最终 Review。** 下述业务模块尚未完成，不要为了匹配图示而过早拆十几个包。

## 技术目标

- Desktop-first / Local-first；React + TypeScript + Vite 构建 UI，Electron 承载本地能力。
- 第一阶段只搭一个 `apps/desktop`，把 Main / Preload / Renderer 的边界做好。Agent Core、File Tools、Shared Contracts 在需求形成时再拆 `packages/`；不为摆架构建空包。
- 不必在首版启动 NestJS 服务，更不需要 Go 微服务。将来确有独立服务需求时再重审架构。

## 当前工程边界

- `apps/desktop/src/main` 创建窗口并注册唯一版本查询 IPC；`preload` 只通过 `contextBridge` 暴露 `window.bubu.app.getVersion()`；`renderer` 展示三栏欢迎工作台，未开放业务入口明确禁用。
- Renderer 的 `App` 保留版本读取与失败状态，`WorkbenchShell` 仅维护右栏开合，Header / Sidebar / ChatWorkspace / ContextPanel 通过 props 组合。CSS Modules 与 `--bubu-*` Token 管理布局；没有路由、全局状态库或模拟 Run 数据。`MascotArtwork` 只接收独立素材属性，当前未传入正式素材，缺省或加载失败时回退到中性占位。
- `shared/ipc.ts` 保存桥接类型与固定通道，没有提前拆独立 package。无参数版本查询在 Main 拒绝额外参数；业务 Schema 与 Zod 随对应功能引入。
- 窗口显式启用 `contextIsolation`、`sandbox`，关闭 `nodeIntegration`。Preload 打包为单个 CJS 文件，除 Electron 自身接口外没有运行期依赖。
- IPC 同时核对窗口 WebContents 身份、主 Frame 身份和完整页面 URL。开发态仅接受固定的 `http://127.0.0.1:5173/`；构建态只接受自身 `out/renderer/index.html` 的文件 URL，不能用环境变量改成其他页面。
- CSP 在开发态用随机 nonce 允许 Vite/React HMR 脚本与样式，并仅放行本机开发服务连接；构建态禁止网络连接和内联脚本。开发态只允许可信主 Frame 的首页同地址刷新；其他页面导航、新窗口及权限请求默认拒绝。
- 默认验证流程不启动 GUI；现有 Electron 测试使用 Node + Mock，Renderer 组件测试独立使用 jsdom。Owner 已完成 Issue #1 的启动验收及 Issue #3 的真实标准窗口三栏、欢迎页、输入区域与版本显示验收。三档 Renderer 无头预览使用模拟版本桥接；实际 Electron 三档布局、滚动、右栏键盘焦点及紧凑占位新文案仍待单独验证。Renderer 运行期 Node.js 隔离、HMR、完整刷新尚未单独验证，真实窗口截图未归档；后续 GUI 操作仍须按根目录 `AGENTS.md` 单独授权。

## 逻辑分层

```text
React Renderer（可信度低、仅 UI）
  ├─ Chat + File Cards + Task Timeline + Approval + Mascot
  └─ window.bubu.*（仅具名 IPC）
               ↓ IPC（参数校验、权限判定）
Electron Main / 本地服务（可信边界）
  ├─ Conversation Service / Run Store
  ├─ Agent Runtime ── Model Adapter ── 用户选定的本地/云端 Provider
  ├─ Tool Registry ── File Executor ── 授权目录
  ├─ Permission Broker / Operation Plan / Approval
  └─ Local Persistence（初期可使用 SQLite）
```

## 进程规则

1. **Renderer**：不使用 Node `fs`，不直接操作桌面文件，不持有解密的 API Key。状态来源为结构化事件。
2. **Preload**：只暴露按领域命名的最小 API，如 `models.testConnection`、`files.pickScope`、`runs.subscribe`、`runs.approvePlan`。**禁止**通用任意路径读写、执行 Shell 或暴露完整 `ipcRenderer`。
3. **Main**：负责校验 IPC sender、输入 Schema、目录能力令牌、授权和外发检查；对涉及 IO 的工具返回可审查结果。
4. **Agent Runtime**：仅负责对话上下文、模型工具调用、任务进度、取消；不能越过执行器权限直接读写磁盘。
5. **File Executor**：确定性 Node.js 文件操作；文件分类按规则生成计划，不让模型逐文件猜测；执行前重新检查真实状态。

## 领域对象（草案）

- `Conversation` / `ChatMessage`
- `ProviderProfile` / `ModelCapability`
- `WorkspaceScope`（用户授权目录+权限级别）
- `AgentRun` / `RunEvent`
- `FilePlan`（不可变版本、digest、文件操作列表）
- `Approval`（绑定计划版本）
- `OperationResult`（实际成功、跳过、失败记录）

## ADR 准入门槛

只有长期影响多个模块、存在可讨论替代方案、已经决定实施的技术选择才需要额外 ADR。普通 Issue、Bug 和 UI 微调只在 PR 说明。不为“显得高级”创建架构文档。

## 首批验证重点

Renderer 无法越过 IPC 访问文件；未授权目录默认拒绝；写入无当前计划审批时失败关闭；取消不伪造回滚；云端模型读本地正文需要明确告知；所有工具结果都来自真实执行器。
