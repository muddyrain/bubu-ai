import type { ReactNode, Ref } from 'react';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import styles from './WorkbenchShell.module.css';

const unavailableEntries: { label: string; icon: IconName }[] = [
  { label: '文件空间', icon: 'folder' }, { label: '任务记录', icon: 'clock' },
];

interface Props {
  view: 'workbench' | 'settings';
  workbenchRef: Ref<HTMLButtonElement>;
  workbenchDisabled: boolean;
  onOpenSettings: () => void;
  onOpenWorkbench: () => void;
  onNew: () => void;
  onSessions: () => void;
  sessions: ReactNode;
}
export function Sidebar({ view, workbenchRef, workbenchDisabled, onOpenSettings, onOpenWorkbench, onNew, onSessions, sessions }: Props) {
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
            <li><button type="button" className={styles.navButton} aria-label="新对话" title="新对话" disabled={view==='settings'} onClick={onNew}><Icon name="plus"/><span className={styles.navLabel}>新对话</span></button></li>
            <li><button type="button" className={styles.navButton} aria-label="最近会话" title="最近会话" disabled={view==='settings'} onClick={onSessions}><Icon name="message"/><span className={styles.navLabel}>最近会话</span></button></li>
            {view === 'settings' && unavailableEntries.map(({ label, icon }) => (
              <li key={label}>
                <button type="button" className={styles.navButton} disabled title={`${label} · 后续开放`}
                  aria-label={`${label}，后续开放`} aria-describedby="navigation-unavailable-note">
                  <Icon name={icon} /><span className={styles.navLabel}>{label}</span>
                  <span className={styles.navBadge} aria-hidden="true">待开放</span>
                </button>
              </li>
            ))}
            {view === 'settings' && <li><button type="button" className={styles.navCurrent}
              title="设置" aria-label="设置" aria-current={view === 'settings' ? 'page' : undefined} onClick={onOpenSettings}>
              <Icon name="settings" /><span className={styles.navLabel}>设置</span>
            </button></li>}
          </ul>
        </nav>
        <div hidden={view === 'settings'} className={styles.sessionEmpty}>{sessions}</div>
        <span id="navigation-unavailable-note" className={view === 'settings' ? styles.navLabel : styles.unavailableNote}>文件与任务功能后续开放。</span>
      </div>
      {view === 'settings' ? <div className={styles.settingsSidebarNote}><Icon name="shield" /><div><strong>本地优先</strong><p>连接与数据，都由你决定。</p></div></div> : <>
        <button type="button" className={styles.navButton} title="设置" aria-label="设置" onClick={onOpenSettings}><Icon name="settings" /><span className={styles.navLabel}>设置</span></button>
        <p className={styles.sidebarFooter}>本地优先 · 每一步由你掌握</p>
      </>}
    </aside>
  );
}
