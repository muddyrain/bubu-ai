import { app, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { GET_VERSION_CHANNEL } from '../shared/ipc';

export function registerAppIpc(window: BrowserWindow, rendererUrl: string): void {
  ipcMain.handle(GET_VERSION_CHANNEL, (event, ...args: unknown[]) => {
    if (
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      !event.senderFrame ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== rendererUrl
    ) {
      throw new Error('Untrusted IPC sender');
    }
    if (args.length !== 0) {
      throw new Error('getVersion does not accept arguments');
    }
    return app.getVersion();
  });

  window.once('closed', () => ipcMain.removeHandler(GET_VERSION_CHANNEL));
}
