import { useId, useRef, useState } from 'react';
import { ModalDialog } from '../components/ModalDialog';
import { ProviderSettings } from '../providers/ProviderSettings';
import { useProviders } from '../providers/useProviders';
import { useChat } from '../chat/useChat';
import { SessionList } from '../chat/SessionList';
import { usableModel } from '../chat/model-options';
import chatStyles from '../chat/Chat.module.css';
import { ChatWorkspace } from './ChatWorkspace';
import { ContextPanel } from './ContextPanel';
import { Sidebar } from './Sidebar';
import { WorkbenchHeader } from './WorkbenchHeader';
import type { WorkbenchHeaderProps } from './WorkbenchHeader';
import styles from './WorkbenchShell.module.css';

export function WorkbenchShell(props: WorkbenchHeaderProps) {
  const [view, setView] = useState<'workbench' | 'settings'>('workbench');
  const [panelOpen, setPanelOpen] = useState(false);
  const panelToggle = useRef<HTMLButtonElement>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<{ action: () => void; trigger: HTMLElement | null }>();
  const panelId = useId();
  const providers = useProviders();
  // 初始空快照只是占位；成功读取（包括空列表）会接纳新快照，关闭提示不会改变读取结果。
  const [initialProviderSnapshot] = useState(providers.snapshot);
  const modelUnavailable = !providers.loading && providers.snapshot === initialProviderSnapshot;
  const chat = useChat(view==='workbench');
  const [sessionMenu,setSessionMenu] = useState(false);
  const [chatAction,setChatAction] = useState<{action:()=>void|Promise<unknown>;title:string;description:string;trigger:HTMLElement|null}>();
  const [moving,setMoving] = useState(false);
  const chatActionGeneration=useRef(0);
  const requestChatAction = (action:()=>void|Promise<unknown>,title='停止回复并继续？',description='将中断当前生成并等待保存后继续。已进入最终保存阶段的回复会先完成保存。') => {
    if(chat.busy){chatActionGeneration.current++;setChatAction({action,title,description,trigger:document.activeElement as HTMLElement|null});}else void action();
  };
  const completeChatAction = async () => {
    if(moving)return;setMoving(true);
    const generation=chatActionGeneration.current;
    try{if(await chat.settle()&&chatActionGeneration.current===generation){const action=chatAction?.action;setChatAction(undefined);await action?.();}}finally{setMoving(false);}
  };
  const openSession=(id:string)=>{
    if(id===chat.snapshot?.conversation.id){setSessionMenu(false);return;}
    requestChatAction(async()=>{setSessionMenu(false);await chat.open(id);});
  };
  const deleteSession=(id:string)=>{chatActionGeneration.current++;setChatAction({action:async()=>{await chat.remove(id);},title:'删除本地会话？',
    description:'将删除这段本地对话及未保存的草稿，无法撤销。若正在生成，会先停止并等待保存；这不会删除供应商端可能保留的数据。',trigger:document.activeElement as HTMLElement|null});};
  const sessions=<SessionList sessions={chat.sessions} currentId={chat.snapshot?.conversation.id} loading={chat.loading} onOpen={openSession} onDelete={deleteSession}/>;
  const workbenchRef = useRef<HTMLButtonElement>(null);
  const selected = providers.snapshot.profiles.find((p) => p.id === providers.snapshot.selectedProfileId && usableModel(p));
  const modelLabel = providers.loading ? '正在读取模型配置…' : selected ? `当前模型：${selected.name}` : modelUnavailable ? '模型配置暂不可用' : providers.snapshot.profiles.length ? '已保存配置 · 未选择模型' : '未配置模型';

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
    requestChatAction(()=>{setView('settings');void providers.refresh();});
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
      <div className={styles.frame} data-view={view}>
        <WorkbenchHeader {...props} view={view} modelLabel={modelLabel} chatting={Boolean(chat.snapshot?.conversation.messages.length)} />
        <div className={styles.layout} data-panel-open={panelOpen} data-view={view}>
          <Sidebar view={view} workbenchRef={workbenchRef} workbenchDisabled={view === 'settings' && providers.busy && !providers.requestId}
            onOpenSettings={openSettings} onOpenWorkbench={returnWorkbench} sessions={sessions}
            onNew={()=>requestChatAction(async()=>{await chat.create();})} onSessions={()=>setSessionMenu(true)}/>
          {view === 'settings' ? <ProviderSettings state={providers} dirty={dirty} onDirty={setDirty}
            onRequestAction={requestAction} onBack={returnWorkbench} /> : <>
            <ChatWorkspace panelId={panelId} panelOpen={panelOpen} toggleRef={panelToggle} modelLabel={selected?.name} onOpenSettings={openSettings}
              chat={chat} providers={providers.snapshot} modelLoading={providers.loading} modelUnavailable={modelUnavailable} modelBusy={providers.busy} providerError={providers.error} onDismissProviderError={providers.dismissError} onSelectModel={id=>{
                const p=providers.snapshot.profiles.find(entry=>entry.id===id);if(p&&!chat.busy)void providers.execute(()=>window.bubu.providers.select({id:p.id,expectedRevision:p.revision}));
              }}
              onTogglePanel={() => setPanelOpen(!panelOpen)} />
            <ContextPanel id={panelId} open={panelOpen} onOpenSettings={openSettings} model={selected} modelLoading={providers.loading} modelUnavailable={modelUnavailable} snapshot={chat.snapshot} committing={chat.phase==='committing'}
              onClose={()=>{setPanelOpen(false);panelToggle.current?.focus();}} />
          </>}
        </div>
        {sessionMenu&&view==='workbench'&&!chatAction&&<ModalDialog title="本地会话" description="对话以明文保存在本机；不会自动发送历史。" confirmLabel="完成" onConfirm={()=>setSessionMenu(false)} onClose={()=>setSessionMenu(false)}>{sessions}</ModalDialog>}
        {chatAction&&<ModalDialog title={chatAction.title} description={moving?'正在停止或等待保存，请稍候…':chatAction.description}
          restoreFocus={chatAction.trigger} cancelLabel="继续留在当前页面" confirmLabel={moving?'正在等待…':chatAction.title==='删除本地会话？'?'确认删除':chat.phase==='committing'?'等待保存后继续':'停止并继续'}
          confirmEmphasis={chatAction.title==='删除本地会话？'?'danger':'primary'} onClose={()=>{chatActionGeneration.current++;setChatAction(undefined);}} onConfirm={()=>{void completeChatAction();}}/>}
        {chat.plan&&view==='workbench'&&!chatAction&&<ModalDialog title="将历史发送给这个模型？" description="仅在你确认后发起一次请求，供应商可能产生 API 用量费用。" confirmLabel="同意并发送" onConfirm={chat.confirmPlan} onClose={()=>{void chat.cancel();}}>
          <dl className={chatStyles.disclosure}><div><dt>接收方</dt><dd>{chat.plan.recipient.name} · {chat.plan.recipient.origin}</dd></div>
            <div><dt>模型</dt><dd>{chat.plan.recipient.modelId}</dd></div><div><dt>内容类别与数量</dt><dd>用户消息 {chat.plan.disclosure.userMessages} 条（含本轮输入），完整 AI 回答 {chat.plan.disclosure.assistantMessages} 条，共 {chat.plan.disclosure.utf8Bytes} 字节。不包含失败、停止的轮次或本地文件。</dd></div></dl>
        </ModalDialog>}
        {pending && <ModalDialog title="保留未保存的修改？"
          description="继续编辑会保留当前输入；明确放弃后，将清理未保存内容和 API Key 输入。"
          restoreFocus={pending.trigger} cancelLabel="继续编辑" confirmLabel="放弃修改并继续"
          confirmEmphasis="secondary" onClose={continueEditing} onConfirm={discardAndContinue} />}
      </div>
    </div>
  );
}
