# Bubu AI · 组件、状态与前后端事件契约（面向 Codex）

> 此文档是设计层接口建议，不代表已经实现。不得把示例字段直接当成可绕过安全校验的后端 API。

## 1. UI 组件层级

```text
WorkbenchShell
├── WindowFrame
│   ├── AppBrand / RealProviderStatus
│   └── PaneToggle
├── Sidebar
│   ├── Navigation (Workspace / Sessions / Files / Runs / Settings)
│   ├── SessionList
│   └── MascotCompanion (independent PNG/GIF)
├── ChatWorkspace
│   ├── ChatHeader
│   ├── ConversationViewport
│   │   ├── WelcomeHero
│   │   ├── ChatMessage
│   │   ├── FileSearchResultCard
│   │   ├── ToolCallTimeline
│   │   ├── TaskPlanSummary
│   │   └── TaskResultSummary
│   └── ChatComposer (model/tool/attachment/status)
└── ContextPanel
    ├── OnboardingContext
    ├── SearchContext
    ├── RunProgressContext
    ├── FilePlanReview
    │   ├── PlanStats
    │   ├── FilePlanList (virtualized >100 rows)
    │   ├── PlanOperationRow (expand source/target)
    │   └── StickyApprovalBar
    ├── ExecutionResultContext
    └── FileSpaceContext
```

**依赖方向**：`renderer/ui -> shared/types`；`preload` 暴露具名桥；`main -> agent-core -> file-tools`。React UI **不能** import `fs`、`child_process`、Electron Main 模块或云供应商密钥。

模型设置采用独立 Settings 主页面，与工作台二选一挂载，共用 Header 和 Sidebar。ProviderSettings 组合 ProviderList、ProviderForm、ProviderDiagnostics；采用选定方案 A：1440/1100/1024px 的配置列分别为 224/224/208px，均保留双栏，横向设置行与下方诊断分别组织。Renderer 铺满原生窗口客户区，Settings 在 1250px 以下提前将主导航收为 70px 图标栏，聊天的后续响应式决定见下文 Issue #9。列表、详情独立滚动，只有修改时才显示保存/放弃区。设置页不显示 Hero、Composer 或 ContextPanel。返回、新建、切换、删除统一保护未保存修改；ModalDialog 复用原生 showModal() 为检测、删除和未保存确认提供真正的模态边界；默认聚焦取消/继续编辑，支持 Tab 约束、Escape 与焦点返回。明确放弃或离开后清理密码框；Key 不回显且提交前清空输入。连接测试与工具探针分别确认接收方、固定内容和潜在用量；显示“上次检测通过 + 时间”，不显示虚构在线状态。文件操作仍禁用，文本聊天见下文 Issue #6。

探针 committing 与普通表单保存分开：committing 不阻塞返回工作台或浏览配置，不宣称取消成功；真实持久化由既有 Main 服务维护，重新进入页面刷新安全快照。

Issue #6 阶段 B 已接入 useChat / SessionList / MessageList / MessageItem / ChatComposer / ModelSelector，Stage B 及 P1 Close-out 源码 Review、Owner Stage C macOS 验收均已通过，已经 PR #8 合入 master。文本聊天只消费 shared/chat.ts 的具名 API 和结构化状态，不采用下文仍处于设计期的 Agent/文件事件。WorkbenchShell 保留既有布局与 ContextPanel；历史外发、停止后导航和会话删除复用真正模态，默认安全操作并恢复焦点；文件卡片、工具、审批及附件仍未实现。确切协议和明文存储说明见 [AI 对话](../features/chat.md)。

Issue #6 已经 PR #8 合入 master。Issue #9 在上述契约不变的前提下实现选定的方案 A（待本轮源码/视觉 Review）：轻量 SessionList 使用现有 title/messageCount/updatedAt；用户气泡、助手连续正文、MessageContent 的有限安全排版和 CopyButton 的主动复制；默认收起的 ContextPanel 展示所选发送模型、最近回复来源及持久化状态，不显示常驻三步引导。中小窗口展开右栏时，会话栏折叠，但「最近会话」模态仍可键盘访问；关闭右栏返回同一 toggle 焦点。欢迎建议只填草稿并聚焦输入，不自动发送。useChat、订阅与事件序号、取消、committing、历史外发确认和 Main/Preload 全部沿用。安全排版及剪贴板降级边界见 [AI 对话](../features/chat.md)。Settings 不重新设计。

