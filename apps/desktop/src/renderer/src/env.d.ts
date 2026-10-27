import type { BubuApi } from '../../shared/ipc';

declare global {
  interface Window {
    readonly bubu: BubuApi;
  }
}
