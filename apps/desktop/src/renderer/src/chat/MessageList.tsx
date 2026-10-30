import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatSnapshot } from '../../../shared/chat';
import { chatErrorText } from './chat-errors';
import { MessageContent } from './MessageContent';
import { CopyButton } from './CopyButton';
import styles from './Chat.module.css';
export function MessageItem({message,persisted,committing=false}:{message:ChatMessage;persisted:boolean;committing?:boolean}){
  const assistant=message.role==='assistant';
  const terminal=['completed','failed','stopped'].includes(message.status);
  const waiting=message.status==='pending'||message.status==='streaming';
  const hasText=Boolean(message.text.trim()),partial=hasText?' · 部分回答':'';
  const status=message.status==='completed'?'回答完成':message.status==='stopped'?'已停止'+partial:message.status==='failed'?(message.errorCode==='OUTPUT_TRUNCATED'?'回复已截断'+partial:'本轮失败'):committing?'正在保存':message.status==='streaming'?'正在生成':'等待模型回复';
  return <article className={styles.message} data-role={message.role} aria-label={assistant?'AI 回复':'你的消息'}>
    <div className={styles.messageBody}><header className={styles.messageHeading}><strong>{assistant?'布布': '你'}</strong>{assistant&&<span title={`${message.recipient.name} · ${message.recipient.modelId}`}>{message.recipient.name}</span>}</header>
      {assistant?<MessageContent text={hasText?message.text:waiting?'正在等待可见文本…':'本轮没有收到可显示的文本。'} />:<div className={styles.userText}>{message.text}</div>}
      {assistant&&<footer className={styles.messageFooter}>
        <p className={styles.messageStatus} role="status">{status}{terminal?(persisted?' · 已保存':' · 尚未保存'):''}</p>
        {terminal&&hasText&&<CopyButton text={message.text} label="回答" />}
      </footer>}
      {assistant&&message.errorCode&&<p className={styles.error}>{chatErrorText(message.errorCode)}{message.status!=='completed'&&hasText?' 本轮部分回答不会自动发送到后续上下文。':''}</p>}
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
