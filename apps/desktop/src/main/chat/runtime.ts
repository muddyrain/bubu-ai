import { join } from 'node:path';
import { app } from 'electron';
import { getProviderService } from '../providers/runtime';
import { ChatService } from './chat-service';
import { FileConversationStore } from './conversation-store';
import { OpenAIChatStreamAdapter } from './openai-chat-stream';
import { HttpsChatStreamTransport } from './stream-transport';

let service: ChatService | undefined;
export function getChatService(): ChatService {
  service ??= new ChatService(new FileConversationStore(join(app.getPath('userData'), ...(__DEV__ ? ['development','chat','conversations'] : ['chat','conversations']))),
    getProviderService(), new OpenAIChatStreamAdapter(new HttpsChatStreamTransport()));
  return service;
}
