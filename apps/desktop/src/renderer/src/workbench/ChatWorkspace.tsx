import { Icon } from '../components/Icon';
import type { Ref } from 'react';
import { ComposerPlaceholder } from './ComposerPlaceholder';
import { WelcomeContent } from './WelcomeContent';
import styles from './WorkbenchShell.module.css';

interface ChatWorkspaceProps {
  panelId: string;
  panelOpen: boolean;
  onTogglePanel: () => void;
  toggleRef?: Ref<HTMLButtonElement>;
  modelLabel?: string | undefined;
}

export function ChatWorkspace({ panelId, panelOpen, onTogglePanel, toggleRef, modelLabel }: ChatWorkspaceProps) {
  return (
    <main className={styles.workspace} aria-labelledby="workspace-title">
      <header className={styles.chatHeader}>
        <div className={styles.chatHeading}>
          <h1 id="workspace-title">欢迎使用</h1>
          <span>{modelLabel ? '模型已选择 · 聊天后续开放' : '连接模型，开始首次配置'}</span>
        </div>
        <button ref={toggleRef} type="button" className={styles.panelToggle} aria-expanded={panelOpen}
          aria-controls={panelId} onClick={onTogglePanel}>
          <Icon name="panel" />{panelOpen ? '收起面板' : '展开面板'}
        </button>
      </header>
      <section className={styles.conversation} aria-label="欢迎内容" tabIndex={0}>
        <WelcomeContent />
      </section>
      <ComposerPlaceholder modelLabel={modelLabel} />
    </main>
  );
}
