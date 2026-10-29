import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindowConstructorOptions, Event, WebContentsWillFrameNavigateEventParams } from 'electron';
import { DEV_SERVER_URL } from '../shared/ipc';

type NavigationEvent = Event<WebContentsWillFrameNavigateEventParams>;
const mainDirectory = fileURLToPath(new URL('.', import.meta.url));

const electron = vi.hoisted(() => ({
  whenReady: vi.fn<() => Promise<void>>(),
  appOn: vi.fn<(name: string, listener: () => void) => void>(),
  quit: vi.fn(),
  construct: vi.fn<(options: BrowserWindowConstructorOptions) => void>(),
  getAllWindows: vi.fn<() => unknown[]>(),
  loadURL: vi.fn<(url: string) => Promise<void>>(),
  loadFile: vi.fn<(path: string) => Promise<void>>(),
  contentsOn: vi.fn<(name: string, listener: (event: NavigationEvent) => void) => void>(),
  setWindowOpenHandler: vi.fn<(handler: () => { action: string }) => void>(),
  setPermissionRequestHandler: vi.fn<(handler: (contents: unknown, permission: string, callback: (allowed: boolean) => void) => void) => void>(),
  setPermissionCheckHandler: vi.fn<(handler: () => boolean) => void>(),
  registerAppIpc: vi.fn(),
  registerProviderIpc: vi.fn(),
  singleInstance: vi.fn(),
  disposeProviderIpc: vi.fn(),
  registerChatIpc: vi.fn(),
  disposeChatIpc: vi.fn(),
  mainFrame: { url: 'about:blank' },
}));

vi.mock('electron', () => ({
  app: {
    setName: vi.fn(),
    requestSingleInstanceLock: electron.singleInstance,
    whenReady: electron.whenReady,
    on: electron.appOn,
    quit: electron.quit,
  },
  BrowserWindow: class {
    static getAllWindows = electron.getAllWindows;
    constructor(options: BrowserWindowConstructorOptions) { electron.construct(options); }
    loadURL = electron.loadURL;
    loadFile = electron.loadFile;
    webContents = {
      mainFrame: electron.mainFrame,
      on: electron.contentsOn,
      setWindowOpenHandler: electron.setWindowOpenHandler,
      session: {
        setPermissionRequestHandler: electron.setPermissionRequestHandler,
        setPermissionCheckHandler: electron.setPermissionCheckHandler,
      },
    };
  },
}));

