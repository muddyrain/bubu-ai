import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatSnapshot } from '../../../shared/chat';
import { chatErrorText } from './chat-errors';
import styles from './Chat.module.css';
export function MessageItem({message,persisted,committing=false}:{message:ChatMessage;persisted:boolean;committing?:boolean}){
  const assistant=message.role==='assistant';
  const terminal=['completed','failed','stopped'].includes(message.status);
  const status=message.status==='completed'?'回答完成':message.status==='stopped'?'已停止 · 部分回答':message.status==='failed'?'本轮失败':committing?'正在保存':message.status==='streaming'?'正在生成':'等待模型回复';
  return <article className={styles.message} data-role={message.role} aria-label={assistant?'AI 回复':'你的消息'}>
    <div className={styles.messageAvatar} aria-hidden="true">{assistant?'布':'你'}</div>
    <div className={styles.messageBody}><header><strong>{assistant?'布布': '你'}</strong>{assistant&&<span>{message.recipient.name}</span>}</header>
      <div className={styles.messageText}>{message.text|| (assistant?'正在等待可见文本…':'')}</div>
      {assistant&&<p className={styles.messageStatus} role="status">{status}{terminal?(persisted?' · 已保存':' · 尚未保存'):''}</p>}
      {assistant&&message.errorCode&&<p className={styles.error}>{chatErrorText(message.errorCode)}{message.status!=='completed'&&message.text?' 本轮部分回答不会自动发送到后续上下文。':''}</p>}
    </div>
  </article>;
}
export function MessageList({snapshot,committing=false}:{snapshot:ChatSnapshot;committing?:boolean}){
  const scroll=useRef<HTMLDivElement>(null),follow=useRef(true),[away,setAway]=useState(false);
  const messages=snapshot.conversation.messages;
  const latest=()=>{const node=scroll.current;if(node){node.scrollTop=node.scrollHeight;follow.current=true;setAway(false);}};
  useEffect(()=>{follow.current=true;latest();},[snapshot.conversation.id]);
  useEffect(()=>{if(follow.current)latest();},[snapshot.watermark.runId,snapshot.watermark.seq]);
  return <div className={styles.messageRegion}>
    <div ref={scroll} className={styles.messageScroll} role="region" aria-label="聊天消息" tabIndex={0} onScroll={()=>{
      const n=scroll.current!;follow.current=n.scrollHeight-n.scrollTop-n.clientHeight<64;setAway(!follow.current);
    }}>
      {messages.map((m,i)=><MessageItem key={m.id} message={m} committing={committing&&i===messages.length-1} persisted={i<messages.length-1||snapshot.persistence==='saved'}/>)}
    </div>
    {away&&<button type="button" className={styles.latest} onClick={latest}>回到最新 ↓</button>}
  </div>;
}
