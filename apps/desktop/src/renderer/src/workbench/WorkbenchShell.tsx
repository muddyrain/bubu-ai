import { useId, useRef, useState } from 'react';
import { ModalDialog } from '../components/ModalDialog';
import { ProviderSettings } from '../providers/ProviderSettings';
import { useProviders } from '../providers/useProviders';
import { ChatWorkspace } from './ChatWorkspace';
import { ContextPanel } from './ContextPanel';
import { Sidebar } from './Sidebar';
import { WorkbenchHeader } from './WorkbenchHeader';
import type { WorkbenchHeaderProps } from './WorkbenchHeader';
import styles from './WorkbenchShell.module.css';

export function WorkbenchShell(props: WorkbenchHeaderProps) {
  const [view, setView] = useState<'workbench' | 'settings'>('workbench');
  const [panelOpen, setPanelOpen] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<{ action: () => void; trigger: HTMLElement | null }>();
  const panelId = useId();
  const providers = useProviders();
  const workbenchRef = useRef<HTMLButtonElement>(null);
  const selected = providers.snapshot.profiles.find((p) => p.id === providers.snapshot.selectedProfileId);
  const modelLabel = selected ? `当前模型：${selected.name}` : providers.snapshot.profiles.length ? '已保存配置 · 未选择模型' : '未配置模型';
  const modelSummary = selected ? `已选中 ${selected.name}。上次检测记录可在设置中查看。` :
    providers.snapshot.profiles.length ? `已保存 ${providers.snapshot.profiles.length} 个配置，尚未选择模型。` : '未配置模型，添加后可主动测试连接。';

  const requestAction = (action: () => void) => {
    if (dirty) setPending({ action, trigger: document.activeElement as HTMLElement | null });
    else action();
  };
  const returnWorkbench = () => {
    if (view === 'workbench' || (providers.busy && !providers.requestId)) return;
    requestAction(() => {
      if (providers.requestId) void providers.cancel();
      setDirty(false); setView('workbench');
      workbenchRef.current?.focus();
    });
  };
  const openSettings = () => {
    if (view === 'settings') return;
    setView('settings');
    void providers.refresh();
  };
  const continueEditing = () => {
    setPending(undefined);
  };
  const discardAndContinue = () => {
    const action = pending?.action;
    setPending(undefined); setDirty(false); action?.();
  };

  return (
    <div className={styles.stage}>
      <div className={styles.frame}>
        <WorkbenchHeader {...props} view={view} modelLabel={modelLabel} />
        <div className={styles.layout} data-panel-open={panelOpen} data-view={view}>
          <Sidebar view={view} workbenchRef={workbenchRef} workbenchDisabled={view === 'settings' && providers.busy && !providers.requestId}
            onOpenSettings={openSettings} onOpenWorkbench={returnWorkbench} />
          {view === 'settings' ? <ProviderSettings state={providers} dirty={dirty} onDirty={setDirty}
            onRequestAction={requestAction} onBack={returnWorkbench} /> : <>
            <ChatWorkspace panelId={panelId} panelOpen={panelOpen} modelLabel={selected?.name}
              onTogglePanel={() => setPanelOpen((open) => !open)} />
            <ContextPanel id={panelId} open={panelOpen} onOpenSettings={openSettings} modelSummary={modelSummary} />
          </>}
        </div>
        {pending && <ModalDialog title="保留未保存的修改？"
          description="继续编辑会保留当前输入；明确放弃后，将清理未保存内容和 API Key 输入。"
          restoreFocus={pending.trigger} cancelLabel="继续编辑" confirmLabel="放弃修改并继续"
          confirmEmphasis="secondary" onClose={continueEditing} onConfirm={discardAndContinue} />}
      </div>
    </div>
  );
}
