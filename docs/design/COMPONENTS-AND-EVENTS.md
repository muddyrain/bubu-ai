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
