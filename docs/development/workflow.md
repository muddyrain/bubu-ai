# Bubu AI 开发工作流 · Git 与文档治理

> 核心目标：**Codex 是受任务约束的实现者；用户负责需求批准、Review 与合并。**

## 1. 唯一任务来源

GitHub Issue 是任务的唯一长期入口。每个 Issue 最少有：目标、为什么需要、范围 / 非范围、验收标准、依赖、风险。不要用 `A01`、`B01` 等文件命名任务。

在 Issue 中允许临时核对清单与执行进度；PR 里写代码变更、测试和 Review 结论。聊天内容可以用于临时讨论，但不能当作唯一的需求依据。

## 2. 开发闭环

```text
Issue（范围/验收标准）
  → Codex 阅读 AGENTS 与相关文档
  → 简短实施计划（Issue/聊天）
  → 你允许后在对应分支小步实现
  → 本地测试 + 自检
  → PR（描述、证据、风险）
  → 人工 Code Review
  → 必要修改并重测
  → 用户批准合并，清理已合并分支
```

首次 PR-001 是 Electron/React/TS 工程骨架，**不接模型、不做真实文件操作、不实现 Agent Runner**。可视化组件与业务功能在后续独立 Issue/PR 完成。

## 3. 分支与提交

- 主分支 `main`，建议 GitHub 设置 PR 合并保护与必需 CI 检查。保护实际生效需要在仓库设置中配置，`AGENTS.md` 本身不能阻止人工绕过。
- 按 Issue 建分支：`feat/12-file-search`、`fix/23-path-guard`、`chore/1-electron-bootstrap`、`docs/9-feature-spec`。
- **默认不允许 Codex 自动创建分支、commit、push、PR、merge**；你明确授权某一步才执行该步。不要开多个“备选实现”分支。
- 一个 Issue → 一个主要分支 → 一个 PR；复杂需求先拆 Issue，再按有验收价值的小块分 PR。
- `Conventional Commits`：`feat: ...`、`fix: ...`、`chore: ...`、`docs: ...`。禁止 force-push 和重写已共享历史；任何破坏性 Git 操作需要特别确认。

## 4. 文档生命周期

| 信息 | 放哪里 | 是否应入仓库 |
|---|---|---|
| 用户需求、长期版本范围 | `docs/product/` | 是 |
| 已评审 UI / 组件 / Token | `docs/design/` | 是 |
| 能力如何用、边界、状态、限制 | `docs/features/` | 是 |
| 长期架构与重大决策 | `docs/architecture/` | 是 |
| 测试 / Review / Git 规范 | `docs/development/` | 是 |
| 单次开发计划、执行进度、Bug 分析 | GitHub Issue / PR | **不额外建 MD** |
| 临时草稿与调试笔记 | 仓库外 / `.local-notes/` | 否 |

- 变更功能优先**修改已有功能文档**；同一个能力不创建 `file-search-01.md`、`file-search-final.md`、`file-search-v2.md`。
- `docs/features` 每篇都有状态，开始时 `planned`；实现后才更新为 `implemented`，说明已验证的范围和限制。
- 纯内部重构不需要新的用户功能文档；修 Bug 更新相关测试和 Issue/PR 即可。
- 不为每个组件、Hook、新样式文件开一篇文档。

## 5. 每个 PR 的最小证据

- Issue 链接、变更目标与非目标、主要文件、行为变化。
- `typecheck`、`lint`、`test`、`build` 的实际运行结果；未运行必须写原因，禁止凭空勾选。
- UI 改动要有对应视图截图与不同窗口宽度检查；文件工具要有授权、冲突、拒绝、错误情况测试。
- 相关功能文档更新并准确标注实现状态。
- 由你 Review 后才进入合并，不能 Codex 自评通过就算审核通过。

## 6. 结束后清理

PR 合并后删除对应已合并功能分支（不做 force-delete）。Issue 关闭，保留 PR 讨论作为变更记录。发现过期文档时原位修订或删除，**不要叠加一份“最新版本”**。

## 7. 给 Codex 的首次任务话术

```text
先读取仓库根目录 AGENTS.md 和 docs/README.md，再读取当前 Issue 及相关产品/设计/功能文档。
现在只处理 PR-001：创建 Electron + React + Vite + TypeScript 的最小可运行应用壳，
配置严格类型检查、lint、测试与具名 preload IPC 基础接口。
先列出拟修改文件和验收步骤；不要擅自创建额外分支、任务编号文档、提交或推送。
禁止加入模型 API、文件操作业务代码、Agent Loop、知识库、MCP 等后续功能。
结束时在回复中列出实际修改、运行的测试及未解决风险，供我 Code Review。
```
