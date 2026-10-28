import { randomUUID } from 'node:crypto';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVIDER_CHANNELS } from '../../shared/providers';
import { registerProviderIpc } from './ipc';
import { ProviderService } from './provider-service';
import { CredentialVault } from './credential-vault';
import { deferred, MemoryStorage, mockSafeStorage } from './test-helpers';

const ipc=vi.hoisted(()=>({ handlers:new Map<string,(event:IpcMainInvokeEvent,...args:unknown[])=>Promise<unknown>>() }));
vi.mock('electron',()=>({ipcMain:{handle:vi.fn((name:string,handler:(event:IpcMainInvokeEvent,...args:unknown[])=>Promise<unknown>)=>{
  if(ipc.handlers.has(name)) throw new Error('duplicate handler');ipc.handlers.set(name,handler);
}),removeHandler:vi.fn((name:string)=>ipc.handlers.delete(name))}}));
function windowFixture(){
  const closed=vi.fn();const on=vi.fn();
  const window={ isDestroyed:vi.fn(()=>false), once:closed,
    webContents:{ mainFrame:{url:'file:///fixture/index.html'},on } };
  const event={sender:window.webContents,senderFrame:window.webContents.mainFrame} as unknown as IpcMainInvokeEvent;
  return { window:window as unknown as BrowserWindow, raw:window,event,closed,on };
}
const snapshot={profiles:[],selectedProfileId:null,cleanupPending:false};
function serviceFixture(){return {list:vi.fn(async()=>snapshot),save:vi.fn(async()=>snapshot),select:vi.fn(async()=>snapshot),
  remove:vi.fn(async()=>snapshot),probe:vi.fn<ProviderService['probe']>(async()=>snapshot),
  cancel:vi.fn<ProviderService['cancel']>(()=>({status:'cancelled'})),closeOwner:vi.fn()};}
