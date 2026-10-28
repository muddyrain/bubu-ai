import type { ProvidersApi } from './providers';

export const GET_VERSION_CHANNEL = 'bubu:app:get-version';
export const DEV_SERVER_URL = 'http://127.0.0.1:5173/';

export interface BubuApi {
  readonly providers: Readonly<ProvidersApi>;
  readonly app: {
    readonly getVersion: () => Promise<string>;
  };
}
