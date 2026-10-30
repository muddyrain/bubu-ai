import { useEffect, useRef } from 'react';
import type { ChatState } from './useChat';
import type { ProviderSnapshot } from '../../../shared/providers';
import { CHAT_LIMITS } from '../../../shared/chat';
import { Icon } from '../components/Icon';
import { ModelSelector } from './ModelSelector';
import { usableModel } from './model-options';
import styles from './Chat.module.css';
export function ChatComposer({chat,providers,modelBusy,onSelect,focusRequest=0}:{chat:ChatState;providers:ProviderSnapshot;modelBusy:boolean;onSelect:(id:string)=>void;focusRequest?:number}){
  const composing=useRef(false),input=useRef<HTMLTextAreaElement>(null),previousBusy=useRef(chat.busy);
  const focusAfterStop=useRef(false);
  const compositionEndedAt=useRef(-Infinity);
  const selected=providers.profiles.find(p=>p.id===providers.selectedProfileId&&usableModel(p));
  const bytes=new TextEncoder().encode(chat.draft).length,tooLong=bytes>CHAT_LIMITS.inputBytes;
  const canSend=Boolean(selected)&&!chat.busy&&!chat.loading&&!modelBusy&&!tooLong&&chat.snapshot?.persistence!=='failed'&&Boolean(chat.draft.trim());
  useEffect(()=>{if(previousBusy.current&&!chat.busy){const active=document.activeElement;if(active===document.body||focusAfterStop.current&&active?.getAttribute('aria-label')==='发送消息')input.current?.focus();focusAfterStop.current=false;}previousBusy.current=chat.busy;},[chat.busy]);
  useEffect(()=>{if(chat.focusKey||focusRequest)input.current?.focus();},[chat.focusKey,focusRequest]);
  useEffect(()=>{const node=input.current;if(node){node.style.height='auto';node.style.height=`${Math.min(Math.max(node.scrollHeight,56),156)}px`;}},[chat.draft]);
  return <section className={styles.composerArea} aria-label="消息输入区">
    <div className={styles.composerInner}><div className={styles.composer}>
      <textarea ref={input} rows={1} aria-label="消息输入" aria-describedby="chat-input-hint" value={chat.draft} readOnly={chat.busy} disabled={chat.loading}
        placeholder={selected?'和布布聊聊，输入你的问题…':'先在设置中验证并选择一个模型'} onChange={e=>chat.setDraft(e.target.value)}
        onCompositionStart={()=>{composing.current=true;compositionEndedAt.current=-Infinity;}}
        onCompositionEnd={()=>{composing.current=false;compositionEndedAt.current=performance.now();}}
        onKeyUp={e=>{if(e.key==='Enter')compositionEndedAt.current=-Infinity;}}
        onKeyDown={e=>{
          if(composing.current||e.nativeEvent.isComposing||e.keyCode===229)return;
          if(e.key==='Enter'&&!e.shiftKey){
            e.preventDefault();
            // Some IMEs end composition before the same confirming Enter.
            if(e.repeat||performance.now()-compositionEndedAt.current<100)return;
            if(canSend)void chat.send();
          }else compositionEndedAt.current=-Infinity;
        }}/>
      <div className={styles.toolbar}>
        <ModelSelector snapshot={providers} disabled={chat.busy||modelBusy} onSelect={onSelect}/>
        <span className={styles.spacer}/>
        {chat.busy?<button type="button" data-chat-stop="true" className={styles.stop} disabled={chat.phase==='stopping'||chat.phase==='committing'} onClick={()=>{focusAfterStop.current=true;void chat.cancel();}}>
          {chat.phase==='committing'?'正在保存…':chat.phase==='stopping'?'正在停止…':chat.phase==='preparing'?'取消发送':'停止生成'}</button>:
          <button type="button" className={styles.send} aria-label="发送消息" disabled={!canSend} onClick={()=>{void chat.send();}}><Icon name="send"/></button>}
      </div>
    </div>
    <div className={styles.composerMeta}>
    {selected&&<p className={styles.recipient} title={`发送至 ${selected.name} · ${new URL(selected.baseUrl).origin}`}>发送至 {new URL(selected.baseUrl).origin}</p>}
    <p id="chat-input-hint" className={tooLong||chat.snapshot?.persistence==='failed'?styles.error:styles.hint}>{chat.snapshot?.persistence==='failed'?'本轮未保存，该会话暂不能继续发送。请检查配额或磁盘问题。':tooLong?'输入超过 16 KiB，请缩短消息。':'本机明文保存 · Enter 发送 · Shift+Enter 换行'}</p>
    </div></div>
  </section>;
}
