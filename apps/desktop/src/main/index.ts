import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { DEV_SERVER_URL } from '../shared/ipc';
import { registerAppIpc } from './ipc';
import { disposeProviderIpc, registerProviderIpc } from './providers/ipc';
import { disposeChatIpc, registerChatIpc } from './chat/ipc';

async function createWindow(): Promise<void> {
  const rendererFile = join(__dirname, '../renderer/index.html');
  const rendererUrl = __DEV__ ? DEV_SERVER_URL : pathToFileURL(rendererFile).href;
  const window = new BrowserWindow({
    title: 'Bubu AI',
    width: 1100,
    height: 800,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#F6F0E9',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    },
  });

  registerAppIpc(window, rendererUrl);
  registerProviderIpc(window, rendererUrl);
  registerChatIpc(window, rendererUrl);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-frame-navigate', (event) => {
    const mainFrame = window.webContents.mainFrame;
    const trustedReload = __DEV__ &&
      event.isMainFrame &&
      event.frame === mainFrame &&
      mainFrame.url === rendererUrl &&
      event.url === rendererUrl &&
      event.initiator === mainFrame;
    if (!trustedReload) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  window.webContents.session.setPermissionCheckHandler(() => false);

  if (__DEV__) {
    await window.loadURL(rendererUrl);
  } else {
    await window.loadFile(rendererFile);
  }
}

function handleStartupError(error: unknown, phase: 'startup' | 'activate' = 'startup'): void {
  const failure = error instanceof Error ? error : undefined;
  const code = failure && 'code' in failure ? failure.code : undefined;
  const errno = failure && 'errno' in failure ? failure.errno : undefined;
  // Native error identifiers provide diagnostics without logging raw messages,
  // stacks, URLs or paths, which may contain private data.
  const nativeCode = typeof code === 'string' && /^(?:ERR_[A-Z0-9_]{1,64}|E[A-Z]{2,16})$/.test(code)
    ? code
    : failure?.message.match(/\bERR_[A-Z0-9_]{1,64}\b/)?.[0];
  console.error('Bubu AI could not create or load its application window.', {
    phase,
    mode: __DEV__ ? 'development' : 'production',
    errorType: error instanceof TypeError ? 'TypeError' : failure ? 'Error' : typeof error,
    code: nativeCode ?? 'UNKNOWN',
    errno: typeof errno === 'number' && Number.isSafeInteger(errno) ? errno : null,
  });
  app.quit();
}

app.setName('Bubu AI');
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow().catch((error: unknown) => handleStartupError(error, 'activate'));
    }
  });
}).catch(handleStartupError);

app.on('before-quit', disposeProviderIpc);
app.on('before-quit', disposeChatIpc);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