## 2. 关键前端 props（示例）

```ts
export type MainView =
  | 'welcome' | 'chat' | 'analyzing' | 'approval' | 'completed' | 'files';
export type RunStatus =
  | 'created' | 'scanning' | 'planning' | 'awaiting_approval'
  | 'executing' | 'verifying' | 'completed'
  | 'partially_completed' | 'failed' | 'cancelled';

export interface WorkspaceScopeView {
  scopeId: string;
  displayPath: string; // 展示路径，仅服务端确认的授权范围可进入工具执行
  mode: 'read' | 'read-write';
}

export interface FileOperationView {
  id: string;
  kind: 'move' | 'skip';
  displaySourcePath: string;
  displayTargetPath?: string;
  skipReason?: string;
  execution?: 'pending' | 'running' | 'success' | 'skipped' | 'failed';
  errorMessage?: string;
}

export interface FilePlanView {
  planId: string;
  version: number;
  digest: string;
  scopeId: string;
  operations: FileOperationView[];
  expiresAt?: string;
}

export interface ApprovalDecision {
  planId: string;
  version: number;
  digest: string;
  decision: 'approve' | 'reject';
}

export interface MascotProps {
  state: 'idle' | 'searching' | 'thinking' | 'working' | 'waiting' | 'success' | 'error';
  size: 'avatar' | 'compact' | 'hero';
  reducedMotion?: boolean;
}
```

计划审批数据不可由前端自行构造作为安全凭据，`planId/version/digest` 需要在 Main/Runtime 校验，执行前逐项再核对权限和文件状态。

## 3. 最小结构化事件（示例）

```ts
export type AgentUiEvent =
  | { id: string; seq: number; runId: string; type: 'run.started' }
  | { id: string; seq: number; runId: string; type: 'run.status'; status: RunStatus }
  | { id: string; seq: number; runId: string; type: 'message.delta'; delta: string }
  | { id: string; seq: number; runId: string; type: 'tool.started'; toolCallId: string; tool: string }
  | { id: string; seq: number; runId: string; type: 'tool.finished'; toolCallId: string; ok: boolean; summary?: string }
  | { id: string; seq: number; runId: string; type: 'scan.progress'; processed: number; total?: number }
  | { id: string; seq: number; runId: string; type: 'approval.required'; planId: string; version: number; digest: string }
  | { id: string; seq: number; runId: string; type: 'operation.finished'; operationId: string; status: 'success' | 'skipped' | 'failed' }
  | { id: string; seq: number; runId: string; type: 'run.finished'; status: Extract<RunStatus, 'completed' | 'partially_completed' | 'failed' | 'cancelled'> };
```

- 前端用 `runId+seq` 去重并按序更新 UI，必要时重新读取 Run Snapshot，不能根据自然语言消息直接判定文件修改成功。
- `scan.progress` 只有 `total` 确定时才有进度百分比；只有 `processed` 时显示数目与“不定量扫描中”。
- 恢复、重连、报错、供应商切换后的历史内容发送策略应由服务端状态和权限规则控制。

## 4. UI 状态测试用例

1. Welcome：未配模型、未授权目录、授权拒绝、已完成配置。
2. Chat：找到 0/1/多文件、文件被移动、文本不支持、模型不支持工具调用。
3. Analyzing：扫描中总量未知、扫描进度已知、解析失败、停止、超时。
4. Approval：7/1000 项计划、完整路径展示、审批双击、过期计划、拒绝、授权已收回。
5. Result：成功、部分成功、全部失败、冲突跳过、取消后已有部分写入。
6. File Space：无目录、多个授权目录、只读权限、路径很长、不存在的文件。
7. UI 通用：1100×800/1024×720、键盘导航、Tab 焦点、中文输入法、reduced-motion、暗色系统下保持浅色设计。
