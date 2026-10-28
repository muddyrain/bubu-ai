import { ipcMain } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { PROVIDER_CHANNELS } from '../../shared/providers';
import { ProviderError, safeResult } from './errors';
import { getProviderService } from './runtime';
import { cancelSchema, probeSchema, saveSchema, targetSchema } from './schemas';

let detachCurrent: (() => void) | undefined;
export function disposeProviderIpc(): void { detachCurrent?.(); }

export function registerProviderIpc(window: BrowserWindow, rendererUrl: string, service = getProviderService()): void {
  detachCurrent?.();
  let owner = {};
  let active = true;
  const trusted = (event: IpcMainInvokeEvent) => active && !window.isDestroyed() &&
    event.sender === window.webContents && Boolean(event.senderFrame) &&
    event.senderFrame === window.webContents.mainFrame && event.senderFrame?.url === rendererUrl;
  const bind = <T>(channel: string, schema: z.ZodType<T>, operation: (input: T) => Promise<unknown>) => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => safeResult(async () => {
      if (!trusted(event)) throw new ProviderError('UNTRUSTED_SENDER');
      const parsed = schema.safeParse(args);
      if (!parsed.success) throw new ProviderError('INVALID_INPUT');
      return operation(parsed.data);
    }));
  };
  bind(PROVIDER_CHANNELS.list, z.tuple([]), async () => service.list());
  bind(PROVIDER_CHANNELS.save, z.tuple([saveSchema]), async ([value]) => service.save(value));
  bind(PROVIDER_CHANNELS.select, z.tuple([targetSchema]), async ([value]) => service.select(value));
  bind(PROVIDER_CHANNELS.remove, z.tuple([targetSchema]), async ([value]) => service.remove(value));
  bind(PROVIDER_CHANNELS.testConnection, z.tuple([probeSchema]), async ([value]) => service.probe(owner, value, 'connection'));
  bind(PROVIDER_CHANNELS.detectTools, z.tuple([probeSchema]), async ([value]) => service.probe(owner, value, 'tools'));
  bind(PROVIDER_CHANNELS.cancelProbe, z.tuple([cancelSchema]), async ([value]) => service.cancel(owner, value.requestId));
  const detach = () => {
    if (!active) return;
    active = false;
    service.closeOwner(owner);
    for (const channel of Object.values(PROVIDER_CHANNELS)) ipcMain.removeHandler(channel);
    if (detachCurrent === detach) detachCurrent = undefined;
  };
  detachCurrent = detach;
  window.once('closed', detach);
  // Reloading/destroying this document revokes its outstanding network requests too.
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) { service.closeOwner(owner); owner = {}; }
  });
  window.webContents.on('render-process-gone', () => service.closeOwner(owner));
}
