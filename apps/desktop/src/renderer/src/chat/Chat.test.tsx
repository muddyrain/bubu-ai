// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act,cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { App } from '../App';
import type { ChatMessage,ChatResult,ChatSnapshot } from '../../../shared/chat';
import { MessageItem } from './MessageList';
import { chatMock,mockProfile } from './test-helpers';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((r,no)=>{resolve=r;reject=no;});return{promise,resolve,reject};}
async function fixture(mock=chatMock(),strict=false){
  const p=mock.profile(),other=mockProfile('另一个模型');const providers={profiles:[p,other],selectedProfileId:p.id,cleanupPending:false};
  const select=vi.fn(async(input:{id:string})=>{providers.selectedProfileId=input.id;mock.select(providers.profiles.find(p=>p.id===input.id)!);return{ok:true,value:structuredClone(providers)};});
  vi.stubGlobal('bubu',{app:{getVersion:async()=>'0.1.0'},chat:mock.api,providers:{list:vi.fn(async()=>({ok:true,value:structuredClone(providers)})),select}});
  const user=userEvent.setup(),view=render(strict?<StrictMode><App/></StrictMode>:<App/>);
  await screen.findByText('应用版本 0.1.0');await waitFor(()=>expect((screen.getByRole('textbox',{name:'消息输入'}) as HTMLTextAreaElement).disabled).toBe(false));
  return{mock,user,view,p,other,select,input:()=>screen.getByRole('textbox',{name:'消息输入'}) as HTMLTextAreaElement};
}
async function send(f:Awaited<ReturnType<typeof fixture>>,text='你好，布布'){
  await f.user.type(f.input(),text);await f.user.click(screen.getByRole('button',{name:'发送消息'}));await waitFor(()=>expect(f.mock.api.send).toHaveBeenCalled());
}
describe('real React text-chat UI with an explicitly mocked bridge',()=>{
  it.each(['pending','streaming','failed','stopped'] as const)('uses an empty assistant body consistent with its %s state',status=>{
    const p=mockProfile(),now=new Date().toISOString();
    const message:ChatMessage={id:crypto.randomUUID(),requestId:crypto.randomUUID(),runId:crypto.randomUUID(),role:'assistant',text:'',status,seq:1,createdAt:now,updatedAt:now,
      recipient:{providerId:p.id,revision:p.revision,name:p.name,baseUrl:p.baseUrl,origin:new URL(p.baseUrl).origin,modelId:p.modelId},
      ...(status==='failed'?{errorCode:'EMPTY_RESPONSE' as const}:status==='stopped'?{errorCode:'CANCELLED' as const}:{})};
    render(<MessageItem message={message} persisted={true}/>);
    if(status==='pending'||status==='streaming'){
      expect(screen.getByText('正在等待可见文本…')).toBeTruthy();
      expect(screen.getByRole('status').textContent).toBe(status==='pending'?'等待模型回复':'正在生成');
    }else{
      expect(screen.queryByText('正在等待可见文本…')).toBeNull();
      expect(screen.getByText('本轮没有收到可显示的文本。')).toBeTruthy();
      expect(screen.getByRole('status').textContent).toBe(status==='failed'?'本轮失败 · 已保存':'已停止 · 已保存');
      expect(screen.getByText(status==='failed'?'模型没有返回可见文本。':'本轮已停止。')).toBeTruthy();
    }
    expect(screen.queryByRole('button',{name:'复制回答'})).toBeNull();
  });
  it.each([
    {label:'stopped with text',status:'stopped' as const,text:'已收到的回答',errorCode:'CANCELLED' as const,expected:'已停止 · 部分回答'},
    {label:'stopped with whitespace',status:'stopped' as const,text:' \n\t ',errorCode:'CANCELLED' as const,expected:'已停止'},
    {label:'truncated without text',status:'failed' as const,text:'',errorCode:'OUTPUT_TRUNCATED' as const,expected:'回复已截断'},
    {label:'truncated with whitespace',status:'failed' as const,text:' \n\t ',errorCode:'OUTPUT_TRUNCATED' as const,expected:'回复已截断'},
    {label:'truncated with text',status:'failed' as const,text:'未完成的回答',errorCode:'OUTPUT_TRUNCATED' as const,expected:'回复已截断 · 部分回答'},
  ].flatMap(entry=>[true,false].map(persisted=>({...entry,persisted}))))('reports $label accurately: persisted=$persisted',({status,text,errorCode,expected,persisted})=>{
    const p=mockProfile(),now=new Date().toISOString();
    const message:ChatMessage={id:crypto.randomUUID(),requestId:crypto.randomUUID(),runId:crypto.randomUUID(),role:'assistant',text,status,errorCode,seq:1,createdAt:now,updatedAt:now,
      recipient:{providerId:p.id,revision:p.revision,name:p.name,baseUrl:p.baseUrl,origin:new URL(p.baseUrl).origin,modelId:p.modelId}};
    render(<MessageItem message={message} persisted={persisted}/>);
    expect(screen.getByRole('status').textContent).toBe(expected+(persisted?' · 已保存':' · 尚未保存'));
    expect(screen.queryByText('正在等待可见文本…')).toBeNull();
    expect(screen.getByText(errorCode==='CANCELLED'?/本轮已停止。/:/回答因输出预算耗尽而截断/)).toBeTruthy();
    if(text.trim())expect(screen.getByRole('button',{name:'复制回答'})).toBeTruthy();
    else{expect(screen.getByText('本轮没有收到可显示的文本。')).toBeTruthy();expect(screen.queryByRole('button',{name:'复制回答'})).toBeNull();}
  });
  it('formats a streamed long answer safely and copies code or the exact whole answer without another send',async()=>{
    const f=await fixture(),write=vi.spyOn(navigator.clipboard,'writeText').mockResolvedValue(undefined);
    await send(f);
    const text='## 一个清晰的方案\n\n先 **确认目标**，再继续。\n\n- 保留原文\n- 不执行工具\n\n```ts\nconst title = "你好😀";\n```\n\n<img src="https://private.example/pixel">';
    await act(async()=>f.mock.text(text));
    expect(screen.getByRole('heading',{name:'一个清晰的方案'})).toBeTruthy();
    expect(document.querySelector('img,script')).toBeNull();expect(screen.queryByRole('button',{name:'复制回答'})).toBeNull();
    await f.user.click(screen.getByRole('button',{name:'复制代码'}));expect(write).toHaveBeenLastCalledWith('const title = "你好😀";');
    await act(async()=>f.mock.end());await f.user.click(screen.getByRole('button',{name:'复制回答'}));expect(write).toHaveBeenLastCalledWith(text);
    expect(f.mock.api.send).toHaveBeenCalledOnce();expect(f.mock.api.subscribe).toHaveBeenCalledOnce();expect(f.mock.api.cancel).not.toHaveBeenCalled();
  });
  it('separates current selection from the recipient of an existing reply in the inspector',async()=>{
    const f=await fixture();await send(f);await act(async()=>{f.mock.text('已回答');f.mock.end();});
    await f.user.selectOptions(screen.getByRole('combobox',{name:'聊天模型'}),f.other.id);
    await f.user.click(screen.getByRole('button',{name:'展开面板'}));
    const panel=screen.getByRole('complementary',{name:'对话信息'});
    const current=within(panel).getByRole('heading',{name:'当前发送模型'}).parentElement!;
    const previous=within(panel).getByRole('heading',{name:'最近回复来源'}).parentElement!;
    expect(current.textContent).toContain(f.other.name);expect(previous.textContent).toContain(f.p.name);
    expect(panel.textContent).toContain('明文 JSON');expect(screen.queryByText('三步开始使用')).toBeNull();
    expect(f.mock.api.send).toHaveBeenCalledOnce();expect(f.mock.api.subscribe).toHaveBeenCalledOnce();
  });
  it('uses the existing session timestamps and message counts without requesting message previews',async()=>{
    const mock=chatMock(),created=await mock.api.create();if(!created.ok)throw Error();
    const saved=mock.data.get(created.value.conversation.id)!;
    saved.conversation.title='一个特别长的会话标题，仍然能够完整地被辅助技术读取';
    const f=await fixture(mock);
    const button=screen.getByRole('button',{name:'打开会话 '+saved.conversation.title});
    expect(button.getAttribute('aria-current')).toBe('true');expect(within(button).getByTitle(saved.conversation.title)).toBeTruthy();
    expect(within(button).getByText('0 条消息')).toBeTruthy();expect(button.querySelector('time')?.dateTime).toBe(saved.conversation.updatedAt);
    expect(f.mock.api.snapshot).not.toHaveBeenCalled();expect(f.mock.api.send).not.toHaveBeenCalled();
  });
  it('names length truncation as a partial persisted answer, never a completed response',async()=>{
    const f=await fixture();await send(f);await act(async()=>{f.mock.text('未完成的文字');f.mock.end('failed',true,'OUTPUT_TRUNCATED');});
    expect(screen.getByText('回复已截断 · 部分回答 · 已保存')).toBeTruthy();expect(screen.queryByText('回答完成 · 已保存')).toBeNull();
    expect(screen.getByText(/回答因输出预算耗尽而截断/)).toBeTruthy();expect(f.mock.api.send).toHaveBeenCalledOnce();
  });
  it.each(['failed-result','rejected-invoke'] as const)('retains a stoppable started run after a %s acknowledgement, then accepts only the real terminal',async(kind)=>{
    const f=await fixture(),ack=deferred<ChatResult<{requestId:string;runId:string}>>(),original=f.mock.api.send.getMockImplementation()!;
    f.mock.api.send.mockImplementationOnce(async input=>{await original(input);return ack.promise;});
    await send(f);expect(screen.getByRole('button',{name:'停止生成'})).toHaveProperty('disabled',false);
    await act(async()=>{if(kind==='failed-result')ack.resolve({ok:false,error:{code:'NETWORK_FAILED'}});else ack.reject(new Error('private IPC detail'));});
    expect(screen.getByRole('button',{name:'停止生成'})).toHaveProperty('disabled',false);expect(f.input().readOnly).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('生成状态同步异常，正在核实');
    expect(f.mock.api.snapshot).toHaveBeenCalledOnce();expect(f.mock.api.send).toHaveBeenCalledOnce();expect(f.mock.api.subscribe).toHaveBeenCalledOnce();
    await act(async()=>f.mock.text('Main 仍在生成'));expect(screen.getByText('Main 仍在生成')).toBeTruthy();
    if(kind==='failed-result'){await act(async()=>f.mock.end());expect(screen.getByText('回答完成 · 已保存')).toBeTruthy();}
    else{await f.user.click(screen.getByRole('button',{name:'停止生成'}));expect(f.mock.api.cancel).toHaveBeenCalledOnce();expect(screen.getByText('已停止 · 部分回答 · 已保存')).toBeTruthy();}
    expect(f.input().readOnly).toBe(false);expect(screen.queryByRole('button',{name:'停止生成'})).toBeNull();expect(f.mock.api.send).toHaveBeenCalledOnce();
  });
  it('keeps a started run stoppable when both the acknowledgement and snapshot recovery fail',async()=>{
    const f=await fixture(),ack=deferred<ChatResult<{requestId:string;runId:string}>>(),original=f.mock.api.send.getMockImplementation()!;
    f.mock.api.send.mockImplementationOnce(async input=>{await original(input);return ack.promise;});await send(f);
    f.mock.api.snapshot.mockResolvedValueOnce({ok:false,error:{code:'NETWORK_FAILED'}});
    await act(async()=>ack.resolve({ok:false,error:{code:'NETWORK_FAILED'}}));expect(screen.getByRole('button',{name:'停止生成'})).toHaveProperty('disabled',false);
    expect(f.mock.api.send).toHaveBeenCalledOnce();await act(async()=>{f.mock.text('partial');f.mock.end('failed',true,'NETWORK_FAILED');});
    expect(f.input().readOnly).toBe(false);expect(screen.getByText('本轮失败 · 已保存')).toBeTruthy();
  });
  it('releases an unaccepted send only after snapshot verification and preserves the unsent draft',async()=>{
    const f=await fixture(),ack=deferred<ChatResult<{requestId:string;runId:string}>>(),snapshot=deferred<ChatResult<ChatSnapshot>>();
    f.mock.api.send.mockImplementationOnce(()=>ack.promise);await send(f,'未被接纳的草稿');
    const original=f.mock.api.snapshot.getMockImplementation()!;f.mock.api.snapshot.mockImplementationOnce(()=>snapshot.promise);
    await act(async()=>ack.resolve({ok:false,error:{code:'NETWORK_FAILED'}}));
    expect(f.mock.api.snapshot).toHaveBeenCalledOnce();expect(screen.getByRole('button',{name:'停止生成'})).toBeTruthy();
    const conversationId=[...f.mock.data.keys()][0]!;await act(async()=>snapshot.resolve(await original({conversationId})));
    expect(f.input().readOnly).toBe(false);expect(f.input().value).toBe('未被接纳的草稿');expect(screen.queryByRole('button',{name:'停止生成'})).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('连接失败');expect(f.mock.api.send).toHaveBeenCalledOnce();expect(screen.queryByRole('article',{name:'你的消息'})).toBeNull();
  });
  it.each(['compositionend-first','composing-keydown-first'] as const)('does not send the IME candidate confirmation Enter: %s',async(order)=>{
    const f=await fixture();fireEvent.compositionStart(f.input());fireEvent.change(f.input(),{target:{value:'中文候选词'}});
    if(order==='composing-keydown-first')fireEvent.keyDown(f.input(),{key:'Enter',keyCode:13,isComposing:true});
    fireEvent.compositionEnd(f.input());
    if(order==='compositionend-first')fireEvent.keyDown(f.input(),{key:'Enter',keyCode:13,isComposing:false});
    await act(async()=>{});
    expect(f.mock.api.prepareSend).not.toHaveBeenCalled();expect(f.mock.api.send).not.toHaveBeenCalled();expect(f.input().value).toBe('中文候选词');
    fireEvent.keyUp(f.input(),{key:'Enter',keyCode:13});
    fireEvent.keyDown(f.input(),{key:'Enter',keyCode:13,isComposing:false});await waitFor(()=>expect(f.mock.api.send).toHaveBeenCalledOnce());await act(async()=>f.mock.end('stopped'));
  });
  it('expires the short IME guard when a candidate was confirmed without an Enter keyup',async()=>{
    const f=await fixture(),clock=vi.spyOn(performance,'now').mockReturnValue(1000);
    fireEvent.compositionStart(f.input());fireEvent.change(f.input(),{target:{value:'鼠标确认候选词'}});fireEvent.compositionEnd(f.input());
    clock.mockReturnValue(1101);fireEvent.keyDown(f.input(),{key:'Enter',keyCode:13});await waitFor(()=>expect(f.mock.api.send).toHaveBeenCalledOnce());await act(async()=>f.mock.end('stopped'));
  });
  it('does not turn a held IME confirmation Enter into a send after the guard expires',async()=>{
    const f=await fixture(),clock=vi.spyOn(performance,'now').mockReturnValue(1000);
    fireEvent.compositionStart(f.input());fireEvent.change(f.input(),{target:{value:'按住确认键'}});fireEvent.compositionEnd(f.input());
    clock.mockReturnValue(1200);fireEvent.keyDown(f.input(),{key:'Enter',keyCode:13,repeat:true});await act(async()=>{});
    expect(f.mock.api.send).not.toHaveBeenCalled();fireEvent.keyUp(f.input(),{key:'Enter'});fireEvent.keyDown(f.input(),{key:'Enter',keyCode:13});
    await waitFor(()=>expect(f.mock.api.send).toHaveBeenCalledOnce());await act(async()=>f.mock.end('stopped'));
  });
  it('stops before switching an active session, and ignores callbacks from the old subscription',async()=>{
    const mock=chatMock();const first=await mock.api.create(),second=await mock.api.create();if(!first.ok||!second.ok)throw Error();
    mock.data.get(second.value.conversation.id)!.conversation.title='会话 B';const f=await fixture(mock);await send(f,'会话 A');
    const previous=mock.api.subscribe.mock.calls[0]![1],base=mock.lastEventBase();await f.user.click(screen.getByRole('button',{name:'打开会话 会话 B'}));
    await f.user.click(screen.getByRole('button',{name:'停止并继续'}));await waitFor(()=>expect(mock.api.subscribe).toHaveBeenCalledTimes(2));
    expect(mock.api.cancel).toHaveBeenCalledOnce();expect(document.activeElement).toBe(f.input());
    await act(async()=>previous({...base,type:'delta',seq:base.seq+1,text:'stale text'}));expect(screen.queryByText('stale text')).toBeNull();expect(mock.api.send).toHaveBeenCalledOnce();
  });
  it('can stay on the workbench after requesting navigation while final persistence is pending',async()=>{
    const f=await fixture();await send(f);await act(async()=>{f.mock.text('saving');f.mock.committing();});
    await f.user.click(screen.getByRole('button',{name:'停止生成'}));await f.user.click(screen.getByRole('button',{name:'设置'}));
    await f.user.click(screen.getByRole('button',{name:'等待保存后继续'}));await f.user.click(screen.getByRole('button',{name:'继续留在当前页面'}));
    await act(async()=>f.mock.end());await new Promise(r=>setTimeout(r,70));expect(screen.queryByRole('main',{name:'模型供应商'})).toBeNull();expect(screen.getByRole('region',{name:'聊天消息'})).toBeTruthy();
  });
  it('subscribes before send, keeps one subscription across rerenders, and renders plain text until a true saved terminal',async()=>{
    const f=await fixture();await send(f);expect(f.mock.api.subscribe.mock.invocationCallOrder[0]).toBeLessThan(f.mock.api.send.mock.invocationCallOrder[0]!);
    expect(screen.queryByText('回答完成 · 已保存')).toBeNull();
    await act(async()=>f.mock.text('<script>not executable</script> 你好😀'));
    expect(screen.getByText('<script>not executable</script> 你好😀')).toBeTruthy();expect(document.querySelector('script')).toBeNull();
    await f.user.click(screen.getByRole('button',{name:'展开面板'}));await f.user.click(screen.getByRole('button',{name:'收起面板'}));
    expect(f.mock.api.subscribe).toHaveBeenCalledOnce();expect(f.mock.api.cancel).not.toHaveBeenCalled();
    await act(async()=>f.mock.end());expect(screen.getByText('回答完成 · 已保存')).toBeTruthy();expect(f.input().readOnly).toBe(false);
    expect(screen.getByRole('button',{name:'打开会话 你好，布布'})).toBeTruthy();
  });
  it('supports Chinese composition, keyCode 229, Enter send and Shift+Enter newline without double sends',async()=>{
    const f=await fixture();await f.user.type(f.input(),'中文');fireEvent.compositionStart(f.input());
    fireEvent.keyDown(f.input(),{key:'Enter',keyCode:229,isComposing:true});expect(f.mock.api.prepareSend).not.toHaveBeenCalled();
    fireEvent.compositionEnd(f.input());await f.user.keyboard('{Shift>}{Enter}{/Shift}');expect(f.input().value).toBe('中文\n');
    fireEvent.keyDown(f.input(),{key:'Enter',keyCode:229});expect(f.mock.api.prepareSend).not.toHaveBeenCalled();
    await f.user.keyboard('{Enter}');await waitFor(()=>expect(f.mock.api.send).toHaveBeenCalledOnce());
    await f.user.keyboard('{Enter}');expect(f.mock.api.send).toHaveBeenCalledOnce();await act(async()=>f.mock.end('stopped'));
  });
  it('uses the real cancel API, preserves partial text and restores input focus after stop',async()=>{
    const f=await fixture();await send(f);await act(async()=>f.mock.text('部分回答'));await f.user.click(screen.getByRole('button',{name:'停止生成'}));
    expect(f.mock.api.cancel).toHaveBeenCalledOnce();expect(screen.getByText('部分回答')).toBeTruthy();expect(screen.getByText('已停止 · 部分回答 · 已保存')).toBeTruthy();expect(screen.queryByText('回答完成 · 已保存')).toBeNull();
    await waitFor(()=>expect(document.activeElement).toBe(f.input()));
  });
  it('does not mislabel failed persistence or quota as a saved answer, and blocks further sends in that session',async()=>{
    const f=await fixture();await send(f);await act(async()=>{f.mock.text('未保存回答');f.mock.end('failed',false,'LIMIT_REACHED');});
    expect(screen.getByText('本轮失败 · 尚未保存')).toBeTruthy();expect(screen.getByText(/已达到消息、上下文或本地存储上限/)).toBeTruthy();
    await f.user.type(f.input(),'next');expect((screen.getByRole('button',{name:'发送消息'}) as HTMLButtonElement).disabled).toBe(true);
  });
  it('distinguishes waiting for visible text from network failure',async()=>{
    const f=await fixture();await send(f);await act(async()=>f.mock.waiting());expect(screen.getByText('等待较久，模型仍在处理…')).toBeTruthy();
    expect(screen.getByRole('button',{name:'停止生成'})).toBeTruthy();await act(async()=>f.mock.end('failed',true,'NETWORK_IDLE'));expect(screen.getByText(/长时间没有数据/)).toBeTruthy();
  });
  it('confirms navigation, supports continuing without cancelling, and restores the chat after settings',async()=>{
    const f=await fixture();await send(f);await act(async()=>f.mock.text('回答中'));
    const settings=screen.getByRole('button',{name:'设置'});await f.user.click(settings);let modal=screen.getByRole('dialog',{name:'停止回复并继续？'});
    expect(document.activeElement).toBe(within(modal).getByRole('button',{name:'继续留在当前页面'}));fireEvent(modal,new Event('cancel',{cancelable:true}));
    expect(f.mock.api.cancel).not.toHaveBeenCalled();expect(document.activeElement).toBe(settings);
    await f.user.click(settings);modal=screen.getByRole('dialog');await f.user.click(within(modal).getByRole('button',{name:'停止并继续'}));
    await screen.findByRole('main',{name:'模型供应商'});expect(f.mock.api.cancel).toHaveBeenCalledOnce();
    await f.user.click(screen.getByRole('button',{name:'工作台'}));await screen.findByText('回答中');expect(f.mock.api.subscribe).toHaveBeenCalledTimes(2);
  });
  it('waits for actual committing completion before leaving; it never claims cancellation succeeded',async()=>{
    const f=await fixture();await send(f);await act(async()=>{f.mock.text('即将完成');f.mock.committing();});
    await f.user.click(screen.getByRole('button',{name:'停止生成'}));expect(screen.getByRole('button',{name:'正在保存…'})).toHaveProperty('disabled',true);
    await f.user.click(screen.getByRole('button',{name:'设置'}));await f.user.click(screen.getByRole('button',{name:'等待保存后继续'}));
    expect(screen.queryByRole('main',{name:'模型供应商'})).toBeNull();await act(async()=>f.mock.end());
    await screen.findByRole('main',{name:'模型供应商'});expect(screen.queryByText(/取消成功/)).toBeNull();
  });
  it('creates, switches and deletes sessions with keyboard-accessible confirmation and retained drafts',async()=>{
    const f=await fixture();await send(f,'第一个会话');await act(async()=>{f.mock.text('answer');f.mock.end();});
    await f.user.type(f.input(),'未发送草稿');await f.user.click(screen.getByRole('button',{name:'新对话'}));
    await waitFor(()=>expect(f.input().value).toBe(''));expect(document.activeElement).toBe(f.input());
    await f.user.click(screen.getByRole('button',{name:'打开会话 第一个会话'}));await waitFor(()=>expect(f.input().value).toBe('未发送草稿'));
    await f.user.click(screen.getByRole('button',{name:'删除会话 第一个会话'}));expect(f.mock.api.remove).not.toHaveBeenCalled();
    await f.user.click(screen.getByRole('button',{name:'确认删除'}));await waitFor(()=>expect(f.mock.api.remove).toHaveBeenCalledOnce());expect(screen.queryByText('answer')).toBeNull();
    await f.user.click(screen.getByRole('button',{name:'最近会话'}));expect(screen.getByRole('dialog',{name:'本地会话'})).toBeTruthy();
  });
  it('shows exact history disclosure and makes zero requests on refusal, then sends only after explicit consent',async()=>{
    const f=await fixture();await send(f,'第一问');await act(async()=>{f.mock.text('完整回答');f.mock.end();});
    await f.user.selectOptions(screen.getByRole('combobox',{name:'聊天模型'}),f.other.id);await f.user.type(f.input(),'第二问');await f.user.click(screen.getByRole('button',{name:'发送消息'}));
    let modal=await screen.findByRole('dialog',{name:'将历史发送给这个模型？'});expect(modal.textContent).toContain('用户消息 2 条（含本轮输入），完整 AI 回答 1 条');expect(modal.textContent).toContain('https://provider.example');
    expect(screen.getByText('等待发送确认')).toBeTruthy();
    expect(f.mock.api.send).toHaveBeenCalledOnce();expect(document.activeElement).toBe(within(modal).getByRole('button',{name:'取消'}));
    const confirm=within(modal).getByRole('button',{name:'同意并发送'});confirm.focus();await f.user.tab();expect(document.activeElement).toBe(within(modal).getByRole('button',{name:'关闭对话框'}));
    fireEvent(modal,new Event('cancel',{cancelable:true}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(f.input().value).toBe('第二问');expect(f.mock.api.send).toHaveBeenCalledOnce();
    await f.user.click(screen.getByRole('button',{name:'发送消息'}));modal=await screen.findByRole('dialog');await f.user.click(within(modal).getByRole('button',{name:'同意并发送'}));
    await waitFor(()=>expect(f.mock.api.send).toHaveBeenCalledTimes(2));expect(f.mock.api.send.mock.calls[1]?.[0].accepted).toBe(true);await act(async()=>f.mock.end('stopped'));
  });
  it('does not remount subscriptions under StrictMode or when draft, model state and panel state rerender',async()=>{
    const f=await fixture(chatMock(),true);await send(f);await f.user.click(screen.getByRole('button',{name:'展开面板'}));
    await act(async()=>f.mock.text('text'));expect(f.mock.api.subscribe).toHaveBeenCalledOnce();expect(f.mock.api.unsubscribe).not.toHaveBeenCalled();await act(async()=>f.mock.end());
  });
  it('retains the error code on admission failure and does not clear unsent input',async()=>{
    const f=await fixture();f.mock.api.prepareSend.mockResolvedValueOnce({ok:false,error:{code:'CREDENTIAL_UNAVAILABLE'}});await f.user.type(f.input(),'preserve me');
    await f.user.click(screen.getByRole('button',{name:'发送消息'}));expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('模型凭据暂不可用'));expect(f.input().value).toBe('preserve me');expect(f.mock.api.send).not.toHaveBeenCalled();
  });
  it('handles first deltas and terminal events before the send acknowledgement without using the receipt as completion',async()=>{
    const f=await fixture(),ack=deferred<ChatResult<{requestId:string;runId:string}>>(),original=f.mock.api.send.getMockImplementation()!;
    let result!:ChatResult<{requestId:string;runId:string}>;f.mock.api.send.mockImplementationOnce(async input=>{result=await original(input);return ack.promise;});
    await send(f);await act(async()=>f.mock.text('early'));expect(screen.getByText('early')).toBeTruthy();expect(screen.queryByText('回答完成 · 已保存')).toBeNull();
    await act(async()=>f.mock.end());expect(screen.getByText('回答完成 · 已保存')).toBeTruthy();await act(async()=>ack.resolve(result));expect(f.mock.api.send).toHaveBeenCalledOnce();
  });
  it('deduplicates events and replaces state after a gap, while rejecting a stale snapshot response',async()=>{
    const f=await fixture();await send(f);await act(async()=>f.mock.text('once'));
    const base=f.mock.lastEventBase();await act(async()=>f.mock.update({...base,type:'delta',text:'once'}));expect(screen.getByText('once')).toBeTruthy();expect(screen.queryByText('onceonce')).toBeNull();
    const late=deferred<ChatResult<ChatSnapshot>>(),old=structuredClone([...f.mock.data.values()][0]!);f.mock.api.snapshot.mockImplementationOnce(()=>late.promise);
    await act(async()=>f.mock.update({...base,type:'delta',seq:base.seq+2,text:'gap'}));await act(async()=>{f.mock.text('two');f.mock.end();});
    await act(async()=>late.resolve({ok:true,value:old}));expect(screen.getByText('oncetwo')).toBeTruthy();expect(screen.getByText('回答完成 · 已保存')).toBeTruthy();
  });
  it('exposes a back-to-latest control when the reader scrolls away from the stream',async()=>{
    const f=await fixture();await send(f);await act(async()=>f.mock.text('line\n'.repeat(300)));
    const region=screen.getByRole('region',{name:'聊天消息'});Object.defineProperties(region,{scrollHeight:{value:2000,configurable:true},clientHeight:{value:400,configurable:true}});region.scrollTop=0;fireEvent.scroll(region);
    await act(async()=>f.mock.text('新内容'));expect(region.scrollTop).toBe(0);
    await f.user.click(screen.getByRole('button',{name:'回到最新 ↓'}));expect(region.scrollTop).toBe(2000);expect(screen.queryByRole('button',{name:'回到最新 ↓'})).toBeNull();await act(async()=>f.mock.end());
  });
  it('bounds UTF-8 input bytes and keeps file, directory and Agent capabilities disabled',async()=>{
    const f=await fixture();fireEvent.change(f.input(),{target:{value:'中'.repeat(6000)}});expect(screen.getByText('输入超过 16 KiB，请缩短消息。')).toBeTruthy();expect(screen.getByRole('button',{name:'发送消息'})).toHaveProperty('disabled',true);
    expect(screen.queryByRole('button',{name:'添加文件，后续开放'})).toBeNull();expect(screen.queryByRole('button',{name:'选择本地目录（后续开放）'})).toBeNull();
    expect(screen.getByText('文件与任务功能后续开放。')).toBeTruthy();
    expect(f.mock.api.prepareSend).not.toHaveBeenCalled();
  });
});