beforeEach(()=>{ipc.handlers.clear();});
describe('provider IPC security and window lifecycle',()=>{
  it.each(['window','frame','url','missing','destroyed'] as const)('rejects an untrusted %s before reaching services',async(kind)=>{
    const w=windowFixture();const s=serviceFixture();registerProviderIpc(w.window,'file:///fixture/index.html',s as unknown as ProviderService);
    let event=w.event;
    if(kind==='window')event={...event,sender:{}} as IpcMainInvokeEvent;
    if(kind==='frame')event={...event,senderFrame:{url:'file:///fixture/index.html'}} as IpcMainInvokeEvent;
    if(kind==='url')w.raw.webContents.mainFrame.url='file:///other/index.html';
    if(kind==='missing')event={...event,senderFrame:null} as IpcMainInvokeEvent;
    if(kind==='destroyed')w.raw.isDestroyed.mockReturnValue(true);
    expect(await ipc.handlers.get(PROVIDER_CHANNELS.list)!(event)).toEqual({ok:false,error:{code:'UNTRUSTED_SENDER'}});
    expect(s.list).not.toHaveBeenCalled();
  });
  it('rejects extra arguments, oversized secrets, unknown fields and arbitrary test bodies',async()=>{
    const w=windowFixture();const s=serviceFixture();registerProviderIpc(w.window,w.raw.webContents.mainFrame.url,s as unknown as ProviderService);
    expect(await ipc.handlers.get(PROVIDER_CHANNELS.list)!(w.event,{})).toEqual({ok:false,error:{code:'INVALID_INPUT'}});
    const input={name:'Fixture',protocol:'openai-compatible-chat-completions',baseUrl:'https://provider.example/v1',modelId:'fixture',enabled:true,key:{action:'replace',value:'x'.repeat(8193)}};
    expect(await ipc.handlers.get(PROVIDER_CHANNELS.save)!(w.event,input)).toEqual({ok:false,error:{code:'INVALID_INPUT'}});
    expect(await ipc.handlers.get(PROVIDER_CHANNELS.save)!(w.event,{...input,key:{action:'replace',value:'密'.repeat(3000)}})).toEqual({ok:false,error:{code:'INVALID_INPUT'}});
    expect(await ipc.handlers.get(PROVIDER_CHANNELS.testConnection)!(w.event,{id:randomUUID(),revision:1,requestId:randomUUID(),consent:{origin:'https://provider.example',accepted:true},body:'private'})).toEqual({ok:false,error:{code:'INVALID_INPUT'}});
    expect(s.probe).not.toHaveBeenCalled();expect(s.save).not.toHaveBeenCalled();
  });
  it('never returns native secret-bearing errors or raw validation issues',async()=>{
    const w=windowFixture();const s=serviceFixture();s.list.mockRejectedValueOnce(new Error('private fixture-only-key path'));
    registerProviderIpc(w.window,w.raw.webContents.mainFrame.url,s as unknown as ProviderService);
    expect(await ipc.handlers.get(PROVIDER_CHANNELS.list)!(w.event)).toEqual({ok:false,error:{code:'STORE_FAILED'}});
  });
  it.each(['cancelled','committing','not-running'] as const)('returns the actual service cancellation status: %s',async(status)=>{
    const w=windowFixture();const s=serviceFixture();s.cancel.mockReturnValue({status});
    registerProviderIpc(w.window,w.raw.webContents.mainFrame.url,s as unknown as ProviderService);
    const input={id:randomUUID(),revision:1,requestId:randomUUID(),consent:{origin:'https://provider.example',accepted:true}};
    await ipc.handlers.get(PROVIDER_CHANNELS.testConnection)!(w.event,input);
    expect(await ipc.handlers.get(PROVIDER_CHANNELS.cancelProbe)!(w.event,{requestId:input.requestId})).toEqual({ok:true,value:{status}});
    expect(s.cancel).toHaveBeenCalledWith(s.probe.mock.calls[0]![0],input.requestId);
  });
  it.each(['close','navigation'] as const)('keeps a real service final commit consistent across window %s',async(action)=>{
    const w=windowFixture();const storage=new MemoryStorage();const adapter={probe:vi.fn(async()=>'passed' as const)};
    const service=new ProviderService(storage,new CredentialVault(mockSafeStorage(),'darwin'),adapter);
    const profile=(await service.save({name:'Fixture',protocol:'openai-compatible-chat-completions',baseUrl:'https://provider.example/v1',
      modelId:'fixture-model',enabled:true,key:{action:'replace',value:'fixture-only-key'}})).profiles[0]!;
    registerProviderIpc(w.window,w.raw.webContents.mainFrame.url,service);
    const committing=deferred<void>();const release=deferred<void>();
    storage.commit.mockImplementationOnce(async(next)=>{committing.resolve();await release.promise;storage.data=structuredClone(next);});
    const input={id:profile.id,revision:profile.revision,requestId:randomUUID(),consent:{origin:'https://provider.example',accepted:true}};
    const result=ipc.handlers.get(PROVIDER_CHANNELS.testConnection)!(w.event,input);
    await committing.promise;
    if(action==='close') {
      (w.closed.mock.calls[0]![1] as ()=>void)();expect(ipc.handlers.size).toBe(0);
    } else {
      (w.on.mock.calls.find(([name])=>name==='did-start-navigation')![1] as (...args:unknown[])=>void)({},w.raw.webContents.mainFrame.url,false,true);
      expect(await ipc.handlers.get(PROVIDER_CHANNELS.cancelProbe)!(w.event,{requestId:input.requestId})).toEqual({ok:true,value:{status:'not-running'}});
    }
    release.resolve();
    const persisted=await service.list();
    expect(await result).toEqual({ok:true,value:persisted});
    expect(persisted.profiles[0]?.connection).toMatchObject({requestId:input.requestId,outcome:'passed'});
    expect(persisted.profiles[0]?.connection).toEqual(storage.data.profiles[0]?.connection);
    expect(adapter.probe).toHaveBeenCalledOnce();
  });
  it.each(['close','navigation'] as const)('revokes a queued real service probe on window %s without sending a request',async(action)=>{
    const w=windowFixture();const storage=new MemoryStorage();const adapter={probe:vi.fn(async()=>'passed' as const)};
    const service=new ProviderService(storage,new CredentialVault(mockSafeStorage(),'darwin'),adapter);
    const config={name:'Fixture',protocol:'openai-compatible-chat-completions' as const,baseUrl:'https://provider.example/v1',
      modelId:'fixture-model',enabled:true,key:{action:'replace' as const,value:'fixture-only-key'}};
    const profile=(await service.save(config)).profiles[0]!;
    registerProviderIpc(w.window,w.raw.webContents.mainFrame.url,service);
    const writing=deferred<void>();const release=deferred<void>();
    storage.commit.mockImplementationOnce(async(next)=>{writing.resolve();await release.promise;storage.data=structuredClone(next);});
    const save=service.save({...config,name:'Unrelated profile'});await writing.promise;
    const input={id:profile.id,revision:profile.revision,requestId:randomUUID(),consent:{origin:'https://provider.example',accepted:true}};
    const result=ipc.handlers.get(PROVIDER_CHANNELS.testConnection)!(w.event,input);
    if(action==='close') {
      (w.closed.mock.calls[0]![1] as ()=>void)();expect(ipc.handlers.size).toBe(0);
    } else {
      (w.on.mock.calls.find(([name])=>name==='did-start-navigation')![1] as (...args:unknown[])=>void)({},w.raw.webContents.mainFrame.url,false,true);
    }
    expect(await result).toEqual({ok:false,error:{code:'CANCELLED'}});
    release.resolve();await save;await service.list();
    expect(adapter.probe).not.toHaveBeenCalled();
    expect(storage.data.profiles.find((p)=>p.id===profile.id)?.connection).toBeUndefined();
    if(action==='navigation')expect(await ipc.handlers.get(PROVIDER_CHANNELS.cancelProbe)!(w.event,{requestId:input.requestId})).toEqual({ok:true,value:{status:'not-running'}});
  });
  it('replaces global handlers safely, closes old ownership, and does not let old close remove new handlers',async()=>{
    const first=windowFixture();const second=windowFixture();const s=serviceFixture();
    registerProviderIpc(first.window,first.raw.webContents.mainFrame.url,s as unknown as ProviderService);
    const oldClose=first.closed.mock.calls[0]![1] as ()=>void;
    registerProviderIpc(second.window,second.raw.webContents.mainFrame.url,s as unknown as ProviderService);
    expect(s.closeOwner).toHaveBeenCalledOnce();oldClose();expect(ipc.handlers.size).toBe(7);
    expect(await ipc.handlers.get(PROVIDER_CHANNELS.list)!(first.event)).toEqual({ok:false,error:{code:'UNTRUSTED_SENDER'}});
    expect(await ipc.handlers.get(PROVIDER_CHANNELS.list)!(second.event)).toEqual({ok:true,value:snapshot});
    const close=second.closed.mock.calls[0]![1] as ()=>void;close();expect(ipc.handlers.size).toBe(0);
  });
  it('revokes the prior document on navigation and binds new requests to a fresh owner',async()=>{
    const w=windowFixture();const s=serviceFixture();registerProviderIpc(w.window,w.raw.webContents.mainFrame.url,s as unknown as ProviderService);
    const input={id:randomUUID(),revision:1,requestId:randomUUID(),consent:{origin:'https://provider.example',accepted:true}};
    await ipc.handlers.get(PROVIDER_CHANNELS.testConnection)!(w.event,input);
    const previous=s.probe.mock.calls[0]?.[0];
    const navigate=w.on.mock.calls[0]![1] as (...args:unknown[])=>void;navigate({},'file:///fixture/index.html',false,true);
    expect(s.closeOwner).toHaveBeenCalledWith(previous);
    await ipc.handlers.get(PROVIDER_CHANNELS.detectTools)!(w.event,{...input,requestId:randomUUID()});
    expect(s.probe.mock.calls[1]?.[0]).not.toBe(previous);
  });
});
