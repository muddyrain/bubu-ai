# AI 对话

> 状态：**implemented（普通文本聊天）** ｜版本：V0.1 ｜Issue #6 Stage A/B 源码 Review、P1 Close-out 及 Owner 真实 macOS Electron 验收通过，待 GitHub 最终 Review；下文文件/工具能力仍 planned

## 用户价值与入口

从工作台「新对话 / 最近会话」进入，能够给 AI 发送自然语言任务，并在回复中看到真实的文件搜索卡片、任务步骤与结果。

## V0.1 行为

- 新建/切换会话、流式展示、停止本轮回复、会话历史本地持久化。
- 选择已配置且连通的模型；当前模型不可用时显示错误，而不是模拟回复。
- 普通问答可以不调用工具；本地文件任务只能调用已授权且模型支持的工具。
- 文件搜索结果有真实路径与匹配说明；聊天内容中的“已经修改”不能当作成功执行证据。

## 状态与错误

未配置模型、API 超时、网络中断、被用户取消、模型不支持 Tool Calling、没有授权目录、未找到文件，都要有明确区分。没有任务时，右侧可收起。

## 数据与权限

会话留在本地；选择云端 Provider 时发送给它的对话内容需按模型配置明确呈现。含本地文件正文的工具输出要独立检查外发授权。

## 已实现的 Main 底座

`main/chat/ChatService` 管理会话、一次性发送计划、单个全局生成请求和唯一终态。普通文本上下文只取本地完整成功的 user/assistant 对，再附本轮输入；停止、失败、截断或过滤的部分回答保留供查看，但整对不自动进入后续上下文。不接受 Renderer 传入全历史、URL、模型参数或凭据。

Main 通过 ProviderService 内部访问获取当前已选、已启用、有 Key、当前 revision 连接检测通过的模型。解密与必要的重封装仍在原 Provider 队列；整个流式请求在该队列之外。编辑、删除、停用、重新选择配置或连接证据失效会撤销访问并 Abort 请求。原探针的请求参数、HTTP 时限、取消语义与凭据格式不变。

`OpenAIChatStreamAdapter` 使用独立流式 Transport，复用公网 HTTPS/443、全部 DNS 答案校验、固定 IP lookup、原域名 SNI、TLS 证书认证、拒绝重定向的规则。不自动重试、重连或降级到其他 Provider；不发送工具定义，也不执行返回的工具。

SSE 以增量 UTF-8 解码，处理 CR/LF/CRLF、多行 data、注释、role-only 和空 choices。响应必须是 `text/event-stream`，拒绝压缩内容。合法 finish_reason 与 `[DONE]` 同时出现才可结束：只有非空文本的 `stop` 记为 completed；`length` 为 OUTPUT_TRUNCATED，`content_filter` 为 CONTENT_FILTERED；工具/函数调用拒绝，非法 JSON、UTF-8、SSE 和异常 EOF 不当成功处理。

限制：输入 16 KiB、发送上下文 JSON 128 KiB、输出文本 64 KiB、单 SSE 帧 64 KiB、响应 2 MiB、8192 帧、`max_completion_tokens: 2048`。DNS/响应头等待上限 20 秒、网络无字节活动上限 60 秒、单次生成总期限 5 分钟。首个可见文本等待 60 秒只发 waiting 提示，持续收到心跳/有效数据时不因缺少可见文本单独取消。不支持该参数或流协议的端点直接报错，不另发请求猜测兼容性。

## 具名 IPC、订阅与发送顺序

冻结的 `window.bubu.chat` 仅提供 `list/create/remove/subscribe/unsubscribe/snapshot/prepareSend/send/cancel`。Main 校验 WebContents、主 Frame、完整 URL、严格 Schema 与额外参数；owner 与当前文档绑定。事件只投递给订阅该会话的同一文档，不向调用方暴露原始 Electron event。

