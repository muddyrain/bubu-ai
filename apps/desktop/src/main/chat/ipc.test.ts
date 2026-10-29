import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { BrowserWindow,IpcMainInvokeEvent } from 'electron';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { CHAT_CHANNELS,CHAT_EVENT_CHANNEL } from '../../shared/chat';
import type { ChatEvent } from '../../shared/chat';
import { registerChatIpc,disposeChatIpc } from './ipc';
import { setupChat } from './test-helpers';
const ipc=vi.hoisted(()=>({handlers:new Map<string,(e:IpcMainInvokeEvent,...args:unknown[])=>Promise<unknown>>()}));
vi.mock('electron',()=>({ipcMain:{handle:(c:string,h:(e:IpcMainInvokeEvent,...a:unknown[])=>Promise<unknown>)=>{if(ipc.handlers.has(c))throw new Error('duplicate');ipc.handlers.set(c,h);},removeHandler:(c:string)=>ipc.handlers.delete(c)}}));
function windowFixture(){
  const window=Object.assign(new EventEmitter(),{isDestroyed:vi.fn(()=>false),webContents:Object.assign(new EventEmitter(),{mainFrame:{url:'file:///mock/index.html',send:vi.fn()}})});
  const event={sender:window.webContents,senderFrame:window.webContents.mainFrame} as unknown as IpcMainInvokeEvent;
  return {raw:window,window:window as unknown as BrowserWindow,event};
}
beforeEach(()=>{disposeChatIpc();ipc.handlers.clear();});
describe('named chat IPC validation and document lifecycle',()=>{
  it.each(['details-reload','legacy-reload','process-gone'] as const)('aborts a running real service request on %s',async(kind)=>{
    const c=await setupChat(),w=windowFixture();registerChatIpc(w.window,w.raw.webContents.mainFrame.url,c.service);
    const ready=await ipc.handlers.get(CHAT_CHANNELS.subscribe)!(w.event,{conversationId:c.c.conversation.id}) as {value:{subscriptionId:string}};
    const prepared=await ipc.handlers.get(CHAT_CHANNELS.prepareSend)!(w.event,{conversationId:c.c.conversation.id,expectedRevision:1,requestId:randomUUID(),text:'reload'}) as {value:{id:string}};
    await ipc.handlers.get(CHAT_CHANNELS.send)!(w.event,{planId:prepared.value.id,subscriptionId:ready.value.subscriptionId});await c.requested.promise;
    if(kind==='details-reload')w.raw.webContents.emit('did-start-navigation',{isMainFrame:true,url:w.raw.webContents.mainFrame.url});
    if(kind==='legacy-reload')w.raw.webContents.emit('did-start-navigation',{},w.raw.webContents.mainFrame.url,false,true);
    if(kind==='process-gone')w.raw.webContents.emit('render-process-gone',{},{});
    expect(c.signal().aborted).toBe(true);await vi.waitFor(()=>expect(c.storage.data.get(c.c.conversation.id)?.messages.at(-1)?.status).toBe('stopped'));
    expect(c.adapter.stream).toHaveBeenCalledOnce();c.service.dispose();
  });
  it('does not revoke the main document for a child-frame navigation, preferring current details over deprecated arguments',async()=>{
    const c=await setupChat(),w=windowFixture();registerChatIpc(w.window,w.raw.webContents.mainFrame.url,c.service);
    const close=vi.spyOn(c.service,'closeOwner');w.raw.webContents.emit('did-start-navigation',{isMainFrame:false},'',false,true);
    expect(close).not.toHaveBeenCalled();c.service.dispose();
  });
  it.each(['window','frame','url','missing','destroyed'] as const)('rejects untrusted %s before any service operation',async(kind)=>{
    const c=await setupChat(),w=windowFixture();registerChatIpc(w.window,w.raw.webContents.mainFrame.url,c.service);
    let event=w.event;if(kind==='window')event={...event,sender:{}} as IpcMainInvokeEvent;
    if(kind==='frame')event={...event,senderFrame:{url:w.raw.webContents.mainFrame.url}} as IpcMainInvokeEvent;
    if(kind==='url')w.raw.webContents.mainFrame.url='file:///other.html';if(kind==='missing')event={...event,senderFrame:null} as IpcMainInvokeEvent;
    if(kind==='destroyed')w.raw.isDestroyed.mockReturnValue(true);
    expect(await ipc.handlers.get(CHAT_CHANNELS.list)!(event)).toEqual({ok:false,error:{code:'UNTRUSTED_SENDER'}});c.service.dispose();
  });
  it('rejects arbitrary channels, extra parameters, unknown fields and oversized text',async()=>{
    const c=await setupChat(),w=windowFixture();registerChatIpc(w.window,w.raw.webContents.mainFrame.url,c.service);
    expect(ipc.handlers.size).toBe(9);expect(ipc.handlers.has('execute')).toBe(false);
    expect(await ipc.handlers.get(CHAT_CHANNELS.list)!(w.event,{})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
    for(const patch of [{text:'中'.repeat(6000)},{apiKey:'mock'},{expectedRevision:0},{requestId:'bad'}]){
      expect(await ipc.handlers.get(CHAT_CHANNELS.prepareSend)!(w.event,{conversationId:c.c.conversation.id,expectedRevision:1,requestId:randomUUID(),text:'hello',...patch})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
    }
    expect(c.adapter.stream).not.toHaveBeenCalled();c.service.dispose();
  });
  it.each(['navigation','closed','gone'] as const)('revokes a document on %s and prevents pending plans from sending',async(action)=>{
    const c=await setupChat(),w=windowFixture();registerChatIpc(w.window,w.raw.webContents.mainFrame.url,c.service);
    const ready=await ipc.handlers.get(CHAT_CHANNELS.subscribe)!(w.event,{conversationId:c.c.conversation.id}) as {ok:true;value:{subscriptionId:string}};
    const prepared=await ipc.handlers.get(CHAT_CHANNELS.prepareSend)!(w.event,{conversationId:c.c.conversation.id,expectedRevision:1,requestId:randomUUID(),text:'hello'}) as {ok:true;value:{id:string}};
    if(action==='navigation')w.raw.webContents.emit('did-start-navigation',{},w.raw.webContents.mainFrame.url,false,true);
    if(action==='closed')w.raw.emit('closed');if(action==='gone')w.raw.webContents.emit('render-process-gone');
    if(action==='closed')expect(ipc.handlers.size).toBe(0);
    else expect(await ipc.handlers.get(CHAT_CHANNELS.send)!(w.event,{planId:prepared.value.id,subscriptionId:ready.value.subscriptionId})).toMatchObject({ok:false});
    expect(c.adapter.stream).not.toHaveBeenCalled();c.service.dispose();
  });
  it('delivers the first event only to the subscribed frame, sanitizes errors and replaces handlers safely',async()=>{
    const c=await setupChat(),w=windowFixture();registerChatIpc(w.window,w.raw.webContents.mainFrame.url,c.service);
    const ready=await ipc.handlers.get(CHAT_CHANNELS.subscribe)!(w.event,{conversationId:c.c.conversation.id}) as {ok:true;value:{subscriptionId:string}};
    const requestId=randomUUID();const prepared=await ipc.handlers.get(CHAT_CHANNELS.prepareSend)!(w.event,{conversationId:c.c.conversation.id,expectedRevision:1,requestId,text:'hello'}) as {ok:true;value:{id:string}};
    await ipc.handlers.get(CHAT_CHANNELS.send)!(w.event,{planId:prepared.value.id,subscriptionId:ready.value.subscriptionId});await c.requested.promise;
    const first=w.raw.webContents.mainFrame.send.mock.calls[0] as [string,ChatEvent];expect(first[0]).toBe(CHAT_EVENT_CHANNEL);expect(first[1]).toMatchObject({type:'started',requestId});
    const second=windowFixture();registerChatIpc(second.window,second.raw.webContents.mainFrame.url,c.service);w.raw.emit('closed');expect(ipc.handlers.size).toBe(9);
    await vi.waitFor(()=>expect(c.storage.data.get(c.c.conversation.id)?.messages.at(-1)?.status).toBe('stopped'));
    expect(w.raw.webContents.mainFrame.send).toHaveBeenCalledOnce();
    vi.spyOn(c.service,'list').mockRejectedValueOnce(new Error('mock-private-secret'));
    expect(await ipc.handlers.get(CHAT_CHANNELS.list)!(second.event)).toEqual({ok:false,error:{code:'NETWORK_FAILED'}});c.service.dispose();
  });
});
