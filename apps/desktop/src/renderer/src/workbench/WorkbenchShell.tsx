import { useId, useState } from 'react';
import { ChatWorkspace } from './ChatWorkspace';
import { ContextPanel } from './ContextPanel';
import { Sidebar } from './Sidebar';
import { WorkbenchHeader } from './WorkbenchHeader';
import type { WorkbenchHeaderProps } from './WorkbenchHeader';
import styles from './WorkbenchShell.module.css';

export function WorkbenchShell(props: WorkbenchHeaderProps) {
  const [panelOpen, setPanelOpen] = useState(true);
  const panelId = useId();

  return (
    <div className={styles.stage}>
      <div className={styles.frame}>
        <WorkbenchHeader {...props} />
        <div className={styles.layout} data-panel-open={panelOpen}>
          <Sidebar />
          <ChatWorkspace panelId={panelId} panelOpen={panelOpen} onTogglePanel={() => setPanelOpen((open) => !open)} />
          <ContextPanel id={panelId} open={panelOpen} />
        </div>
      </div>
    </div>
  );
}
