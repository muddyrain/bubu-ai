import styles from './WorkbenchShell.module.css';

export interface WorkbenchHeaderProps {
  version: string | undefined;
  versionFailed: boolean;
  modelLabel?: string | undefined;
  view?: 'workbench' | 'settings';
  chatting?: boolean;
}

export function WorkbenchHeader({ version, versionFailed, modelLabel, view = 'workbench',chatting=false }: WorkbenchHeaderProps) {
  const versionLabel = versionFailed ? '版本暂不可用' : version ? `应用版本 ${version}` : '版本读取中…';

  return (
    <header className={styles.header} data-view={view} aria-label="应用信息">
      <div className={styles.brand}>
        <strong>Bubu AI</strong>
        <span className={styles.brandTag}>本地 AI 工作伙伴</span>
      </div>
      <p className={styles.breadcrumb}>{view === 'settings' ? '设置' : <>工作台 <span aria-hidden="true">›</span> {chatting?'文本对话':'欢迎使用'}</>}</p>
      <div className={styles.headerStatus}>
        {view !== 'settings' && <span className={styles.modelStatus}><span className={styles.statusDot} aria-hidden="true" />{modelLabel ?? '未配置模型'}</span>}
        <span className={styles.version} role="status">{versionLabel}</span>
      </div>
    </header>
  );
}
