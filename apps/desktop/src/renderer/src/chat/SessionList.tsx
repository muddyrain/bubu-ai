import type { ConversationSummary } from '../../../shared/chat';
import { Icon } from '../components/Icon';
import styles from './Chat.module.css';
interface Props { sessions:ConversationSummary[]; currentId?:string|undefined; loading:boolean; onOpen:(id:string)=>void; onDelete:(id:string)=>void }
export function SessionList({sessions,currentId,loading,onOpen,onDelete}:Props){
  return <section className={styles.sessions} aria-label="本地会话">
    <h2>最近会话 <span>{sessions.length}</span></h2>
    {loading&&<p>正在读取会话…</p>}
    {!loading&&!sessions.length&&<p>暂无会话</p>}
    <ul>{sessions.map(s=><li key={s.id} data-current={s.id===currentId}>
      <button type="button" className={styles.sessionOpen} aria-label={`打开会话 ${s.title}`} aria-current={s.id===currentId?'true':undefined} onClick={()=>onOpen(s.id)}>
        <span>{s.title}</span><small>{Math.floor(s.messageCount/2)} 轮对话</small>
      </button>
      <button type="button" className={styles.iconButton} aria-label={`删除会话 ${s.title}`} title="删除本地会话" onClick={()=>onDelete(s.id)}><Icon name="close"/></button>
    </li>)}</ul>
  </section>;
}
