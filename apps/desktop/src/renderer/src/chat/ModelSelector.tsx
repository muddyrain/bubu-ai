import type { ProviderSnapshot } from '../../../shared/providers';
import { usableModel } from './model-options';
import styles from './Chat.module.css';
export function ModelSelector({snapshot,disabled,onSelect}:{snapshot:ProviderSnapshot;disabled:boolean;onSelect:(id:string)=>void}){
  const choices=snapshot.profiles.filter(usableModel);
  return <label className={styles.modelSelector}><span>模型</span>
    <select aria-label="聊天模型" value={snapshot.selectedProfileId??''} disabled={disabled||!choices.length} onChange={e=>onSelect(e.target.value)}>
      <option value="" disabled>{choices.length?'请选择已验证模型':'暂无已验证模型'}</option>
      {choices.map(p=><option key={p.id} value={p.id}>{p.name} · {p.modelId}</option>)}
    </select>
  </label>;
}