1. Preload 先注册固定事件监听，再调用 subscribe。Main 同步登记订阅并生成 `subscriptionId + sessionId + snapshot + watermark`；早到事件在 Preload 有界缓冲。
2. `prepareSend` 只读，既不写消息也不发网。计划绑定 owner、订阅、会话 revision、requestId、Provider ID/revision、上下文摘要和本轮输入，60 秒过期。历史将发给不同配置（同 URL 的不同 Profile 也算）时，计划提供接收方与消息数/字节数，send 必须明确 `accepted: true`；拒绝不消费请求。阶段 B 已接入确认 UI。
3. send 原子消费计划并占用全局请求位；先解密并重新检查权限，再成功持久化用户消息和 assistant 占位，才发起唯一网络请求。失败不重用计划、不重发收费请求。send 的成功响应表示占位已保存；started 事件允许先于该响应到达。
4. 事件绑定 session/subscription/conversation/request/run，单 run sequence 递增。Preload 和纯 `applyChatEvent` 合约去重；乱序/缺口只读取 snapshot 补偿，以 `resync` 回调明确替换消费方状态，不重发网络请求。缓冲与恢复次数有界；持续非法序列或恢复失败时解除订阅，调用方可主动重新订阅。阶段 B 先以 subscribe 返回的快照初始化，再合并后续回调。

快照生成前先同步发布缓冲的 delta，使正文与 sequence 水位一致；committing 快照保持最后一个已发布的非终态及其水位，落盘结果确定后才发布新的终态 sequence，避免重复文本或漏掉完成事件。

停止返回 `stopping`，实际 Abort 网络；没有活动请求返回 `not-running`。完成决策前取消获胜则记录 stopped；一旦进入 `committing`，网络已结束、终态正在持久化，取消返回 committing，不虚报取消或回滚。导航、关闭和取消同样处理；旧文档不再收到事件，但已开始的最终提交会继续。终态落盘失败返回 failed、`persisted: false`，保留进程内部分内容并阻止该会话继续发送，重启以真实磁盘记录恢复。checkpoint 与最终提交均保留配额错误 LIMIT_REACHED，真实写盘故障才报 STORE_FAILED。导航撤销兼容当前 Electron details.isMainFrame 和旧 positional 参数，子 Frame 不撤销主文档。

操作在队列内执行时若仍有活动生成，新建会话返回 BUSY；删除活动会话会请求停止并返回 BUSY，提交阶段不撤销写入。预期 revision 不匹配返回 CONFLICT。终态确定后须刷新 revision，明确重试删除；不会自动重试删除或模型请求。

## 本地持久化与隐私

`app.getPath('userData')/chat/conversations/<UUID>.json` 保存 schemaVersion=1 的会话、消息、接收方和状态；开发态为 `development/chat/conversations/`。最多 100 会话、每会话 200 消息/1 MiB、合计 20 MiB。输入达到配额会拒绝，不静默删历史或截断上下文。进程内全局 requestId 去重登记上限 20,000，准备阶段同步预留，取消/失败/会话删除不清除该记录；重启时从已保存消息恢复登记。所有者隔离不允许不同文档重用同一 requestId 发起第二次请求。

**聊天正文、标题及接收方元数据是本地明文，不使用 safeStorage 加密。** 不包含凭据字段；当前 Key 不进入 Renderer、聊天日志或 JSON，响应中的 Key 原文（含跨 chunk 回显）会被拦截。用户自己输入的其他敏感信息属于聊天内容，仍会明文保存；不要把凭据填入聊天。凭据继续使用独立的 [模型安全存储](model-providers.md)，不迁移既有 userData。

存储采用严格 Schema、有界读取、私有目录/文件权限、拒绝符号链接、同目录独占临时文件、文件 sync 和原子 rename，串行写入后才发布新快照。未知版本或损坏数据失败关闭，不覆盖或自动清空。启动恢复将 pending/streaming 修复为 failed/INTERRUPTED 并保存，不自动联网；完整临时文件名不会当成正式记录。流式内容约每秒 checkpoint，崩溃可丢失最后一次 checkpoint 后的片段。进程退出/断电可能中断最终提交，文件 sync/rename 不承诺跨平台断电持久性；本机同一用户的恶意篡改不在此隔离能力内。

