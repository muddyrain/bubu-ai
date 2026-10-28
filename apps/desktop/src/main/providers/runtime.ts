import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import { CredentialVault } from './credential-vault';
import { OpenAIChatCompletionsAdapter } from './openai-chat-completions';
import { FileProfileStorage } from './profile-store';
import { HttpsProviderTransport } from './provider-transport';
import { ProviderService } from './provider-service';

let service: ProviderService | undefined;
export function getProviderService(): ProviderService {
  service ??= new ProviderService(
    new FileProfileStorage(join(app.getPath('userData'), ...(__DEV__ ? ['development','model-providers'] : ['model-providers']))),
    new CredentialVault(safeStorage, process.platform),
    new OpenAIChatCompletionsAdapter(new HttpsProviderTransport()),
  );
  return service;
}
