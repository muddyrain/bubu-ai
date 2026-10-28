import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { ProviderProfile, ProviderSnapshot, SaveProviderInput } from '../../../shared/providers';
import { Icon } from '../components/Icon';
import styles from './ProviderSettings.module.css';

interface Props {
  id: string;
  profile: ProviderProfile | undefined;
  busy: boolean;
  focusName: boolean;
  selectionControl: ReactNode;
  onDirty: (dirty: boolean) => void;
  onSaved: (profile: ProviderProfile) => void;
  save: (input: SaveProviderInput) => Promise<ProviderSnapshot | null>;
}
export function ProviderForm({ id, profile, busy, focusName, selectionControl, onDirty, onSaved, save }: Props) {
  const [original] = useState(profile);
  const [name, setName] = useState(original?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(original?.baseUrl ?? '');
  const [modelId, setModelId] = useState(original?.modelId ?? '');
  const [enabled, setEnabled] = useState(original?.enabled ?? true);
  const [keyAction, setKeyAction] = useState<'keep' | 'replace' | 'remove'>(original?.hasKey ? 'keep' : 'replace');
  const [keyEditor, setKeyEditor] = useState(!original?.hasKey);
  const keyInput = useRef<HTMLInputElement>(null);
  const focusKey = useRef(false);
  const fieldId = useId();
  useEffect(() => {
    const input = keyInput.current;
    return () => { if (input) input.value = ''; };
  }, []);
  useEffect(() => {
    if (keyEditor && focusKey.current) { keyInput.current?.focus(); focusKey.current = false; }
  }, [keyEditor]);
  const changed = () => onDirty(true);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = keyInput.current?.value ?? '';
    if (keyInput.current) keyInput.current.value = '';
    const next = await save({
      ...(original ? { id: original.id, expectedRevision: original.revision } : {}),
      name, baseUrl, modelId, enabled, protocol: 'openai-compatible-chat-completions',
      key: keyAction === 'replace' ? { action: 'replace', value } : { action: keyAction },
    });
    if (next) {
      const saved = original ? next.profiles.find((p) => p.id === original.id) : next.profiles.at(-1);
      if (saved) onSaved(saved);
      onDirty(false);
    }
  }
  return (
    <form id={id} onSubmit={(event) => { void submit(event); }} className={styles.form} aria-label={profile ? '编辑模型配置' : '新建模型配置'}>
      <div className={styles.detailHeader}>
        <div className={styles.detailHeading}><h2>{profile?.name ?? '添加模型配置'}</h2><p>OpenAI-compatible Chat Completions</p></div>
        <div className={styles.detailActions}>{selectionControl}
          <label className={styles.toggle}><input type="checkbox" checked={enabled} disabled={busy} aria-label="启用此配置"
            onChange={(e) => { setEnabled(e.target.checked); changed(); }} />启用</label>
        </div>
      </div>
      <div className={styles.fields}>
        <div className={styles.field}><label htmlFor={`${fieldId}-name`}>配置名称</label><input id={`${fieldId}-name`} required autoFocus={focusName} maxLength={80}
          value={name} disabled={busy} placeholder="例如：我的工作模型" onChange={(e) => { setName(e.target.value); changed(); }} /></div>
        <div className={styles.field}><label htmlFor={`${fieldId}-url`}>Base URL</label><div>
          <input id={`${fieldId}-url`} required type="url" className={styles.mono} placeholder="https://api.example.com/v1"
            maxLength={2048} value={baseUrl} disabled={busy} aria-describedby={`${fieldId}-url-hint`}
            onChange={(e) => { setBaseUrl(e.target.value); changed(); }} />
          <p id={`${fieldId}-url-hint`} className={styles.fieldHint}>公网 HTTPS / 443；修改地址需重新输入 Key。</p>
        </div></div>
        <div className={styles.field}><label htmlFor={`${fieldId}-model`}>Model ID</label><input id={`${fieldId}-model`} required maxLength={256} className={styles.mono}
          value={modelId} disabled={busy} placeholder="供应商提供的模型标识" onChange={(e) => { setModelId(e.target.value); changed(); }} /></div>
        <div className={styles.field}><span className={styles.fieldLabel}>API Key</span><div>
          {original?.hasKey && <div className={styles.keySummary}>
            <span><Icon name="key" />{keyAction === 'remove' ? '待移除密钥' : '已加密保存'}</span>
            {!keyEditor && <button type="button" className={`${styles.button} ${styles.textButton}`} disabled={busy}
              aria-controls={`${fieldId}-key-editor`} aria-expanded={false} onClick={() => { focusKey.current = true; setKeyEditor(true); }}>更换密钥</button>}
          </div>}
          <div id={`${fieldId}-key-editor`} hidden={!keyEditor} className={styles.keyEditor}>
            <input ref={keyInput} type="password" aria-label="API Key" autoComplete="off" spellCheck={false} maxLength={8192}
              required={keyAction === 'replace'} disabled={busy || keyAction === 'remove'} aria-describedby={`${fieldId}-key-hint`}
              placeholder={original?.hasKey ? '留空保留已保存密钥' : '输入 API Key'}
              onChange={(e) => { setKeyAction(e.target.value || !original?.hasKey ? 'replace' : 'keep'); changed(); }} />
            {original?.hasKey && <button type="button" className={`${styles.button} ${styles.textButton} ${styles.dangerButton}`}
              disabled={busy || keyAction === 'replace'} title={keyAction === 'replace' ? '请先放弃当前替换输入，再移除已保存密钥' : undefined}
              onClick={() => { setKeyAction(keyAction === 'remove' ? 'keep' : 'remove'); changed(); }}>
              {keyAction === 'remove' ? '保留已保存密钥' : '移除已保存密钥'}
            </button>}
          </div>
          <p id={`${fieldId}-key-hint`} className={styles.fieldHint}>{keyAction === 'remove' ? '保存后移除密钥并停用配置' : original?.hasKey ? '密钥不会回显。' : '通过系统安全存储加密保存；不会回退明文。'}</p>
        </div></div>
      </div>
    </form>
  );
}
