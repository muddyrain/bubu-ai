import { useEffect, useId, useRef, useState } from 'react';
import { CONNECTION_MESSAGE, TOOL_MESSAGE } from '../../../shared/providers';
import type { ProviderErrorCode, ProviderProfile } from '../../../shared/providers';
import { ModalDialog } from '../components/ModalDialog';
import { Icon } from '../components/Icon';
import type { useProviders } from './useProviders';
import { ProviderForm } from './ProviderForm';
import { ProviderList } from './ProviderList';
import { ProviderDiagnostics } from './ProviderDiagnostics';
import styles from './ProviderSettings.module.css';

const errors: Record<ProviderErrorCode, string> = {
  INVALID_INPUT: '配置或检测确认无效，请检查输入。', UNTRUSTED_SENDER: '当前页面无权执行此操作，请重新打开应用。',
  STORAGE_UNAVAILABLE: '系统安全存储不可用或未授权，未保存密钥。Linux 本期暂不支持安全保存。',
  CREDENTIAL_UNAVAILABLE: '无法解密已保存密钥，请解锁安全存储或重新输入 Key。', STORE_FAILED: '配置写入失败，请检查应用数据目录权限后重试。',
  STORE_CORRUPT: '配置损坏或版本不受支持，已停止覆盖，请保留原数据并人工恢复。', CONFLICT: '配置已经变化，请重新打开设置后操作。',
  NOT_FOUND: '配置已不存在。', KEY_REQUIRED: '请重新输入 API Key。', NOT_READY: '请启用配置并先通过连接测试。',
  LIMIT_REACHED: '配置或本窗口检测次数已达上限，请删除不用的配置或重新打开应用。', URL_BLOCKED: '地址不符合公网 HTTPS / 443 要求。',
  DNS_BLOCKED: '域名解析到了不允许访问的地址，已阻止请求。', DNS_FAILED: '域名解析失败，请检查地址与网络。',
  REDIRECT_BLOCKED: '服务要求重定向，已拒绝转发密钥，请填写最终 API 根地址。', AUTH_FAILED: '认证失败（401/403），请检查 API Key 和权限。',
  MODEL_NOT_FOUND: '模型或 API 路径不存在（404），请检查 Model ID 和 Base URL。', RATE_LIMITED: '供应商限流或配额不足（429），不会自动重试。',
  TLS_FAILED: 'TLS 证书校验失败，未绕过证书验证。', TIMEOUT: '检测超时，请手动重试。', CANCELLED: '检测已取消。',
  BUSY: '已有检测正在进行，请等待或取消。', RESPONSE_TOO_LARGE: '供应商响应超过大小上限，已中断。',
  PROTOCOL_ERROR: '响应或请求参数与当前 Chat Completions 协议不兼容，不会自动重试。', NETWORK_FAILED: '连接失败，请检查网络；不会自动重试。',
};
function failure(code: string): string { return errors[code as ProviderErrorCode] ?? '操作失败，请重试。'; }
interface ProviderConfirmation { profile: ProviderProfile; kind: 'connection' | 'tools' | 'delete'; trigger: HTMLElement | null }
interface Props {
  state: ReturnType<typeof useProviders>;
  dirty: boolean;
  onDirty: (dirty: boolean) => void;
  onRequestAction: (action: () => void) => void;
  onBack: () => void;
}
export function ProviderSettings({ state, dirty, onDirty, onRequestAction, onBack }: Props) {
  const [editingId, setEditingId] = useState<string | null>();
  const [formVersion, setFormVersion] = useState(0);
  const [confirmation, setConfirmation] = useState<ProviderConfirmation>();
  const [feedback, setFeedback] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const formId = useId();
  const currentId = editingId === undefined ? state.snapshot.selectedProfileId ?? state.snapshot.profiles[0]?.id ?? null : editingId;
  const editing = state.snapshot.profiles.find((p) => p.id === currentId);
  const selected = state.snapshot.profiles.find((p) => p.id === state.snapshot.selectedProfileId);
  const writing = state.busy && !state.requestId;
  useEffect(() => { headingRef.current?.focus(); }, []);
  useEffect(() => { if (state.error) errorRef.current?.focus(); }, [state.error]);
  const load = (profile?: ProviderProfile) => {
    setEditingId(profile?.id ?? null); setFormVersion((v) => v + 1);
    setConfirmation(undefined); setFeedback(''); onDirty(false); state.dismissError();
  };
  const onFormDirty = (value: boolean) => {
    if (value && editingId === undefined) setEditingId(editing?.id ?? null);
    if (value) setFeedback('');
    onDirty(value);
  };
  const requestSwitch = (profile?: ProviderProfile) => {
    if (profile && profile.id === editing?.id) return;
    onRequestAction(() => load(profile));
  };
  const requestConfirmation = (kind: ProviderConfirmation['kind']) => {
    if (!editing) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const open = () => {
      if (kind === 'delete' && dirty) load(editing);
      setFeedback(''); setConfirmation({ profile: editing, kind, trigger });
    };
    if (kind === 'delete') onRequestAction(open); else open();
  };
  async function confirm() {
    if (!confirmation || state.busy) return;
    const { profile, kind } = confirmation;
    setConfirmation(undefined);
    if (kind === 'delete') {
      const next = await state.execute(() => window.bubu.providers.remove({ id: profile.id, expectedRevision: profile.revision }));
      if (next) { load(next.profiles[0]); setFeedback('配置及本机凭据已删除。'); }
      return;
    }
    setEditingId(profile.id);
    const requestId = crypto.randomUUID();
    const input = { id: profile.id, revision: profile.revision, requestId,
      consent: { origin: new URL(profile.baseUrl).origin, accepted: true as const } };
    await state.execute(() => kind === 'connection' ? window.bubu.providers.testConnection(input) : window.bubu.providers.detectTools(input),
      requestId, { profileId: profile.id, kind });
  }
  const isSelected = editing?.id === state.snapshot.selectedProfileId;
  const selectionControl = editing && <div className={styles.usageAction}>
    <button type="button" className={styles.button} disabled={state.busy || state.loading || dirty || !editing.enabled || !editing.hasKey ||
      editing.connection?.outcome !== 'passed' || isSelected}
      onClick={() => { void state.execute(() => window.bubu.providers.select({ id: editing.id, expectedRevision: editing.revision }))
        .then((next) => { if (next) setFeedback('工作台模型已更新。聊天功能后续开放。'); }); }}>
      {isSelected ? '工作台使用中' : '设为工作台模型'}
    </button>
    {!isSelected && <span className={styles.fieldHint}>{dirty ? '先保存修改' : !editing.enabled ? '配置已停用' : !editing.hasKey ? '请先保存密钥' :
      editing.connection?.outcome !== 'passed' ? '先通过连接测试' : '选择不会发送请求'}</span>}
  </div>;

  return (
    <main className={styles.settings} aria-labelledby="settings-title">
      <div className={styles.pageHeader}>
        <div><h1 ref={headingRef} tabIndex={-1} id="settings-title">模型供应商</h1>
          <p className={feedback ? styles.feedback : undefined} role={feedback ? 'status' : undefined}>{feedback || <><span>工作台模型</span>：<strong>{selected?.name ?? '尚未选择'}</strong></>}</p></div>
        <div className={styles.pageActions}>
          <button type="button" className={`${styles.button} ${styles.quietButton}`} disabled={writing} onClick={onBack} aria-label="返回工作台" title="返回工作台"><Icon name="home" /></button>
        </div>
      </div>
      <div className={styles.settingsLayout}>
        <ProviderList profiles={state.snapshot.profiles} editingId={editing?.id ?? null} selectedId={state.snapshot.selectedProfileId}
          testingId={state.requestId ? state.probeTarget?.profileId : undefined} disabled={state.loading || writing}
          onSelect={requestSwitch} onCreate={() => requestSwitch()} />
        <section className={styles.detail} tabIndex={0} aria-label="配置表单与检测">
          <div className={styles.detailContent}>
            {state.loading && <p role="status" className={styles.loading}>正在读取配置…</p>}
            {writing && !dirty && <p role="status" className={styles.loading}>正在更新配置…</p>}
            {state.error && <div ref={errorRef} role="alert" tabIndex={-1} className={styles.error}><strong>上次操作未完成</strong><p>{failure(state.error)}</p></div>}
            {state.snapshot.cleanupPending && <p role="alert" className={styles.notice}>旧密文清理未完成，已从配置中停用；下次打开应用将重试清理。</p>}
            <ProviderForm key={`${editing?.id ?? 'new'}:${formVersion}`} id={formId} profile={editing} selectionControl={selectionControl}
              busy={writing || state.loading} focusName={formVersion > 0} onDirty={onFormDirty}
              onSaved={(saved) => { load(saved); setFeedback('配置已保存。未发起模型请求。'); }}
              save={(input) => state.busy ? Promise.resolve(null) : state.execute(() => window.bubu.providers.save(input))} />
            <ProviderDiagnostics profile={editing} state={state} dirty={dirty} failure={failure} onRequest={requestConfirmation} />
            <div className={styles.deleteRow}>
              <p>保存只更新本机配置，不会发送模型请求。</p>
              {editing && <button type="button" className={`${styles.button} ${styles.textButton} ${styles.dangerButton}`} disabled={state.busy || state.loading}
                onClick={() => requestConfirmation('delete')}>删除配置</button>}
            </div>
            {dirty && <footer className={styles.saveBar}>
              <p role="status">有未保存修改</p>
              <div className={styles.actions}>
                <button type="button" className={`${styles.button} ${styles.quietButton}`} disabled={writing} onClick={() => onRequestAction(() => load(editing))}>放弃修改</button>
                <button type="submit" form={formId} className={`${styles.button} ${styles.primaryButton}`}
                  disabled={state.busy || state.loading}>{writing ? '正在处理…' : '保存配置'}</button>
              </div>
            </footer>}
          </div>
        </section>
      </div>
      {confirmation && <ModalDialog
        title={confirmation.kind === 'delete' ? '删除本地配置？' : confirmation.kind === 'tools' ? '检测工具调用能力？' : '测试模型连接？'}
        description={confirmation.kind === 'delete' ? `移除「${confirmation.profile.name}」及本机凭据。` :
          confirmation.kind === 'tools' ? '验证模型能否返回正确的工具调用。' : '向此模型发送一次固定短消息。'}
        restoreFocus={confirmation.trigger} confirmLabel={confirmation.kind === 'delete' ? '确认删除' : '确认发送'}
        confirmEmphasis={confirmation.kind === 'delete' ? 'danger' : 'primary'} onClose={() => setConfirmation(undefined)} onConfirm={() => { void confirm(); }}>
        {confirmation.kind === 'delete' ? <p className={styles.modalNote}>不会撤销供应商端 Key。</p> : <>
          <dl className={styles.recipient}>
            <dt>接收方</dt><dd>{new URL(confirmation.profile.baseUrl).origin}</dd>
            <dt>模型</dt><dd>{confirmation.profile.modelId}</dd>
          </dl>
          <p className={styles.requestLabel}>将发送的固定内容</p>
          <blockquote className={styles.requestMessage}>{confirmation.kind === 'connection' ? CONNECTION_MESSAGE : TOOL_MESSAGE}</blockquote>
          <p className={styles.modalNote}>{confirmation.kind === 'tools' && <>附带随机 nonce 与无副作用函数定义，绝不执行工具。<br /></>}
            输出上限：64 completion tokens；不发送聊天记录或本地文件。</p>
          <p className={styles.billingNote}><Icon name="alert" />可能产生 API 用量与供应商费用。仅发送一次，不自动重试。</p>
        </>}
      </ModalDialog>}
    </main>
  );
}
