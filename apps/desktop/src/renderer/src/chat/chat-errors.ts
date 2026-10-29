import type { ChatErrorCode } from '../../../shared/chat';
const messages: Record<ChatErrorCode, string> = {
  INVALID_INPUT:'消息无效，请检查内容与长度。',UNTRUSTED_SENDER:'页面权限已失效，请重新加载应用。',NOT_FOUND:'会话不存在，请选择其他会话。',
  CONFLICT:'会话或模型已变化，请刷新后重新发送。',BUSY:'另一条回复仍在生成或保存，请稍候。',LIMIT_REACHED:'已达到消息、上下文或本地存储上限，请缩短内容或删除不需要的会话。',
  NOT_READY:'请先在设置中验证并选择一个模型。',CREDENTIAL_UNAVAILABLE:'模型凭据暂不可用，请到设置中检查。',STORAGE_UNAVAILABLE:'安全存储不可用。',
  STORE_FAILED:'本地保存失败，请检查磁盘空间和权限。',STORE_CORRUPT:'本地会话无法读取，原文件未被重置。',SUBSCRIPTION_REQUIRED:'会话订阅已失效，请重新打开会话。',
  PLAN_EXPIRED:'发送确认已过期，请重新发送。',CONSENT_REQUIRED:'请先确认历史消息的接收方。',REPLAY:'该请求已经处理，请勿重复发送。',CANCELLED:'本轮已停止。',
  PROVIDER_CHANGED:'模型配置已变化，本轮请求已中断。',URL_BLOCKED:'模型地址不符合公网 HTTPS 安全要求。',DNS_BLOCKED:'模型地址解析到了不允许的网络。',
  DNS_FAILED:'无法解析模型域名。',REDIRECT_BLOCKED:'模型服务返回重定向，已安全拒绝。',TLS_FAILED:'模型服务的 TLS 证书验证失败。',TIMEOUT:'本轮请求超时，未自动重试。',
  NETWORK_IDLE:'模型连接长时间没有数据，本轮已中断。',NETWORK_FAILED:'连接失败，请检查网络后主动重试。',AUTH_FAILED:'模型认证失败，请检查配置中的 API Key。',
  MODEL_NOT_FOUND:'模型不存在，请检查 Model ID。',RATE_LIMITED:'供应商限制了请求频率，请稍后主动重试。',PROTOCOL_ERROR:'模型返回了不支持的流式响应。',
  RESPONSE_TOO_LARGE:'模型响应超出安全大小限制，已中断。',OUTPUT_TRUNCATED:'回答因输出预算耗尽而截断，未作为完整回答保存。',CONTENT_FILTERED:'供应商过滤了回答，本轮未完成。',
  TOOLS_FORBIDDEN:'模型尝试调用工具；当前仅支持纯文本，已拒绝执行。',EMPTY_RESPONSE:'模型没有返回可见文本。',INTERRUPTED:'上次回复意外中断，未自动续传。',
};
export const chatErrorText = (code: ChatErrorCode) => messages[code] ?? messages.NETWORK_FAILED;
