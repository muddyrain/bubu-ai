import { Icon } from '../components/Icon';
import type { ProviderProfile } from '../../../shared/providers';
import type { ChatSnapshot } from '../../../shared/chat';
import styles from './WorkbenchShell.module.css';

interface ContextPanelProps {
  id: string; open: boolean; onOpenSettings: () => void; onClose: () => void;
  model: ProviderProfile | undefined; modelLoading: boolean; modelUnavailable: boolean; snapshot: ChatSnapshot | undefined; committing: boolean;
}
export function ContextPanel({ id, open, onOpenSettings, onClose, model, modelLoading, modelUnavailable, snapshot, committing }: ContextPanelProps) {
  const recipient = snapshot?.conversation.messages.filter(m => m.role === 'assistant').at(-1)?.recipient;
  const saved = !snapshot?.conversation.messages.length ? '尚无消息' : committing ? '正在保存' :
    snapshot.persistence === 'failed' ? '尚未保存' : snapshot.active ? '本轮尚未完成' : '已保存';
  return <aside className={styles.contextPanel} id={id} hidden={!open} aria-labelledby="context-title">
    <header className={styles.contextHeader}><h2 id="context-title">对话信息</h2>
      <button type="button" className={styles.contextClose} aria-label="收起对话信息" onClick={onClose}><Icon name="close" /></button>
    </header>
    <section className={styles.contextScroll} aria-label="对话上下文" tabIndex={0}>
      <section className={styles.contextSection}>
        <h3>当前发送模型</h3>
        {modelLoading ? <p>正在读取模型配置…</p> : model ? <><strong>{model.name}</strong><p>{model.modelId}</p><p>{new URL(model.baseUrl).origin}</p><p>已选择配置，不代表持续在线。</p></> : modelUnavailable ? <p>模型配置暂不可用。</p> :
          <><p>尚未选择可用模型。</p><button type="button" className={styles.setupButton} onClick={onOpenSettings}>添加模型</button></>}
      </section>
      {recipient && <section className={styles.contextSection}><h3>最近回复来源</h3><p>{recipient.name} · {recipient.modelId}</p><p>{recipient.origin}</p></section>}
      <section className={styles.contextSection}><h3>本机记录</h3>
        <dl><dt>保存方式</dt><dd>明文 JSON</dd><dt>当前状态</dt><dd>{saved}</dd><dt>消息数量</dt><dd>{snapshot?.conversation.messages.length ?? 0} 条</dd></dl>
      </section>
      <section className={styles.contextSection}><h3><Icon name="shield" />发送与隐私</h3>
        <p>本轮输入和完整成功的历史会发送至所选供应商；换配置继续旧历史前，需要明确确认。</p>
        <p>停止或失败的部分回答不会自动用于后续上下文。对话在本机明文保存，API Key 独立加密。</p>
        <p>当前不访问本地文件，不执行工具或 Agent。</p>
      </section>
    </section>
  </aside>;
}
