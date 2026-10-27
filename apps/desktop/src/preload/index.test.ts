import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET_VERSION_CHANNEL } from '../shared/ipc';
import type { BubuApi } from '../shared/ipc';

const electron = vi.hoisted(() => ({
  expose: vi.fn<(key: string, value: BubuApi) => void>(),
  invoke: vi.fn<(...args: unknown[]) => Promise<string>>(),
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
  it('exposes only app.getVersion, with no raw Electron or Node API', async () => {
    const api = await loadBridge();
    expect(Object.keys(api)).toEqual(['app']);
    expect(Object.keys(api.app)).toEqual(['getVersion']);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(api.app)).toBe(true);
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
});
