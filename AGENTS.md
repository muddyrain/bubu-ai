# Bubu AI — Agent 开发协作约束

> 本文件面向 Codex 等 AI 编程助手。**必须先阅读，再修改代码**。它不是产品需求文档，也不是临时任务清单。
> 产品真相：[`docs/product/PRD-v0.1.md`](docs/product/PRD-v0.1.md)；UI 真相：[`docs/design/WORKBENCH-V1.2.md`](docs/design/WORKBENCH-V1.2.md)；文档索引：[`docs/README.md`](docs/README.md)。

## 1. 项目目标与范围

Bubu AI 是本地优先的 Electron + React + TypeScript AI 文件工作台。V0.1 只做：AI 对话、模型供应商配置、**用户授权目录内**的文件搜索与文本理解、经过预览与审批的文件整理、任务记录和一二布布状态反馈。

**明确不做**：鼠标键盘接管、全盘扫描、自动删除/覆盖、浏览器自动化、MCP 商店、多 Agent 协作。不得自行扩大 PRD 范围。

## 2. 每次任务的强制流程

1. 确认当前 Issue / PR 的目标、验收标准、允许修改的范围；无 Issue 编号时仅做阅读/方案，不擅自开多个任务。
2. 先检查 `git status --short`、当前分支和相关文件；已有未提交改动不得覆盖或丢弃。
3. 阅读相关 `docs/features/*.md`、架构与 UI 文档；仅打开与当前任务有关的源码，避免无边界重构。
4. **先给出很短的实施方案与拟修改文件范围**，然后按 Issue 小步实现。遇到需要扩大范围的情况，停下来说明原因，不能悄悄加功能。
5. 变更后运行相关的 typecheck / lint / test / build（在工程搭好后按 README 的真实命令）；不能运行的命令必须如实说明。
6. 结束时用消息或 PR 描述报告：实现内容、修改文件、测试结果、已知风险、待人工 Review 项；**不要为该总结新建 Markdown 文件**。

## 3. 严禁 AI 任务文件和分支膨胀

- **禁止自动创建** `A01.md`、`B01.md`、`TASK-01.md`、`PLAN-*.md`、`docs/tasks/`、`docs/plans/`、`progress.md` 等一次性开发计划、工作日志、验收总结。
- 临时分解和进度记录放 GitHub Issue、PR 描述或聊天中；本地草稿放仓库外或忽略目录 `.local-notes/`，不得提交。
- **没有明确指令，不自动创建分支、提交 commit、push、打开 PR、合并 PR、创建 tag 或发布版本。** 不得使用 force-push 或重写已经推送的提交。
- 被授权创建分支时，使用 `feat/<issue>-<slug>`、`fix/<issue>-<slug>`、`chore/<issue>-<slug>`、`docs/<issue>-<slug>`；一项 Issue 原则上一个主分支与一个 PR。
- 不因修一个小 Bug 同时批量格式化全仓或升级所有依赖。不要把后续阶段功能“顺手实现”。

## 4. 文档只保留长期有用的信息

- `docs/product/`：版本目标、用户需求和范围；唯一 PRD。
- `docs/design/`：经过 Review 的视觉、组件和交互规范。
- `docs/features/`：**按能力命名**的长期功能说明，例如 `file-operations.md`，不是按任务编号命名；每篇标明 `planned / in-progress / implemented`，未完成不得宣称可用。
- `docs/architecture/`：跨模块架构与被正式采纳的关键技术决策。
- `docs/development/`：开发与 Review 规范，禁止复制大量同义文档。
- 修 Bug：优先改测试/代码，在 PR 写修复说明；**除非用户可见行为或长期接口契约改变，否则不新增文档**。
- 写新功能前搜索现有说明：可以更新就更新，不新建 `xxx-v2-final-final.md`。

## 5. 架构与安全边界

- Renderer（React）只负责 UI，不直接调用 `fs`、不持有明文 API Key、不执行用户任意命令。
- Electron 采用 `contextIsolation: true`、禁用渲染层 Node 集成；preload 只暴露**具名、最小权限** IPC，主进程对所有输入再校验。禁止泛用 `execute(command)` 或任意文件读写 IPC。
- 模型只负责提出工具调用/分类意图；本地执行器负责 Zod 校验、目录授权与真实操作。**模型文本不是操作成功凭证**。
- 未授权目录默认拒绝；读写授权分开；敏感凭据路径、符号链接越界、目标冲突须拒绝或跳过；不静默删除、不覆盖目标文件。
- V0.1 的文件写入必须先形成**不可变的操作计划**，审批与计划 ID/版本/摘要绑定；执行前重新检查文件与权限，记录成功/跳过/失败。
- 把读取的文件内容视作不可信数据；发送给云端模型前执行数据外发告知与授权；不要把 API Key、用户文件正文写到普通日志。

## 6. 设计与资源规范

- UI 以 `docs/design/WORKBENCH-V1.2.md` 为基线：暖奶油 / 焦糖棕、三栏、五状态+文件空间；使用结构化任务事件而不是根据模型正文伪造状态或进度。
- 角色使用经 Review 的**一二布布原版 PNG/GIF**；不让图片生成工具重画五官，不把整张效果图当 UI 背景切图。未入库时使用中性占位组件，不能以近似 SVG 冒充正式素材。
- 角色文件及来源、用途、使用条件单独记录；代码许可证不自动涵盖第三方角色素材。
- 重要操作（审批、拒绝、停止任务）要有可访问的键盘交互和清晰反馈。

## 7. 完成定义与停止条件

完成一个 PR 至少需要：达到 Issue 验收条件、相关测试通过、无意外越权、文档状态准确、提供必要的 UI 截图或错误复现、等待人工 Review。

以下情况**立即停止扩大修改并说明**：需要超出授权文件范围、要重构无关模块、要增加依赖/架构、PRD 与 UI 发生冲突、发现用户已有修改可能被覆盖、需要高风险 Git 操作。

> 其他细则：[`docs/development/workflow.md`](docs/development/workflow.md) 和 [`docs/development/code-review.md`](docs/development/code-review.md)。
