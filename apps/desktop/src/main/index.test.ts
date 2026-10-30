import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindowConstructorOptions, Event, Session, WebContents, WebContentsWillFrameNavigateEventParams } from 'electron';
import { DEV_SERVER_URL } from '../shared/ipc';

type NavigationEvent = Event<WebContentsWillFrameNavigateEventParams>;
type RequestHandler = NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]>;
type CheckHandler = NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]>;
interface MockFrame { url: string; detached: boolean; parent: MockFrame | null }
interface MockWindowState {
  destroyed: boolean;
  focused: boolean;
  contentsDestroyed: boolean;
  contentsFocused: boolean;
  isDestroyed: () => boolean;
  isFocused: () => boolean;
  webContents: { mainFrame: MockFrame; isDestroyed: () => boolean; isFocused: () => boolean };
}
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
  setPermissionRequestHandler: vi.fn<(handler: RequestHandler) => void>(),
  setPermissionCheckHandler: vi.fn<(handler: CheckHandler) => void>(),
  registerAppIpc: vi.fn(),
  registerProviderIpc: vi.fn(),
  singleInstance: vi.fn(),
  disposeProviderIpc: vi.fn(),
  registerChatIpc: vi.fn(),
  disposeChatIpc: vi.fn(),
  mainFrame: { url: 'about:blank', detached: false, parent: null as MockFrame | null },
  windows: [] as MockWindowState[],
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
    destroyed = false;
    focused = true;
    contentsDestroyed = false;
    contentsFocused = true;
    isDestroyed = () => this.destroyed;
    isFocused = () => this.focused;
    constructor(options: BrowserWindowConstructorOptions) {
      electron.construct(options);
      electron.mainFrame = this.webContents.mainFrame;
      electron.windows.push(this);
    }
    loadURL = electron.loadURL;
    loadFile = electron.loadFile;
    webContents = {
      mainFrame: { url: 'about:blank', detached: false, parent: null as MockFrame | null },
      isDestroyed: () => this.contentsDestroyed,
      isFocused: () => this.contentsFocused,
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
  electron.windows.length = 0;
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
    request({} as WebContents, 'media', callback, { isMainFrame: false, requestingUrl: '' });
    expect(callback).toHaveBeenCalledExactlyOnceWith(false);
    expect(check(null, 'media', '', { isMainFrame: false })).toBe(false);
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

interface PermissionInput { contents: unknown; permission: string; origin: unknown; details: unknown }
function permissionFixture(index = 0) {
  const state = electron.windows[index];
  const requestHandler = electron.setPermissionRequestHandler.mock.calls[index]?.[0];
  const checkHandler = electron.setPermissionCheckHandler.mock.calls[index]?.[0];
  if (!state || !requestHandler || !checkHandler) throw new Error('Permission registration missing');
  const url = state.webContents.mainFrame.url;
  const input: PermissionInput = {
    contents: state.webContents, permission: 'clipboard-sanitized-write',
    origin: new URL(url).origin, details: { isMainFrame: true, requestingUrl: url },
  };
  return {
    state, url, input,
    request(overrides: Partial<PermissionInput> = {}, callback = vi.fn<(allowed: boolean) => void>()) {
      const supplied = { ...input, ...overrides };
      requestHandler(supplied.contents as WebContents, supplied.permission as Parameters<RequestHandler>[1], callback,
        supplied.details as Parameters<RequestHandler>[3]);
      return callback;
    },
    check(overrides: Partial<PermissionInput> = {}) {
      const supplied = { ...input, ...overrides };
      return checkHandler(supplied.contents as WebContents | null, supplied.permission as Parameters<CheckHandler>[1],
        supplied.origin as string, supplied.details as Parameters<CheckHandler>[3]);
    },
  };
}
type PermissionFixture = ReturnType<typeof permissionFixture>;
function expectPermission(f: PermissionFixture, allowed: boolean, overrides: Partial<PermissionInput> = {}) {
  expect(f.request(overrides)).toHaveBeenCalledExactlyOnceWith(allowed);
  expect(f.check(overrides)).toBe(allowed);
}

const invalidPermissionSources: [string, (f: PermissionFixture) => void][] = [
  ['foreign WebContents sharing the main frame', f => { f.input.contents = { ...f.state.webContents }; }],
  ['null WebContents / non-document source', f => { f.input.contents = null; }],
  ['child frame at the same URL', f => { f.input.details = { isMainFrame: false, requestingUrl: f.url }; }],
  ['missing metadata', f => { f.input.details = undefined; }],
  ['null metadata', f => { f.input.details = null; }],
  ['missing main-frame flag', f => { f.input.details = { requestingUrl: f.url }; }],
  ['non-boolean main-frame flag', f => { f.input.details = { isMainFrame: 'true', requestingUrl: f.url }; }],
  ['missing requesting URL', f => { f.input.details = { isMainFrame: true }; }],
  ['empty requesting URL', f => { f.input.details = { isMainFrame: true, requestingUrl: '' }; }],
  ['different URL', f => { f.input.details = { isMainFrame: true, requestingUrl: 'https://foreign.example/' }; }],
  ['URL prefix only', f => { f.input.details = { isMainFrame: true, requestingUrl: f.url + 'another-page' }; }],
  ['URL query', f => { f.input.details = { isMainFrame: true, requestingUrl: f.url + '?other=1' }; }],
  ['URL fragment', f => { f.input.details = { isMainFrame: true, requestingUrl: f.url + '#other' }; }],
  ['origin passed in place of full URL', f => { f.input.details = { isMainFrame: true, requestingUrl: new URL(f.url).origin }; }],
  ['unfocused window', f => { f.state.focused = false; }],
  ['unfocused WebContents', f => { f.state.contentsFocused = false; }],
  ['destroyed window', f => { f.state.destroyed = true; }],
  ['destroyed WebContents', f => { f.state.contentsDestroyed = true; }],
  ['unknown window focus', f => { f.state.focused = undefined as unknown as boolean; }],
  ['unknown destruction state', f => { f.state.destroyed = undefined as unknown as boolean; }],
  ['main frame navigated away', f => { f.state.webContents.mainFrame.url = 'about:blank'; }],
  ['detached main frame', f => { f.state.webContents.mainFrame.detached = true; }],
  ['unknown frame attachment', f => { f.state.webContents.mainFrame.detached = undefined as unknown as boolean; }],
  ['unexpected frame parent', f => { f.state.webContents.mainFrame.parent = { url: f.url, parent: null, detached: false }; }],
  ['unavailable main frame', f => { Object.defineProperty(f.state.webContents, 'mainFrame', { get() { throw Error('Mock native frame failure'); } }); }],
  ['throwing native focus lookup', f => { vi.spyOn(f.state, 'isFocused').mockImplementation(() => { throw Error('Mock native focus failure'); }); }],
];

describe.each([true, false])('clipboard write permission (development=%s)', development => {
  it('allows the focused trusted main document through both Electron 45 handlers', async () => {
    await boot(development);
    expectPermission(permissionFixture(), true);
  });

  it.each([
    'clipboard-read', 'deprecated-sync-clipboard-read', 'clipboard-write',
    'media', 'display-capture', 'geolocation', 'fileSystem', 'notifications', 'unknown',
    'clipboard-sanitized-write ', 'CLIPBOARD-SANITIZED-WRITE', '',
  ])('keeps permission %j denied even for the trusted document', async permission => {
    await boot(development);
    expectPermission(permissionFixture(), false, { permission });
  });

  it.each(invalidPermissionSources)('rejects %s', async (_name, mutate) => {
    await boot(development);
    const f = permissionFixture(); mutate(f);
    expectPermission(f, false);
  });

  it('rechecks focus between Check and Request without caching an earlier allow', async () => {
    await boot(development); const f = permissionFixture();
    expect(f.check()).toBe(true);
    f.state.focused = false;
    expectPermission(f, false);
    f.state.focused = true;
    expectPermission(f, true);
  });

  it('checks the current state when focus changes before a new permission check', async () => {
    await boot(development); const f = permissionFixture();
    f.state.focused = false; expect(f.check()).toBe(false);
    f.state.focused = true; expectPermission(f, true);
    f.state.contentsFocused = false; expectPermission(f, false);
  });

  it('rechecks navigation and attachment between Check and Request', async () => {
    await boot(development); const f = permissionFixture();
    expect(f.check()).toBe(true);
    f.state.webContents.mainFrame.url = 'https://foreign.example/'; expectPermission(f, false);
    f.state.webContents.mainFrame.url = f.url;
    f.state.webContents.mainFrame.detached = true; expectPermission(f, false);
  });

  it.each(['window', 'contents'] as const)('rejects %s destruction after a positive Check', async target => {
    await boot(development); const f = permissionFixture();
    expect(f.check()).toBe(true);
    if (target === 'window') f.state.destroyed = true;
    else f.state.contentsDestroyed = true;
    expectPermission(f, false);
  });

  it('binds recreated-window handlers to the new window, never its predecessor', async () => {
    await boot(development); const old = permissionFixture();
    expect(old.check()).toBe(true); old.state.destroyed = true;
    activate(); await vi.dynamicImportSettled();
    const current = permissionFixture(1);
    expect(current.state.webContents).not.toBe(old.state.webContents);
    expect(current.state.webContents.mainFrame).not.toBe(old.state.webContents.mainFrame);
    expectPermission(old, false);
    expectPermission(old, false, { contents: current.state.webContents });
    expectPermission(current, true);
    expectPermission(current, false, { contents: old.state.webContents });
  });

  it('re-evaluates every repeated request without authorizing reads or later invalid sources', async () => {
    await boot(development); const f = permissionFixture();
    for (let i = 0; i < 3; i++) {
      expectPermission(f, true);
      expectPermission(f, false, { permission: 'clipboard-read' });
      expectPermission(f, false, { details: { isMainFrame: false, requestingUrl: f.url } });
    }
    f.state.focused = false;
    for (let i = 0; i < 3; i++) expectPermission(f, false);
  });

  it('does not call the Request callback a second time if that callback throws', async () => {
    await boot(development); const f = permissionFixture();
    const callback = vi.fn<(allowed: boolean) => void>(() => { throw Error('Mock callback failure'); });
    expect(() => f.request({}, callback)).toThrow('Mock callback failure');
    expect(callback).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('rejects missing Check origin without confusing it with requestingUrl', async () => {
    await boot(development); const f = permissionFixture();
    expect(f.check({ origin: undefined })).toBe(false);
    expect(f.check({ origin: null })).toBe(false);
    expect(f.check({ details: undefined })).toBe(false);
    expect(f.check({ details: { isMainFrame: true } })).toBe(false);
  });
});

describe('clipboard document URL boundaries', () => {
  it.each([
    'http://localhost:5173/', 'http://127.0.0.1:5174/', 'https://127.0.0.1:5173/',
    'http://127.0.0.1:5173.evil/', 'http://127.0.0.1:5173',
  ])('does not accept an alternate development URL: %s', async requestingUrl => {
    await boot(); const f = permissionFixture();
    expectPermission(f, false, { details: { isMainFrame: true, requestingUrl } });
  });

  it('accepts only the two exact development Origin serializations, with a separately validated URL', async () => {
    await boot(); const f = permissionFixture();
    expect(f.check({ origin: new URL(DEV_SERVER_URL).origin })).toBe(true);
    expect(f.check({ origin: DEV_SERVER_URL })).toBe(true);
    for (const origin of ['null', '', 'http://localhost:5173', 'http://127.0.0.1:5174', DEV_SERVER_URL + 'another-page']) {
      expect(f.check({ origin })).toBe(false);
    }
    expect(f.check({ origin: DEV_SERVER_URL, details: undefined })).toBe(false);
  });

  it('never treats file/null Origin alone as a trusted production page', async () => {
    await boot(false); const f = permissionFixture();
    expectPermission(f, true);
    for (const origin of ['null', 'file://', '']) {
      expect(f.check({ origin, details: undefined })).toBe(false);
      expect(f.check({ origin, details: { isMainFrame: true, requestingUrl: 'file:///tmp/index.html' } })).toBe(false);
      expect(f.check({ origin, contents: null })).toBe(false);
    }
    expectPermission(f, false, { details: { isMainFrame: true, requestingUrl: DEV_SERVER_URL } });
  });
});
