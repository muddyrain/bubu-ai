# Bubu AI 文档导航

> 文档的目的，是保存**长期准确的信息**。一次性的 Codex 计划、进度与 Review 总结全部放 GitHub Issue / PR，不创建任务编号文件。

## 产品与设计

| 文档 | 维护目标 |
|---|---|
| [V0.1 PRD](product/PRD-v0.1.md) | 目标用户、功能范围、验收用例与安全承诺 |
| [工作台 UI V1.2](design/WORKBENCH-V1.2.md) | 三栏布局、五态交互与设计 Token |
| [组件与事件](design/COMPONENTS-AND-EVENTS.md) | UI 组件责任与事件协议草案 |
| [角色素材](design/ASSET-HANDOFF.md) | 原版素材、占位、用途与来源记录 |
| [一二布布候选素材来源](design/ASSET-CANDIDATES.md) | 网上找到的 PNG/GIF 来源、待核验事项 |
| [交互原型（离线 HTML）](design/reference/preview.html) | 六视图模拟交互，仅供设计与实现对照；**不含真实 Agent** |
| [界面总览](design/reference/overview-six-views.png) | UI 审查参考截图 |
| [六视图独立截图](design/reference/screens/) | 欢迎、聊天、分析、审批、完成、文件空间及小窗口审批 |
| [架构总览](architecture/overview.md) | Electron 进程、模型、工具、持久化边界 |

## 功能说明（按能力，不按任务编号）

| 功能 | 现状 |
|---|---|
| [AI 对话](features/chat.md) | implemented（普通文本）：Issue #6 已经 PR #8 合并；Issue #9 聊天 UX 本地实现、待源码/视觉 Review；文件/工具仍 planned |
| [模型供应商](features/model-providers.md) | implemented：Issue #5 已合并，Owner 真实连接、工具探针、重启恢复及工作台选择通过 |
| [本地文件访问](features/local-files.md) | planned |
| [文件整理](features/file-operations.md) | planned |
| [Agent 执行与审批](features/agent-execution.md) | planned |
| [隐私与权限](features/privacy-security.md) | in-progress：模型凭据/网络边界已实现，文件权限仍 planned |
| [一二布布视觉状态](features/mascot.md) | planned |

`planned` 代表设计期功能，**不是应用已经支持**；每个功能 PR 实际通过验收后，再把对应段落更新为 `implemented` 并注明验证。

## 开发规范

- [开发工作流、Git 和文档治理](development/workflow.md)
- [Code Review 检查清单](development/code-review.md)
- [功能文档模板](development/feature-template.md)

## 文档变更原则

改动用户可见功能时，**更新已有** `docs/features/<能力>.md`；调整 UI 契约时修改设计规范；架构有长期变化时修改架构文档。Bug 修复及迭代日志通常留在 PR，不另建一份 `Task-xx.md`。
