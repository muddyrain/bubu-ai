import type { ProviderProfile } from '../../../shared/providers';
import type { useProviders } from './useProviders';
import { Icon } from '../components/Icon';
import styles from './ProviderSettings.module.css';

interface Props {
  profile: ProviderProfile | undefined;
  state: ReturnType<typeof useProviders>;
  dirty: boolean;
  failure: (code: string) => string;
  onRequest: (kind: 'connection' | 'tools') => void;
}
export function ProviderDiagnostics({ profile, state, dirty, failure, onRequest }: Props) {
  const target = state.snapshot.profiles.find((p) => p.id === state.probeTarget?.profileId);
  const message = state.cancelStatus === 'committing' ? '正在保存检测结果，已无法取消。' :
    state.cancelStatus === 'cancelled' ? '正在取消检测…' :
    state.cancelStatus === 'not-running' ? '未找到可取消的检测，正在等待结果。' :
    state.probeTarget?.kind === 'tools' ? '正在检测 Tool Calling…' : '正在测试连接…';
  const canCancel = state.cancelStatus !== 'committing' && state.cancelStatus !== 'cancelled';
  const disabled = state.busy || state.loading || dirty || !profile?.enabled || !profile?.hasKey;
  const cancelling = <button type="button" className={styles.button} disabled={!canCancel} onClick={() => { void state.cancel(); }}>取消检测</button>;
  return (
    <section className={styles.diagnostics} aria-labelledby="diagnostics-title">
      <div className={styles.diagnosticsHeading}><h3 id="diagnostics-title">验证记录</h3><p>历史结果，不代表实时在线</p></div>
      {state.requestId && state.probeTarget?.profileId !== profile?.id && <div className={styles.backgroundProbe}>
        <div role="status"><strong>检测配置：{target?.name ?? '已保存配置'}</strong><p>{message}</p></div>{cancelling}
      </div>}
      {profile ? (['connection', 'tools'] as const).map((kind) => {
        const evidence = profile[kind];
        const running = Boolean(state.requestId && state.probeTarget?.profileId === profile.id && state.probeTarget.kind === kind);
        const labels = { passed: '上次检测通过', failed: '上次检测失败', supported: '工具探针通过', unsupported: '当前协议不支持工具调用', unknown: '工具能力未知' };
        const failed = evidence?.outcome === 'failed' || Boolean(evidence?.code);
        const passed = evidence?.outcome === 'passed' || evidence?.outcome === 'supported';
        return <div key={kind} className={styles.diagnosticRow}>
          <div className={styles.diagnosticCopy}>
            <h4>{running ? <span className={styles.spinner} aria-hidden="true" /> : failed ? <Icon name="alert" /> : passed ? <Icon name="check" /> : <span className={styles.neutralDot} aria-hidden="true" />}
              {kind === 'connection' ? '连接测试' : 'Tool Calling'}</h4>
            {running && <p role="status">{message}</p>}
            <p className={failed ? styles.failed : passed ? styles.passed : styles.secondary}>
              {evidence ? <>{labels[evidence.outcome]} · <time dateTime={evidence.checkedAt}>{new Date(evidence.checkedAt).toLocaleString()}</time>
                {evidence.code && <span className={styles.evidenceError}> · {failure(evidence.code)}</span>}</> : running ? '暂无已完成的检测记录' : kind === 'connection' ? '已保存，尚未测试连接' : '工具能力尚未检测'}
            </p>
          </div>
          {running ? cancelling : <button type="button" className={styles.button} disabled={disabled} onClick={() => onRequest(kind)}>
            {kind === 'connection' ? '测试连接' : '检测工具能力'}
          </button>}
        </div>;
      }) : <p className={styles.secondary}>先保存配置，再测试连接和工具能力。</p>}
      {state.requestId && state.cancelStatus === 'committing' && <p className={styles.secondary}>可以返回工作台；最终结果由主进程保存，再进入设置查看。</p>}
      {dirty && <p className={styles.secondary}>请先保存修改，再对已保存的配置进行检测。</p>}
    </section>
  );
}
