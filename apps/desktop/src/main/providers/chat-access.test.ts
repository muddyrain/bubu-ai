import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { SaveProviderInput } from '../../shared/providers';
import { CredentialVault } from './credential-vault';
import { ProviderService } from './provider-service';
import { deferred, MemoryStorage, mockSafeStorage } from './test-helpers';
const input = (): SaveProviderInput => ({name:'Mock',protocol:'openai-compatible-chat-completions',baseUrl:'https://provider.example/v1',modelId:'mock',enabled:true,key:{action:'replace',value:'mock-only-secret'}});
async function setup() {
  const storage = new MemoryStorage(), backend = mockSafeStorage(), adapter = {probe:vi.fn(async ():Promise<'passed'>=>'passed')};
  const service = new ProviderService(storage,new CredentialVault(backend,'darwin'),adapter);
  const p = (await service.save(input())).profiles[0]!;
  await service.probe({}, {id:p.id,revision:p.revision,requestId:randomUUID(),consent:{origin:'https://provider.example',accepted:true}},'connection');
  await service.select({id:p.id,expectedRevision:p.revision});
  return {service,storage,backend,adapter,p,target:{id:p.id,expectedRevision:p.revision}};
}
describe('Main-only selected provider credential access', () => {
  it('exposes public metadata only and never holds the provider serial queue across network lifetime', async () => {
    const c = await setup(), entered = deferred<void>(), finish = deferred<void>(); const controller = new AbortController();
    const access = c.service.withSelectedChatAccess(c.target,controller.signal,async (p,key) => {
      expect(p.id).toBe(c.p.id); expect(key).toBe('fixture-only-key'); entered.resolve(); await finish.promise;
    });
    await entered.promise;
    await c.service.save({...input(),name:'Unrelated'}); // Resolves while streaming remains pending.
    expect((await c.service.list()).profiles).toHaveLength(2);
    expect(JSON.stringify(await c.service.selectedChatProfile())).not.toMatch(/credentialRef|fixture-only-key|mock-only-secret/);
    finish.resolve(); await access; expect(c.adapter.probe).toHaveBeenCalledOnce();
  });
  it.each(['edit','delete','disable','select'] as const)('revokes the actual access signal on %s without changing probe cancellation', async (action) => {
    const c = await setup(), entered = deferred<void>(); let signal!:AbortSignal;
    const result = c.service.withSelectedChatAccess(c.target,new AbortController().signal,async (_p,_k,s) => {
      signal=s; entered.resolve(); return new Promise<void>((_ok,no) => s.addEventListener('abort',()=>no(s.reason),{once:true}));
    });
    const rejected = expect(result).rejects.toThrow('CONFLICT'); await entered.promise;
    if(action==='delete') await c.service.remove(c.target);
    else if(action==='select') await c.service.select(c.target);
    else await c.service.save({...input(),id:c.p.id,expectedRevision:1,enabled:action!=='disable',key:{action:'keep'}});
    expect(signal.aborted).toBe(true); await rejected; expect(c.adapter.probe).toHaveBeenCalledOnce();
  });
  it('cancels queued credential preparation, retains bounded capacity until drained, and never calls the adapter', async () => {
    const c=await setup(), entered=deferred<void>(), release=deferred<void>();
    c.backend.decryptStringAsync.mockClear();
    c.storage.commit.mockImplementationOnce(async(next)=>{entered.resolve();await release.promise;c.storage.data=structuredClone(next);});
    const writing=c.service.save({...input(),name:'Unrelated'}); await entered.promise;
    const controller=new AbortController(), use=vi.fn();
    const result=expect(c.service.withSelectedChatAccess(c.target,controller.signal,use)).rejects.toThrow('cancelled');
    controller.abort(new Error('cancelled')); await result;
    await expect(c.service.withSelectedChatAccess(c.target,new AbortController().signal,use)).rejects.toThrow('BUSY');
    release.resolve(); await writing; await c.service.list();
    expect(use).not.toHaveBeenCalled(); expect(c.backend.decryptStringAsync).not.toHaveBeenCalled();
    await c.service.withSelectedChatAccess(c.target,new AbortController().signal,async()=>{});
    expect(c.backend.decryptStringAsync).toHaveBeenCalledOnce();
  });
  it('rejects invalidated revisions and unavailable credentials before starting any request', async () => {
    const c=await setup(), use=vi.fn();
    await expect(c.service.withSelectedChatAccess({...c.target,expectedRevision:2},new AbortController().signal,use)).rejects.toThrow('CONFLICT');
    c.backend.decryptStringAsync.mockRejectedValueOnce(new Error('private-keychain-data'));
    await expect(c.service.withSelectedChatAccess(c.target,new AbortController().signal,use)).rejects.toThrow('CREDENTIAL_UNAVAILABLE');
    expect(use).not.toHaveBeenCalled(); expect(c.adapter.probe).toHaveBeenCalledOnce();
  });
});