vi.mock('./ipc', () => ({ registerAppIpc: electron.registerAppIpc }));
vi.mock('./chat/ipc', () => ({ registerChatIpc: electron.registerChatIpc, disposeChatIpc: electron.disposeChatIpc }));
vi.mock('./providers/ipc', () => ({ registerProviderIpc: electron.registerProviderIpc, disposeProviderIpc: electron.disposeProviderIpc }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  electron.mainFrame.url = 'about:blank';
  electron.whenReady.mockResolvedValue(undefined);
  electron.singleInstance.mockReturnValue(true);
  electron.getAllWindows.mockReturnValue([]);
  electron.loadURL.mockImplementation(async (url) => { electron.mainFrame.url = url; });
  electron.loadFile.mockImplementation(async (path) => { electron.mainFrame.url = pathToFileURL(path).href; });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.unstubAllGlobals());

async function boot(development = true): Promise<void> {
  vi.stubGlobal('__DEV__', development);
  await import('./index');
  await vi.dynamicImportSettled();
}

function navigate(overrides: Partial<NavigationEvent> = {}): NavigationEvent {
  const event = {
    url: DEV_SERVER_URL,
    isMainFrame: true,
    isSameDocument: false,
    frame: electron.mainFrame,
    initiator: electron.mainFrame,
    preventDefault: vi.fn(),
    ...overrides,
  } as NavigationEvent;
  const listener = electron.contentsOn.mock.calls.find(([name]) => name === 'will-frame-navigate')?.[1];
  if (!listener) throw new Error('Navigation handler is missing');
  listener(event);
  return event;
}

function activate(): void {
  const listener = electron.appOn.mock.calls.find(([name]) => name === 'activate')?.[1];
  if (!listener) throw new Error('Activation handler is missing');
  listener();
}

describe('BrowserWindow initialization without Electron', () => {
  it('prevents two application instances from racing on the same profile store', async () => {
    electron.singleInstance.mockReturnValue(false);
    await boot();
    expect(electron.quit).toHaveBeenCalledOnce();
    expect(electron.construct).not.toHaveBeenCalled();
    expect(electron.whenReady).not.toHaveBeenCalled();
  });
  it('registers provider lifecycle cleanup without touching the real credential backend', async () => {
    await boot();
    expect(electron.registerProviderIpc).toHaveBeenCalledWith(expect.any(Object), DEV_SERVER_URL);
    const close = electron.appOn.mock.calls.find(([name]) => name === 'before-quit')?.[1];
    close?.(); expect(electron.disposeProviderIpc).toHaveBeenCalledOnce();
    expect(electron.registerChatIpc).toHaveBeenCalledWith(expect.any(Object), DEV_SERVER_URL);
    const chatClose = electron.appOn.mock.calls.find(([name, listener]) => name === 'before-quit' && listener === electron.disposeChatIpc)?.[1];
    chatClose?.(); expect(electron.disposeChatIpc).toHaveBeenCalledOnce();
  });
  it.each([true, false])('applies the security settings and preload path (development=%s)', async (development) => {
    await boot(development);
    expect(electron.construct).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      webPreferences: {
        preload: join(mainDirectory, '../preload/index.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
      },
    }));
  });

  it('loads only the fixed Vite homepage in development', async () => {
    await boot();
    expect(electron.loadURL).toHaveBeenCalledExactlyOnceWith(DEV_SERVER_URL);
    expect(electron.loadFile).not.toHaveBeenCalled();
    expect(electron.registerAppIpc).toHaveBeenCalledWith(expect.any(Object), DEV_SERVER_URL);
  });

  it('loads only its own file page in production, ignoring the development URL environment variable', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', DEV_SERVER_URL);
    try {
      await boot(false);
      const file = join(mainDirectory, '../renderer/index.html');
      expect(electron.loadFile).toHaveBeenCalledExactlyOnceWith(file);
      expect(electron.loadURL).not.toHaveBeenCalled();
      expect(electron.registerAppIpc).toHaveBeenCalledWith(expect.any(Object), pathToFileURL(file).href);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('denies new windows and permissions before loading the renderer', async () => {
    await boot();
    const open = electron.setWindowOpenHandler.mock.calls[0]?.[0];
    const request = electron.setPermissionRequestHandler.mock.calls[0]?.[0];
    const check = electron.setPermissionCheckHandler.mock.calls[0]?.[0];
    if (!open || !request || !check) throw new Error('Security handler is missing');
    expect(open()).toEqual({ action: 'deny' });
    const callback = vi.fn();
    request({}, 'media', callback);
    expect(callback).toHaveBeenCalledExactlyOnceWith(false);
    expect(check()).toBe(false);
    for (const registration of [electron.contentsOn, electron.setWindowOpenHandler, electron.setPermissionRequestHandler, electron.setPermissionCheckHandler]) {
      expect(registration.mock.invocationCallOrder[0]).toBeLessThan(electron.loadURL.mock.invocationCallOrder[0]!);
    }
  });

  it('keeps redirects blocked, including redirects back to the trusted homepage', async () => {
    await boot();
    const listener = electron.contentsOn.mock.calls.find(([name]) => name === 'will-redirect')?.[1];
    if (!listener) throw new Error('Redirect handler is missing');
    const event = { preventDefault: vi.fn() } as unknown as NavigationEvent;
    listener(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
});

describe('development homepage reload policy', () => {
  it('allows a same-address reload initiated by the trusted main frame', async () => {
    await boot();
    expect(navigate().preventDefault).not.toHaveBeenCalled();
  });

  it.each([null, undefined])('rejects navigation with an unknown initiating frame (initiator=%s)', async (initiator) => {
    await boot();
    // Undefined represents Electron's omitted optional initiator.
    const navigation = navigate({ initiator } as Partial<NavigationEvent>);
    expect(navigation.preventDefault).toHaveBeenCalledOnce();
  });

  it.each([
    'http://127.0.0.1:5174/',
    'http://localhost:5173/',
    'http://127.0.0.1:5173/another-page',
    'http://127.0.0.1:5173/?other=1',
    'http://127.0.0.1:5173/#other',
    'https://127.0.0.1:5173/',
    'file:///tmp/index.html',
    'about:blank',
  ])('blocks navigation outside the exact homepage: %s', async (url) => {
    await boot();
    expect(navigate({ url }).preventDefault).toHaveBeenCalledOnce();
  });

  it('blocks a child-frame navigation even when its destination is the homepage', async () => {
    await boot();
    expect(navigate({ isMainFrame: false }).preventDefault).toHaveBeenCalledOnce();
  });

  it('checks the target frame identity rather than trusting only isMainFrame', async () => {
    await boot();
    const otherFrame = { url: DEV_SERVER_URL } as NavigationEvent['frame'];
    expect(navigate({ frame: otherFrame }).preventDefault).toHaveBeenCalledOnce();
  });

  it('blocks a child frame from refreshing the main frame', async () => {
    await boot();
    const child = { url: DEV_SERVER_URL } as NonNullable<NavigationEvent['initiator']>;
    expect(navigate({ initiator: child }).preventDefault).toHaveBeenCalledOnce();
  });

  it('blocks a missing target frame', async () => {
    await boot();
    expect(navigate({ frame: null }).preventDefault).toHaveBeenCalledOnce();
  });

  it('does not allow navigation back from an unexpected current page', async () => {
    await boot();
    electron.mainFrame.url = 'about:blank';
    expect(navigate().preventDefault).toHaveBeenCalledOnce();
  });

  it('keeps production navigation blocked even for a same-address main-frame reload', async () => {
    await boot(false);
    expect(navigate({ url: electron.mainFrame.url }).preventDefault).toHaveBeenCalledOnce();
  });
});

describe('startup diagnostics', () => {
  it.each([true, false])('records native error details and mode without private messages or stacks (development=%s)', async (development) => {
    const error = Object.assign(new Error('load failed at file:///private-user/app/index.html?private-detail'), {
      code: 'ERR_FILE_NOT_FOUND', errno: -6,
    });
    electron.loadURL.mockRejectedValueOnce(error);
    electron.loadFile.mockRejectedValueOnce(error);
    await boot(development);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(expect.any(String), {
      phase: 'startup', mode: development ? 'development' : 'production',
      errorType: 'Error', code: 'ERR_FILE_NOT_FOUND', errno: -6,
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private-user');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private-detail');
    expect(electron.quit).toHaveBeenCalledOnce();
  });

  it('extracts an Electron error identifier when it is available only in the message', async () => {
    electron.loadURL.mockRejectedValueOnce(new Error('ERR_CONNECTION_REFUSED (-102) loading private-detail'));
    await boot();
    expect(console.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: 'ERR_CONNECTION_REFUSED' }));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private-detail');
  });

  it('does not log arbitrary error properties or non-Error rejection values', async () => {
    electron.whenReady.mockRejectedValueOnce('private-detail');
    await boot();
    expect(console.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      errorType: 'string', code: 'UNKNOWN', errno: null,
    }));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private-detail');
    expect(electron.construct).not.toHaveBeenCalled();
    expect(electron.quit).toHaveBeenCalledOnce();
  });

  it('ignores private data in non-native error properties', async () => {
    electron.loadURL.mockRejectedValueOnce(Object.assign(new Error('private-detail'), {
      code: 'file:///private-user/index.html', errno: 'private-detail', extra: 'private-detail',
    }));
    await boot();
    expect(console.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: 'UNKNOWN', errno: null }));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private-');
    expect(electron.quit).toHaveBeenCalledOnce();
  });

  it('reports constructor failures without attempting to load a page', async () => {
    electron.construct.mockImplementationOnce(() => {
      throw Object.assign(new Error('private-detail'), { code: 'ENOENT' });
    });
    await boot();
    expect(console.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ phase: 'startup', code: 'ENOENT' }));
    expect(electron.loadURL).not.toHaveBeenCalled();
    expect(electron.loadFile).not.toHaveBeenCalled();
    expect(electron.registerAppIpc).not.toHaveBeenCalled();
    expect(electron.quit).toHaveBeenCalledOnce();
  });

  it('reports the activation phase if reopening the window fails', async () => {
    await boot();
    electron.loadURL.mockRejectedValueOnce(Object.assign(new TypeError('private-detail'), { code: 'ERR_FAILED' }));
    activate();
    await vi.dynamicImportSettled();
    expect(console.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      phase: 'activate', errorType: 'TypeError', code: 'ERR_FAILED',
    }));
    expect(electron.quit).toHaveBeenCalledOnce();
  });
});
