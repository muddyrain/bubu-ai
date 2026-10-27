import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { GET_VERSION_CHANNEL, DEV_SERVER_URL } from '../shared/ipc';
import { registerAppIpc } from './ipc';

const electron = vi.hoisted(() => ({
  getVersion: vi.fn(() => '0.1.0'),
  handle: vi.fn<(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void>(),
  removeHandler: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getVersion: electron.getVersion },
  ipcMain: { handle: electron.handle, removeHandler: electron.removeHandler },
}));

function setup(rendererUrl = DEV_SERVER_URL) {
  const frame = { url: rendererUrl };
  const contents = { mainFrame: frame };
  const window = {
    webContents: contents,
    isDestroyed: vi.fn(() => false),
    once: vi.fn<(name: string, listener: () => void) => void>(),
  };
  registerAppIpc(window as unknown as BrowserWindow, rendererUrl);
  const listener = electron.handle.mock.calls[0]?.[1];
  if (!listener) throw new Error('IPC handler was not registered');
  const invoke = (event: { sender: unknown; senderFrame: unknown } = { sender: contents, senderFrame: frame }, ...args: unknown[]) =>
    listener(event as unknown as IpcMainInvokeEvent, ...args);
  return { window, frame, contents, invoke };
}

describe('application version IPC', () => {
  it.each([DEV_SERVER_URL, 'file:///Applications/Bubu%20AI/renderer/index.html'])(
    'returns app.getVersion() for its own main frame: %s',
    (url) => {
      const { invoke } = setup(url);
      electron.getVersion.mockReturnValueOnce('2.3.4');
      expect(invoke()).toBe('2.3.4');
      expect(electron.handle).toHaveBeenCalledWith(GET_VERSION_CHANNEL, expect.any(Function));
      expect(electron.getVersion).toHaveBeenCalledOnce();
    },
  );

  it('rejects another window even when it has the expected URL', () => {
    const { invoke, frame } = setup();
    expect(() => invoke({ sender: { mainFrame: frame }, senderFrame: frame })).toThrow('Untrusted IPC sender');
    expect(electron.getVersion).not.toHaveBeenCalled();
  });

  it('rejects a child frame even when its URL matches', () => {
    const { invoke, contents } = setup();
    expect(() => invoke({ sender: contents, senderFrame: { url: DEV_SERVER_URL } })).toThrow('Untrusted IPC sender');
    expect(electron.getVersion).not.toHaveBeenCalled();
  });

  it('rejects a missing sender frame', () => {
    const { invoke, contents } = setup();
    expect(() => invoke({ sender: contents, senderFrame: null })).toThrow('Untrusted IPC sender');
  });

  it('rejects calls after its window is destroyed', () => {
    const { invoke, window } = setup();
    window.isDestroyed.mockReturnValue(true);
    expect(() => invoke()).toThrow('Untrusted IPC sender');
  });

  it.each([
    'http://127.0.0.1:5174/',
    'http://localhost:5173/',
    'http://127.0.0.1:5173.evil.example/',
    'http://127.0.0.1:5173/another-page',
    'http://127.0.0.1:5173/?redirect=1',
    'http://user@127.0.0.1:5173/',
    'https://127.0.0.1:5173/',
    'file:///tmp/index.html',
    'about:blank',
  ])('rejects an unexpected development page: %s', (url) => {
    const { invoke, frame } = setup();
    frame.url = url;
    expect(() => invoke()).toThrow('Untrusted IPC sender');
    expect(electron.getVersion).not.toHaveBeenCalled();
  });

  it.each([
    'file:///Applications/Bubu%20AI/renderer/other.html',
    'file:///Applications/Bubu%20AI/renderer/index.html?other=1',
    DEV_SERVER_URL,
  ])('rejects an unexpected production page: %s', (url) => {
    const { invoke, frame } = setup('file:///Applications/Bubu%20AI/renderer/index.html');
    frame.url = url;
    expect(() => invoke()).toThrow('Untrusted IPC sender');
    expect(electron.getVersion).not.toHaveBeenCalled();
  });

  it.each([[undefined], [null], ['arbitrary-channel'], [{}], [1, 2]])(
    'rejects unexpected arguments: %j',
    (...args) => {
      const { invoke } = setup();
      expect(() => invoke(undefined, ...args)).toThrow('getVersion does not accept arguments');
      expect(electron.getVersion).not.toHaveBeenCalled();
    },
  );

  it('removes its fixed handler when the window closes', () => {
    const { window } = setup();
    const [name, closed] = window.once.mock.calls[0] ?? [];
    expect(name).toBe('closed');
    if (!closed) throw new Error('Window close listener is missing');
    closed();
    expect(electron.removeHandler).toHaveBeenCalledWith(GET_VERSION_CHANNEL);
  });
});
