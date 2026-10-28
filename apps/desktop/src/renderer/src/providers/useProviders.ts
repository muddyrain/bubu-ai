import { useCallback, useEffect, useRef, useState } from 'react';
import type { CancelProbeOutcome, ProviderResult, ProviderSnapshot } from '../../../shared/providers';

export function useProviders() {
  const [snapshot, setSnapshot] = useState<ProviderSnapshot>({ profiles: [], selectedProfileId: null, cleanupPending: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState<string>();
  const [cancelStatus, setCancelStatus] = useState<CancelProbeOutcome['status']>();
  const [probeTarget, setProbeTarget] = useState<{ profileId: string; kind: 'connection' | 'tools' }>();
  const snapshotEpoch = useRef(0);
  const refreshRequest = useRef(0);
  const active = useRef(false);
  const request = useRef<string | undefined>(undefined);
  useEffect(() => {
    let current = true;
    active.current = true;
    const epoch = snapshotEpoch.current;
    const listRequest = ++refreshRequest.current;
    void (async () => {
      try {
        const result = await window.bubu.providers.list();
        if (current && listRequest === refreshRequest.current && epoch === snapshotEpoch.current) { if (result.ok) setSnapshot(result.value); else setError(result.error.code); }
      } catch { if (current && listRequest === refreshRequest.current) setError('NETWORK_FAILED'); }
      finally { if (current && listRequest === refreshRequest.current) setLoading(false); }
    })();
    return () => {
      active.current = false;
      current = false;
      if (request.current) void window.bubu.providers.cancelProbe({ requestId: request.current }).catch(() => {});
    };
  }, []);
  const refresh = useCallback(async () => {
    const epoch = snapshotEpoch.current;
    const listRequest = ++refreshRequest.current;
    try {
      const result = await window.bubu.providers.list();
      if (!active.current || listRequest !== refreshRequest.current || epoch !== snapshotEpoch.current) return;
      if (result.ok) { setSnapshot(result.value); setError(''); }
      else setError(result.error.code);
    } catch { if (active.current && listRequest === refreshRequest.current && epoch === snapshotEpoch.current) setError('NETWORK_FAILED'); }
    finally { if (active.current && listRequest === refreshRequest.current) setLoading(false); }
  }, []);
  const execute = useCallback(async (operation: () => Promise<ProviderResult<ProviderSnapshot>>, probeId?: string,
    target?: { profileId: string; kind: 'connection' | 'tools' }) => {
    snapshotEpoch.current++;
    setProbeTarget(target);
    setBusy(true); setError(''); setRequestId(probeId); setCancelStatus(undefined); request.current = probeId;
    try {
      const result = await operation();
      if (!active.current) return null;
      snapshotEpoch.current++;
      if (result.ok) { setSnapshot(result.value); return result.value; }
      setError(result.error.code);
    } catch { if (active.current) setError('NETWORK_FAILED'); }
    finally {
      request.current = undefined;
      if (active.current) { setBusy(false); setRequestId(undefined); setCancelStatus(undefined); setProbeTarget(undefined); }
    }
    return null;
  }, []);
  const cancel = useCallback(async () => {
    const id = request.current;
    if (!id) return;
    try {
      const result = await window.bubu.providers.cancelProbe({ requestId: id });
      if (!active.current || request.current !== id) return;
      if (result.ok) setCancelStatus(result.value.status);
      else setError(result.error.code);
    } catch { if (active.current && request.current === id) setError('NETWORK_FAILED'); }
  }, []);
  const dismissError = useCallback(() => setError(''), []);
  return { snapshot, loading, busy, error, execute, requestId, cancelStatus, probeTarget, cancel, refresh, dismissError };
}
