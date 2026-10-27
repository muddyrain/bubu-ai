import { Icon } from '../components/Icon';
import { ComposerPlaceholder } from './ComposerPlaceholder';
import { WelcomeContent } from './WelcomeContent';
import styles from './WorkbenchShell.module.css';

interface ChatWorkspaceProps {
  panelId: string;
  panelOpen: boolean;
  onTogglePanel: () => void;
}

export function ChatWorkspace({ panelId, panelOpen, onTogglePanel }: ChatWorkspaceProps) {
  return (
    <main className={styles.workspace} aria-labelledby="workspace-title">
      <header className={styles.chatHeader}>
        <div className={styles.chatHeading}>
          <h1 id="workspace-title">欢迎使用</h1>
          <span>需要完成首次配置</span>
        </div>
        <button type="button" className={styles.panelToggle} aria-expanded={panelOpen}
          aria-controls={panelId} onClick={onTogglePanel}>
          <Icon name="panel" />{panelOpen ? '收起面板' : '展开面板'}
        </button>
      </header>
      <section className={styles.conversation} aria-label="欢迎内容" tabIndex={0}>
        <WelcomeContent />
      </section>
      <ComposerPlaceholder />
    </main>
  );
}
