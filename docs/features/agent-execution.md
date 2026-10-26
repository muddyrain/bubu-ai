# Agent 执行与任务审批

> 状态：**planned** ｜版本：V0.1

## 定义

Agent Runtime 负责将用户目标与模型工具调用串联起来；它不拥有绕过权限 Broker 的文件系统访问权。

## 核心状态

`created → scanning / planning → awaiting_approval → executing → verifying → completed / partially_completed / failed / cancelled`。

- 只读搜索/总结可从分析阶段直接进入终态。
- 用户拒绝进入 `cancelled`；当前计划版本改变，旧审批失效。
- 无法量化的模型步骤展示活动状态，不生成假的百分比；文件扫描量化时展示处理数/总数。
- 每个工具调用有 ID、开始/结束/错误事件，界面可以恢复执行时间线；支持取消，超时与失败须记录。

## UI 映射

工作台五态：Welcome、Chat、Analyzing、Approval、Result；File Space 是辅助视图不是第六种运行状态。任务状态驱动角色动效，而非从模型回答猜测“任务成功”。

## 权限和模型交互

工具调用参数经过 Schema 和权限校验；外部文件/网页输出不允许修改系统指令。禁止默认 Shell 工具；限制 Agent 轮数和重试。任务执行记录与模型生成正文分开，模型异常不能修改已批准计划。

## 验收（待实现）

流式事件有序/去重、任务取消与终态一致、审批拒绝零写入、失败保留完成步骤、工具异常不伪造成功、界面能在重启后展示准确的历史任务信息。