## 验证与后续阶段

自动化仅使用 Mock HTTPS/DNS、Provider、安全存储、文件系统和 Deferred Promise，覆盖 Unicode 字节切分、结束协议、响应限制、实际 Abort、排队/提交竞态、首事件、旧计划/重复请求、跨配置历史许可、落盘失败及重启修复。未调用真实供应商、真实 Keychain 或 Electron GUI。

阶段 B 的 `useChat` 常驻 WorkbenchShell，以稳定函数和明确的 view/session 操作维护订阅；草稿、模型快照、delta 与右栏开关重渲染不重新订阅。握手前回调最多缓冲 128 项，溢出读快照；使用 Shared reducer、session/subscription/run/sequence、会话 revision 和异步 epoch 丢弃重复/过期事件及旧快照。运行期间约每秒读快照恢复断开的事件和 committing 状态，离开工作台停止监听与计时；不会自动重发供应商请求。send 回执仅为 admission，完成与保存依据真实终态/快照及 persisted 标记。

`SessionList` 提供新建、切换、查看和确认删除。1024px 图标侧栏通过「最近会话」模态列表访问；普通宽度同时提供侧栏列表。切换前保留按会话划分的内存草稿，删除确认同时清理该草稿；草稿不承诺跨重启保存。离开、切换、新建和删除时若有生成，先确认停止，等待 Main 真正结束后操作；committing 等待保存。等待过程中可选择留在当前页面，不会在保存完成后再偷偷导航。

`MessageList/MessageItem` 只安全展示纯文本与结构化消息状态，不解析 HTML/Markdown，不将 AI 文字包装成文件执行结果。生成时跟随底部；读者向上滚动后停止跟随，并提供「回到最新」。`ChatComposer` 支持中文 composition/isComposing/keyCode229 防误发送、Enter/Shift+Enter、UTF-8 16KiB 上限与停止。已保存/尚未保存、部分回答、截断、过滤和网络/凭据/配额错误分别反馈。未保存终态的会话不继续发送。

`ModelSelector` 只列出启用、有 Key、当前 revision 连接验证通过的配置，复用 providers.select，不发起探针。首次发送前输入区显示模型与实际域名；换配置继续成功历史时，真正模态框列出 Main 计划接收方、Model ID、用户消息（含本轮输入）/完整 AI 回答数量、字节和用量，默认取消，支持 Escape、Tab 焦点约束与返回；取消保留输入，确认前 0 send。

组件与 Mock bridge 集成测试覆盖稳定订阅、早到事件、迟到回执、状态/焦点/输入法、取消与导航、跨配置确认和滚动。1440×900、1100×800、1024×720 的隔离无头图片明确标记 Mock，不能代替真实 Electron、操作系统、供应商流式与 Keychain 验收。Markdown、附件、工具和文件业务仍未实现。UI 契约继续以 [组件设计](../design/COMPONENTS-AND-EVENTS.md) 为准。

Owner 的 [Stage C 实机记录](https://github.com/muddyrain/bubu-ai/issues/6#issuecomment-6486475136) 确认 macOS Electron 的真实模型回答、两轮流式与上下文、停止、会话切换与重启恢复、中文 IME/键盘/滚动，以及接收方/跨供应商历史确认/异常反馈共 6 项通过。单张截图只直接证明其可见的已保存回答、生成占位和停止按钮，其余以 Owner 逐项操作记录为证；自动化仍全部 Mock。Windows、其他输入法与供应商 SSE、Keychain 异常及真实断电恢复未全面实测。100ms IME 防误发窗口仍是启发式；回执异常而模型仍生成时的错误文案、已有模型时右侧引导文案留待后续定向优化，不影响停止或触发自动重发。

协议参考：[Chat Completions](https://developers.openai.com/api/reference/resources/chat)、[WHATWG SSE](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation)。应用按上述安全边界拒绝自动重连和重定向。
