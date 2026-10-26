# Bubu AI · Local-first AI File Workspace

> **当前状态：设计已认可、开发尚未开始。** 本仓库起步包仅包含需求、UI 设计与 AI 开发约束；不是已运行的 Electron 应用。

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

项目计划使用 Electron + React + Vite + TypeScript；业务工程与真实开发命令在 **Issue #1 / PR-001 初始化**之后补齐。不要把模拟界面当作已具备的 Agent 功能。

## 角色素材

一二布布形象遵循原作者相关使用约定。可追溯来源和实际纳入应用的素材在接入时单独登记，源代码的开源许可不代表拥有对角色素材的再许可权。具体见 [素材接入规范](docs/design/ASSET-HANDOFF.md)。

## 初始化 GitHub 仓库

1. 在 GitHub 创建新的**空仓库**；建议暂时不要勾选自动生成 README、.gitignore 或 LICENSE，因为本初始化包已经包含前两者；代码许可待 Owner 确认。
2. 将本 ZIP **直接解压到仓库根目录**（确保 `AGENTS.md`、`README.md`、`docs/`、`.github/` 位于根目录）。
3. 在仓库根目录运行 `node scripts/check-repo-hygiene.mjs`，确认文件与文档规则。
4. 将这些设计与治理文件提交至 `main`，然后在 GitHub 创建 Issue #1（工程初始化）；遵循 `docs/development/workflow.md`，授权 Codex 在该 Issue 的专用分支开发。
5. 在 GitHub 设置中启用 PR Review 和必要的 CI 检查。仓库文件中的文字约束不能代替 GitHub 分支保护。

**请注意：**压缩包是“产品文档 + UI 参考 + 仓库约束”，**不含已经可运行的 Electron 代码**。`docs/design/reference/preview.html` 是离线设计演示，不是真正的 AI 应用。

**角色素材：**已确定使用原版一二布布 PNG/GIF 的方案，但该 ZIP **没有打包未经逐张验收的高清角色资源**。见 `docs/design/ASSET-CANDIDATES.md` 与 `ASSET-HANDOFF.md`；仓库里的概念截图/原型人物仅用于设计参考。
