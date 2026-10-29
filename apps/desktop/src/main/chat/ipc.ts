import { ipcMain } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { CHAT_CHANNELS, CHAT_EVENT_CHANNEL } from '../../shared/chat';
import type { ChatService } from './chat-service';
import { ChatError, safeChat } from './errors';
import { getChatService } from './runtime';
import { cancelSchema, prepareSchema, removeSchema, sendSchema, subscriptionSchema, targetSchema } from './schemas';

let detachCurrent: (() => void) | undefined;
export function disposeChatIpc(): void { detachCurrent?.(); }
export function registerChatIpc(window: BrowserWindow, rendererUrl: string, service: ChatService = getChatService()): void {
  detachCurrent?.();
  let owner = {}, active = true;
  const trusted = (event: IpcMainInvokeEvent) => active && !window.isDestroyed() && event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame && event.senderFrame?.url === rendererUrl;
  const bind = <T>(channel: string, schema: z.ZodType<T>, operation: (input: T) => Promise<unknown>) => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => safeChat(async () => {
      if (!trusted(event)) throw new ChatError('UNTRUSTED_SENDER');
      const input = schema.safeParse(args); if (!input.success) throw new ChatError('INVALID_INPUT');
      return operation(input.data);
    }));
  };
  bind(CHAT_CHANNELS.list, z.tuple([]), () => service.list());
  bind(CHAT_CHANNELS.create, z.tuple([]), () => service.create());
  bind(CHAT_CHANNELS.snapshot, z.tuple([targetSchema]), ([input]) => service.snapshot(input.conversationId));
  bind(CHAT_CHANNELS.remove, z.tuple([removeSchema]), ([input]) => service.remove(input));
  bind(CHAT_CHANNELS.prepareSend, z.tuple([prepareSchema]), ([input]) => service.prepareSend(owner, input));
  bind(CHAT_CHANNELS.send, z.tuple([sendSchema]), ([input]) => service.send(owner, input));
  bind(CHAT_CHANNELS.cancel, z.tuple([cancelSchema]), async ([input]) => service.cancel(owner, input.requestId));
  bind(CHAT_CHANNELS.unsubscribe, z.tuple([subscriptionSchema]), async ([input]) => service.unsubscribe(owner, input.subscriptionId));
  bind(CHAT_CHANNELS.subscribe, z.tuple([targetSchema]), ([input]) => {
    const documentOwner = owner, frame = window.webContents.mainFrame;
    return service.subscribe(documentOwner, input.conversationId, (event) => {
      if (!active || window.isDestroyed() || owner !== documentOwner || frame !== window.webContents.mainFrame || frame.url !== rendererUrl) {
        service.closeOwner(documentOwner); return;
      }
      frame.send(CHAT_EVENT_CHANNEL, event);
    });
  });
  const detach = () => {
    if (!active) return; active = false; service.closeOwner(owner);
    for (const channel of Object.values(CHAT_CHANNELS)) ipcMain.removeHandler(channel);
    if (detachCurrent === detach) detachCurrent = undefined;
  };
  detachCurrent = detach;
  window.once('closed', detach);
  window.webContents.on('did-start-navigation', (details, _url, _inPlace, legacyMain) => {
    const main = typeof details.isMainFrame === 'boolean' ? details.isMainFrame : legacyMain;
    if (main) { service.closeOwner(owner); owner = {}; }
  });
  window.webContents.on('render-process-gone', () => service.closeOwner(owner));
}
