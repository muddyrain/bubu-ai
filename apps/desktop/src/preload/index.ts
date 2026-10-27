import { contextBridge, ipcRenderer } from 'electron';
import { GET_VERSION_CHANNEL } from '../shared/ipc';
import type { BubuApi } from '../shared/ipc';

const bubu: BubuApi = Object.freeze({
  app: Object.freeze({
    getVersion: () => ipcRenderer.invoke(GET_VERSION_CHANNEL) as Promise<string>,
  }),
});

contextBridge.exposeInMainWorld('bubu', bubu);
