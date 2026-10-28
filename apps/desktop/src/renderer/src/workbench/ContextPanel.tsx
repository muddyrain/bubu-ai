import { Icon } from '../components/Icon';
import { MascotArtwork } from '../components/MascotArtwork';
import styles from './WorkbenchShell.module.css';

function OnboardingContext({ onOpenSettings, modelSummary }: { onOpenSettings: () => void; modelSummary: string }) {
  return (
    <section className={styles.contextCard} aria-labelledby="onboarding-title">
      <h3 id="onboarding-title">三步开始使用</h3>
      <ol className={styles.setupSteps}>
        <li><span className={styles.stepNumber} aria-hidden="true">1</span><div>
          <h4>连接一个 AI 模型</h4>
          <p>{modelSummary}</p>
          <button type="button" onClick={onOpenSettings} className={styles.setupButton}>添加模型</button>
        </div></li>
        <li><span className={styles.stepNumber} aria-hidden="true">2</span><div>
          <h4>授权本地目录</h4>
          <p>未授权本地目录。目录授权后续开放。</p>
          <button type="button" disabled className={styles.setupButton}>选择本地目录（后续开放）</button>
        </div></li>
        <li><span className={styles.stepNumber} aria-hidden="true">3</span><div>
          <h4>发起文件任务</h4>
          <p>聊天与文件任务后续开放，当前没有运行中的任务。</p>
        </div></li>
      </ol>
    </section>
  );
}

interface ContextPanelProps {
  id: string; open: boolean;
  onOpenSettings: () => void; modelSummary: string;
}
export function ContextPanel({ id, open, onOpenSettings, modelSummary }: ContextPanelProps) {
  return (
    <aside className={styles.contextPanel} id={id} hidden={!open} aria-labelledby="context-title">
      <header className={styles.contextHeader}><h2 id="context-title">开始使用</h2></header>
      <section className={styles.contextScroll} aria-label="首次配置内容" tabIndex={0}>
        <OnboardingContext onOpenSettings={onOpenSettings} modelSummary={modelSummary} />
        <section className={styles.contextCompanion} aria-label="角色素材预留">
          <MascotArtwork size="compact" />
          <p>陪你把杂乱的小事慢慢整理好</p>
        </section>
        <section className={styles.contextCard} aria-labelledby="privacy-title">
          <h3 id="privacy-title"><Icon name="shield" />文件隐私</h3>
          <p>仅主动检测时向配置的供应商发送固定测试消息，不访问本地文件。</p>
          <p>后续发送文件正文给云端模型前，需先告知接收方并获得确认。</p>
        </section>
      </section>
    </aside>
  );
}
