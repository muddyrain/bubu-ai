import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET_VERSION_CHANNEL } from '../shared/ipc';
import type { BubuApi } from '../shared/ipc';
import { PROVIDER_CHANNELS } from '../shared/providers';
import type { CancelProbeOutcome, ProviderResult } from '../shared/providers';

const electron = vi.hoisted(() => ({
  expose: vi.fn<(key: string, value: BubuApi) => void>(),
  invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.expose },
  ipcRenderer: { invoke: electron.invoke },
}));

beforeEach(() => vi.resetModules());

async function loadBridge(): Promise<BubuApi> {
  await import('./index');
  expect(electron.expose).toHaveBeenCalledOnce();
  const [key, api] = electron.expose.mock.calls[0] ?? [];
  expect(key).toBe('bubu');
  if (!api) throw new Error('Bridge is missing');
  return api;
}

describe('preload bridge', () => {
  it('exposes only named app and provider methods, with no raw Electron or Node API', async () => {
    const api = await loadBridge();
    expect(Object.keys(api).sort()).toEqual(['app', 'providers']);
    expect(Object.keys(api.app)).toEqual(['getVersion']);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(api.app)).toBe(true);
    expect(Object.keys(api.providers)).toEqual(Object.keys(PROVIDER_CHANNELS));
    expect(Object.isFrozen(api.providers)).toBe(true);
  });

  it.each(Object.keys(PROVIDER_CHANNELS) as (keyof typeof PROVIDER_CHANNELS)[])('uses the fixed provider channel for %s', async (method) => {
    const api = await loadBridge();
    const input = { requestId: 'fixture' };
    const invoke = api.providers[method] as (...args: unknown[]) => Promise<unknown>;
    await invoke(input, 'untrusted extra');
    expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(PROVIDER_CHANNELS[method], ...(method === 'list' ? [] : [input]));
  });

  it('uses a fixed channel and forwards no caller arguments', async () => {
    const api = await loadBridge();
    electron.invoke.mockResolvedValueOnce('0.1.0');
    const getVersion = api.app.getVersion as (...args: unknown[]) => Promise<string>;
    await expect(getVersion('untrusted-channel', { path: '/tmp' })).resolves.toBe('0.1.0');
    expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(GET_VERSION_CHANNEL);
  });

  it('propagates IPC rejection to the caller', async () => {
    const api = await loadBridge();
    electron.invoke.mockRejectedValueOnce(new Error('Untrusted IPC sender'));
    await expect(api.app.getVersion()).rejects.toThrow('Untrusted IPC sender');
  });

  it.each(['cancelled', 'committing', 'not-running'] as const)('preserves the cancelProbe outcome: %s', async (status) => {
    const api = await loadBridge();
    const result: ProviderResult<CancelProbeOutcome> = { ok: true, value: { status } };
    electron.invoke.mockResolvedValueOnce(result);
    await expect(api.providers.cancelProbe({ requestId: 'fixture' })).resolves.toEqual(result);
    expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(PROVIDER_CHANNELS.cancelProbe, { requestId: 'fixture' });
  });
});
