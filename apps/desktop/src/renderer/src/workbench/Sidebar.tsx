import type { Ref } from 'react';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import styles from './WorkbenchShell.module.css';

const unavailableEntries: { label: string; icon: IconName }[] = [
  { label: '新对话', icon: 'plus' }, { label: '最近会话', icon: 'message' },
  { label: '文件空间', icon: 'folder' }, { label: '任务记录', icon: 'clock' },
];

interface Props {
  view: 'workbench' | 'settings';
  workbenchRef: Ref<HTMLButtonElement>;
  workbenchDisabled: boolean;
  onOpenSettings: () => void;
  onOpenWorkbench: () => void;
}
export function Sidebar({ view, workbenchRef, workbenchDisabled, onOpenSettings, onOpenWorkbench }: Props) {
  return (
    <aside className={styles.sidebar} data-view={view} aria-label="工作台导航">
      <div className={styles.sidebarScroll}>
        <nav aria-label="主导航">
          <p className={styles.sidebarLabel}>工作空间</p>
          <ul className={styles.navList}>
            <li><button ref={workbenchRef} type="button" aria-label="工作台" title="工作台" disabled={workbenchDisabled}
              className={view === 'workbench' ? styles.navCurrent : styles.navButton}
              aria-current={view === 'workbench' ? 'page' : undefined} onClick={onOpenWorkbench}>
              <Icon name="home" /><span className={styles.navLabel}>工作台</span>
            </button></li>
            {unavailableEntries.map(({ label, icon }) => (
              <li key={label}>
                <button type="button" className={styles.navButton} disabled title={`${label} · 后续开放`}
                  aria-label={`${label}，后续开放`} aria-describedby="navigation-unavailable-note">
                  <Icon name={icon} /><span className={styles.navLabel}>{label}</span>
                  <span className={styles.navBadge} aria-hidden="true">待开放</span>
                </button>
              </li>
            ))}
            <li><button type="button" className={view === 'settings' ? styles.navCurrent : styles.navButton}
              title="设置" aria-label="设置" aria-current={view === 'settings' ? 'page' : undefined} onClick={onOpenSettings}>
              <Icon name="settings" /><span className={styles.navLabel}>设置</span>
            </button></li>
          </ul>
        </nav>
        <section hidden={view === 'settings'} className={styles.sessionEmpty} aria-labelledby="recent-sessions-title">
          <h2 id="recent-sessions-title">最近会话</h2><p>暂无会话</p>
          <p id="navigation-unavailable-note">会话、文件与任务功能后续开放。</p>
        </section>
      </div>
      {view === 'settings' ? <div className={styles.settingsSidebarNote}><Icon name="shield" /><div><strong>本地优先</strong><p>连接与数据，都由你决定。</p></div></div> : <>
        <div className={styles.sidebarCompanion}><Icon name="heart" /><p>和布布一起<br />把文件变得井井有条</p></div>
        <p className={styles.sidebarFooter}>本地优先 · 每一步由你掌握</p>
      </>}
    </aside>
  );
}
