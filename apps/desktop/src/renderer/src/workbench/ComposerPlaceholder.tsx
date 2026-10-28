import { Icon } from '../components/Icon';
import styles from './WorkbenchShell.module.css';

export function ComposerPlaceholder({ modelLabel }: { modelLabel?: string | undefined }) {
  return (
    <section className={styles.composerArea} aria-label="消息输入区">
      <div className={styles.composer}>
        <textarea rows={2} disabled aria-label="消息输入" aria-describedby="composer-unavailable-note"
          placeholder="聊天与文件任务后续开放" />
        <div className={styles.composerToolbar}>
          <button type="button" disabled className={styles.composeTool} aria-label="添加文件，后续开放"><Icon name="paperclip" />添加文件</button>
          <button type="button" disabled className={styles.composeTool} aria-label="授权目录，后续开放"><Icon name="shield" />授权目录</button>
          <span className={styles.composerSpacer} />
          <button type="button" disabled className={styles.modelSelector} aria-label="聊天模型切换，后续开放">{modelLabel ?? '暂无模型连接'}<Icon name="chevron" /></button>
          <button type="button" disabled className={styles.sendButton} aria-label="发送消息，后续开放"><Icon name="send" /></button>
        </div>
      </div>
      <p className={styles.composerHint} id="composer-unavailable-note">聊天与文件任务后续开放 · 当前不会发送消息或访问本地目录</p>
    </section>
  );
}
