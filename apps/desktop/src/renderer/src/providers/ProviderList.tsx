import { Icon } from '../components/Icon';
import type { ProviderProfile } from '../../../shared/providers';
import styles from './ProviderSettings.module.css';

interface Props {
  profiles: ProviderProfile[];
  editingId: string | null;
  selectedId: string | null;
  testingId?: string | undefined;
  disabled: boolean;
  onSelect: (profile: ProviderProfile) => void;
  onCreate: () => void;
}
export function ProviderList({ profiles, editingId, selectedId, testingId, disabled, onSelect, onCreate }: Props) {
  const status = (p: ProviderProfile) => testingId === p.id ? '正在检测' : !p.enabled ? '已停用' : !p.hasKey ? '缺少密钥' :
    !p.connection ? '已保存 · 未测试' : p.connection.outcome === 'passed' ? '上次检测通过' : '上次检测失败';
  return (
    <aside className={styles.providers} aria-label="供应商配置">
      <div className={styles.listHeading}><h2>配置 <span>{profiles.length}</span></h2>
        <button type="button" className={`${styles.button} ${styles.quietButton}`} disabled={disabled} onClick={onCreate}><Icon name="plus" />新增配置</button>
      </div>
      <div className={styles.listScroll}>
        {profiles.length === 0 && <p className={styles.listEmpty}>暂无模型配置<br />从右侧添加你的第一个模型。</p>}
        <ul className={styles.list} aria-label="已保存模型配置">
          {profiles.map((p) => <li key={p.id}>
            <button type="button" className={styles.profileButton} disabled={disabled} aria-pressed={editingId === p.id}
              aria-label={`编辑 ${p.name}`} onClick={() => onSelect(p)}>
              <span className={styles.profileCopy}>
                <span className={styles.profileName}>{p.name}</span>
                <span className={styles.secondary}>{p.modelId}</span>
                {p.id === selectedId && <span className={styles.usedLabel}><Icon name="check" />工作台使用中</span>}
                {(p.id !== selectedId || testingId === p.id || !p.enabled || !p.hasKey) &&
                  <span className={`${styles.listStatus} ${p.connection?.outcome === 'failed' ? styles.failed : ''}`}>{status(p)}</span>}
              </span>
              {p.id === editingId && <span className={styles.editMark} aria-label="正在编辑"><Icon name="edit" /></span>}
            </button>
          </li>)}
        </ul>
      </div>
      <p className={styles.listNote}><Icon name="shield" />仅保存在此设备</p>
    </aside>
  );
}
