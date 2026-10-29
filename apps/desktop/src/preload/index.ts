import { contextBridge, ipcRenderer } from 'electron';
import { GET_VERSION_CHANNEL } from '../shared/ipc';
import type { BubuApi } from '../shared/ipc';
import { PROVIDER_CHANNELS } from '../shared/providers';
import { createChatBridge } from './chat';

const bubu: BubuApi = Object.freeze({
  chat: createChatBridge(ipcRenderer),
  providers: Object.freeze({
    list: () => ipcRenderer.invoke(PROVIDER_CHANNELS.list),
    save: (input) => ipcRenderer.invoke(PROVIDER_CHANNELS.save, input),
    select: (input) => ipcRenderer.invoke(PROVIDER_CHANNELS.select, input),
    remove: (input) => ipcRenderer.invoke(PROVIDER_CHANNELS.remove, input),
    testConnection: (input) => ipcRenderer.invoke(PROVIDER_CHANNELS.testConnection, input),
    detectTools: (input) => ipcRenderer.invoke(PROVIDER_CHANNELS.detectTools, input),
    cancelProbe: (input) => ipcRenderer.invoke(PROVIDER_CHANNELS.cancelProbe, input),
  } satisfies BubuApi['providers']),
  app: Object.freeze({
    getVersion: () => ipcRenderer.invoke(GET_VERSION_CHANNEL) as Promise<string>,
  }),
});

contextBridge.exposeInMainWorld('bubu', bubu);
