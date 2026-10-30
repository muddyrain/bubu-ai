import { Icon } from '../components/Icon';
import { useState } from 'react';
import type { Ref } from 'react';
import { ChatComposer } from '../chat/ChatComposer';
import { MessageList } from '../chat/MessageList';
import { chatErrorText } from '../chat/chat-errors';
import type { ChatState } from '../chat/useChat';
import type { ProviderSnapshot } from '../../../shared/providers';
import type { ChatErrorCode } from '../../../shared/chat';
import chatStyles from '../chat/Chat.module.css';
import { WelcomeContent } from './WelcomeContent';
import styles from './WorkbenchShell.module.css';

interface ChatWorkspaceProps {
  panelId: string;
  panelOpen: boolean;
  onTogglePanel: () => void;
  toggleRef?: Ref<HTMLButtonElement>;
  modelLabel?: string | undefined;
  chat: ChatState;
  providers: ProviderSnapshot;
  modelLoading: boolean;
  modelUnavailable: boolean;
  modelBusy: boolean;
  onSelectModel: (id:string)=>void;
  providerError: string;
  onDismissProviderError: ()=>void;
  onOpenSettings: () => void;
}

export function ChatWorkspace({ panelId, panelOpen, onTogglePanel, toggleRef, modelLabel,chat,providers,modelLoading,modelUnavailable,modelBusy,onSelectModel,providerError,onDismissProviderError,onOpenSettings }: ChatWorkspaceProps) {
  const [focusRequest, setFocusRequest] = useState(0);
  const hasMessages=Boolean(chat.snapshot?.conversation.messages.length);
  const status=chat.plan?'等待发送确认':chat.phase==='preparing'?'正在准备发送':chat.phase==='committing'?'正在保存回复':chat.phase==='stopping'?'正在停止生成':chat.waiting?'等待较久，模型仍在处理…':chat.busy?'正在生成回复':modelLoading?'正在读取模型配置…':modelLabel?'纯文本对话':modelUnavailable?'模型配置暂不可用':'连接模型，开始首次配置';
  return (
    <main className={styles.workspace} aria-labelledby="workspace-title">
      <header className={styles.chatHeader}>
        <div className={styles.chatHeading}>
          <h1 id="workspace-title" title={hasMessages?chat.snapshot!.conversation.title:undefined}>{hasMessages?chat.snapshot!.conversation.title:'欢迎使用'}</h1>
          <span>{status}</span>
        </div>
        <button ref={toggleRef} type="button" className={styles.panelToggle} aria-expanded={panelOpen}
          aria-controls={panelId} onClick={onTogglePanel}>
          <Icon name="panel" />{panelOpen ? '收起面板' : '展开面板'}
        </button>
      </header>
      <div className={chatStyles.content}>
      {chat.error&&<div className={chatStyles.feedback} role="alert"><p className={chatStyles.error}>{chat.error==='NETWORK_FAILED'&&chat.busy?'生成状态同步异常，正在核实。当前生成仍可停止。':chatErrorText(chat.error)}</p><button type="button" className={chatStyles.iconButton} aria-label="关闭聊天错误" onClick={chat.dismissError}><Icon name="close"/></button></div>}
      {providerError&&<div className={chatStyles.feedback} role="alert"><p className={chatStyles.error}>模型状态：{chatErrorText(providerError as ChatErrorCode)}</p><button type="button" className={chatStyles.iconButton} aria-label="关闭模型错误" onClick={onDismissProviderError}><Icon name="close"/></button></div>}
      {hasMessages?<MessageList snapshot={chat.snapshot!} committing={chat.phase==='committing'}/>:<section className={styles.conversation} aria-label="欢迎内容" tabIndex={0}>
        <WelcomeContent ready={Boolean(modelLabel)} loading={modelLoading} failed={modelUnavailable} onOpenSettings={onOpenSettings} onPrompt={text=>{chat.setDraft(text);setFocusRequest(n=>n+1);}} />
      </section>}
      </div>
      <ChatComposer chat={chat} providers={providers} modelBusy={modelBusy} onSelect={onSelectModel} focusRequest={focusRequest}/>
    </main>
  );
}
