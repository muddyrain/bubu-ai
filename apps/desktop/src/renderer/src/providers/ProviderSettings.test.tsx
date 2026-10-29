// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { chatMock } from '../chat/test-helpers';
import type { CancelProbeOutcome, ProbeInput, ProviderProfile, ProviderResult, ProviderSnapshot, ProvidersApi } from '../../../shared/providers';

const profile: ProviderProfile={id:'00000000-0000-4000-8000-000000000001',name:'示例模型',protocol:'openai-compatible-chat-completions',
  baseUrl:'https://provider.example/v1',modelId:'fixture-model',enabled:true,revision:1,createdAt:'2026-10-27T00:00:00.000Z',updatedAt:'2026-10-27T00:00:00.000Z',hasKey:true};
function fixture(profiles:ProviderProfile[]=[],selectedProfileId:string|null=null){
  let data:ProviderSnapshot={profiles:structuredClone(profiles),selectedProfileId,cleanupPending:false};
  const success=():ProviderResult<ProviderSnapshot>=>({ok:true,value:structuredClone(data)});
  const evidence=(input:ProbeInput,outcome:'passed'|'supported')=>({profileId:input.id,revision:input.revision,requestId:input.requestId,probeVersion:1,checkedAt:'2026-10-27T00:00:00.000Z',outcome});
  const api={
    list:vi.fn<ProvidersApi['list']>(async()=>success()),
    save:vi.fn<ProvidersApi['save']>(async(input)=>{
      const old=data.profiles.find((p)=>p.id===input.id);
      const p:ProviderProfile={...profile,id:old?.id??crypto.randomUUID(),name:input.name,baseUrl:input.baseUrl,modelId:input.modelId,
        enabled:input.enabled&&(input.key.action==='keep'?Boolean(old?.hasKey):input.key.action==='replace'),hasKey:input.key.action==='keep'?Boolean(old?.hasKey):input.key.action==='replace',revision:(old?.revision??0)+1};
      data={...data,profiles:[...data.profiles.filter((entry)=>entry.id!==p.id),p],selectedProfileId:null};return success();
    }),
    select:vi.fn<ProvidersApi['select']>(async(input)=>{data.selectedProfileId=input.id;return success();}),
    remove:vi.fn<ProvidersApi['remove']>(async(input)=>{data.profiles=data.profiles.filter((p)=>p.id!==input.id);
      if(data.selectedProfileId===input.id)data.selectedProfileId=null;return success();}),
    testConnection:vi.fn<ProvidersApi['testConnection']>(async(input)=>{data.profiles.find((p)=>p.id===input.id)!.connection=evidence(input,'passed');return success();}),
    detectTools:vi.fn<ProvidersApi['detectTools']>(async(input)=>{data.profiles.find((p)=>p.id===input.id)!.tools=evidence(input,'supported');return success();}),
    cancelProbe:vi.fn<ProvidersApi['cancelProbe']>(async()=>({ok:true,value:{status:'cancelled'}})),
  };
  vi.stubGlobal('bubu',{app:{getVersion:async()=>'0.1.0'},providers:api,chat:chatMock().api});return api;
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
async function open(){
  const user=userEvent.setup();render(<App/>);await screen.findByText('应用版本 0.1.0');
  await user.click(screen.getByRole('button',{name:'设置'}));
  return user;
}
async function typeKey(user:ReturnType<typeof userEvent.setup>,value:string){
  const replace=screen.queryByRole('button',{name:'更换密钥'});
  if(replace)await user.click(replace);
  await user.type(screen.getByLabelText('API Key'),value);
}
function deferred<T>(){
  let resolve!:(value:T)=>void;
  const promise=new Promise<T>((done)=>{resolve=done;});
  return {promise,resolve};
}
function passedSnapshot(input:ProbeInput):ProviderSnapshot{
  return {profiles:[{...profile,connection:{profileId:input.id,revision:input.revision,requestId:input.requestId,
    probeVersion:1,checkedAt:'2026-10-27T00:00:00.000Z',outcome:'passed'}}],selectedProfileId:null,cleanupPending:false};
}
describe('model settings with an explicitly mocked bridge',()=>{
  it('creates a configuration without testing or exposing the entered key',async()=>{
    const api=fixture();const user=await open();
    await user.type(screen.getByLabelText('配置名称'),'示例模型');
    await user.type(screen.getByLabelText('Base URL'),profile.baseUrl);
    await user.type(screen.getByLabelText('Model ID'),'fixture-model');
    await typeKey(user,'fixture-only-key');
    await user.click(screen.getByRole('button',{name:'保存配置'}));
    await screen.findByRole('button',{name:'编辑 示例模型'});
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({key:{action:'replace',value:'fixture-only-key'}}));
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).not.toContain('fixture-only-key');
    expect(api.testConnection).not.toHaveBeenCalled();expect(api.detectTools).not.toHaveBeenCalled();
    expect(screen.queryByRole('region',{name:'消息输入区'})).toBeNull();
  });
  it('shows safe storage errors, clears password after failure and retains nonsecret edits',async()=>{
    const api=fixture([profile]);api.save.mockResolvedValue({ok:false,error:{code:'STORAGE_UNAVAILABLE'}});
    const user=await open();await user.click(screen.getByRole('button',{name:'编辑 示例模型'}));
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('');
    await typeKey(user,'fixture-only-key');
    await user.click(screen.getByRole('button',{name:'保存配置'}));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('安全存储不可用'));
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('配置名称') as HTMLInputElement).value).toBe('示例模型');
  });
  it('retains a stored key when a replacement is typed and then cleared',async()=>{
    const api=fixture([profile]);const user=await open();
    await user.click(screen.getByRole('button',{name:'编辑 示例模型'}));
    await typeKey(user,'fixture-replacement');
    await user.clear(screen.getByLabelText('API Key'));
    await user.click(screen.getByRole('button',{name:'保存配置'}));
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({key:{action:'keep'}}));
  });
  it('separately confirms connection and tool probes, then selects a verified profile',async()=>{
    const api=fixture([profile]);const user=await open();
    await user.click(screen.getByRole('button',{name:'测试连接'}));
    let confirmation=screen.getByRole('dialog',{name:/测试模型连接|检测工具调用能力|删除本地配置/});
    expect(confirmation.textContent).toContain('https://provider.example');expect(confirmation.textContent).toContain('可能产生 API 用量');
    await user.click(within(confirmation).getByRole('button',{name:'取消'}));expect(api.testConnection).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button',{name:'测试连接'}));
    await user.click(screen.getByRole('button',{name:'确认发送'}));await screen.findAllByText(/上次检测通过/);
    expect(api.testConnection).toHaveBeenCalledOnce();expect(api.detectTools).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button',{name:'检测工具能力'}));
    confirmation=screen.getByRole('dialog',{name:/测试模型连接|检测工具调用能力|删除本地配置/});expect(confirmation.textContent).toContain('绝不执行工具');
    await user.click(screen.getByRole('button',{name:'确认发送'}));await screen.findByText(/工具探针通过/);
    await user.click(screen.getByRole('button',{name:'设为工作台模型'}));
    await screen.findByRole('button',{name:'工作台使用中'});
    expect(screen.queryByRole('textbox',{name:'消息输入'})).toBeNull();
  });
  it('cancels a pending probe using its own request ID',async()=>{
    const api=fixture([profile]);let finish!:(result:ProviderResult<ProviderSnapshot>)=>void;
    api.testConnection.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    api.cancelProbe.mockImplementation(async()=>{finish({ok:false,error:{code:'CANCELLED'}});return {ok:true,value:{status:'cancelled'}};});
    const user=await open();await user.click(screen.getByRole('button',{name:'测试连接'}));
    await user.click(screen.getByRole('button',{name:'确认发送'}));await screen.findByRole('button',{name:'取消检测'});
    expect(screen.getByText('暂无已完成的检测记录')).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'取消检测'}));await screen.findByText('检测已取消。');
    expect(api.cancelProbe).toHaveBeenCalledWith({requestId:api.testConnection.mock.calls[0]![0].requestId});
  });
  it.each([
    ['cancelled','正在取消检测…','CANCELLED'],
    ['committing','正在保存检测结果，已无法取消。','passed'],
    ['committing','正在保存检测结果，已无法取消。','STORE_FAILED'],
    ['not-running','未找到可取消的检测，正在等待结果。','passed'],
  ] as const)('shows cancellation %s while waiting for the actual %s result (%s)',async(status,message,outcome)=>{
    const api=fixture([profile]);const pending=deferred<ProviderResult<ProviderSnapshot>>();
    api.testConnection.mockReturnValueOnce(pending.promise);
    api.cancelProbe.mockResolvedValueOnce({ok:true,value:{status}});
    const user=await open();await user.click(screen.getByRole('button',{name:'测试连接'}));
    await user.click(screen.getByRole('button',{name:'确认发送'}));
    await user.click(await screen.findByRole('button',{name:'取消检测'}));
    expect(await screen.findByText(message)).toBeTruthy();
    expect((screen.getByRole('button',{name:'取消检测'}) as HTMLButtonElement).disabled).toBe(status!=='not-running');
    expect(screen.queryByText('检测已取消。')).toBeNull();expect(screen.queryAllByText(/上次检测通过/).at(0) ?? null).toBeNull();
    await act(async()=>{pending.resolve(outcome==='passed'?{ok:true,value:passedSnapshot(api.testConnection.mock.calls[0]![0])}:
      {ok:false,error:{code:outcome}});});
    if(outcome==='passed')expect(await screen.findAllByText(/上次检测通过/)).toBeTruthy();
    else expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining(outcome==='CANCELLED'?'检测已取消':'配置写入失败'));
    expect(screen.queryByRole('button',{name:'取消检测'})).toBeNull();
    expect(api.testConnection).toHaveBeenCalledOnce();expect(api.cancelProbe).toHaveBeenCalledOnce();
  });
  it.each(['committing','cancelled','error'] as const)('ignores a late cancellation reply (%s) after the persisted result arrives',async(status)=>{
    const api=fixture([profile]);const pending=deferred<ProviderResult<ProviderSnapshot>>();
    const cancellation=deferred<ProviderResult<CancelProbeOutcome>>();
    api.testConnection.mockReturnValueOnce(pending.promise);api.cancelProbe.mockReturnValueOnce(cancellation.promise);
    const user=await open();await user.click(screen.getByRole('button',{name:'测试连接'}));
    await user.click(screen.getByRole('button',{name:'确认发送'}));
    await user.click(await screen.findByRole('button',{name:'取消检测'}));
    await act(async()=>{pending.resolve({ok:true,value:passedSnapshot(api.testConnection.mock.calls[0]![0])});});
    await screen.findAllByText(/上次检测通过/);
    await act(async()=>{cancellation.resolve(status==='error'?{ok:false,error:{code:'UNTRUSTED_SENDER'}}:{ok:true,value:{status}});});
    expect(screen.getAllByText(/上次检测通过/)[0]).toBeTruthy();expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('正在保存检测结果，已无法取消。')).toBeNull();
    expect(screen.queryByText('正在取消检测…')).toBeNull();
    expect(api.testConnection).toHaveBeenCalledOnce();expect(api.cancelProbe).toHaveBeenCalledOnce();
  });
  it('makes unsaved changes visible and preserves the existing collapse control and focus',async()=>{
    fixture();const user=await open();await user.type(screen.getByLabelText('配置名称'),'未保存');
    await user.click(screen.getByRole('button',{name:'返回工作台'}));
    expect(screen.getByRole('dialog',{name:'保留未保存的修改？'})).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'继续编辑'}));
    expect((screen.getByLabelText('配置名称') as HTMLInputElement).value).toBe('未保存');
    await user.click(screen.getByRole('button',{name:'返回工作台'}));
    await user.click(screen.getByRole('button',{name:'放弃修改并继续'}));
    const toggle=screen.getByRole('button',{name:'工作台'});expect(document.activeElement).toBe(toggle);
    expect(screen.queryByRole('main',{name:'模型供应商'})).toBeNull();
    expect(screen.getByRole('region',{name:'消息输入区'})).toBeTruthy();
  });
  it('cancels a pending probe when leaving model settings',async()=>{
    const api=fixture([profile]);let finish!:(result:ProviderResult<ProviderSnapshot>)=>void;
    api.testConnection.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    api.cancelProbe.mockImplementation(async()=>{finish({ok:false,error:{code:'CANCELLED'}});return {ok:true,value:{status:'cancelled'}};});
    const user=await open();await user.click(screen.getByRole('button',{name:'测试连接'}));
    await user.click(screen.getByRole('button',{name:'确认发送'}));await screen.findByRole('button',{name:'取消检测'});
    expect(screen.getByText('暂无已完成的检测记录')).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'返回工作台'}));
    expect(api.cancelProbe).toHaveBeenCalledWith({requestId:api.testConnection.mock.calls[0]![0].requestId});
    expect(screen.getByRole('button',{name:'工作台'})).toBeTruthy();
  });
  it('deletes only after confirmation and supports keyboard activation',async()=>{
    const api=fixture([profile]);const user=await open();
    const button=screen.getByRole('button',{name:'删除配置'});button.focus();await user.keyboard('{Enter}');
    const confirmation=screen.getByRole('dialog',{name:/测试模型连接|检测工具调用能力|删除本地配置/});
    expect(confirmation.textContent).toContain('不会撤销供应商端 Key');
    await user.click(screen.getByRole('button',{name:'确认删除'}));await screen.findByText(/暂无模型配置/);
    expect(api.remove).toHaveBeenCalledWith({id:profile.id,expectedRevision:1});
  });
  it('normalizes a rejected bridge promise instead of displaying native error details',async()=>{
    const api=fixture();api.list.mockRejectedValue(new Error('private fixture-only-key'));
    await open();await act(async()=>{});
    expect(screen.getByRole('alert').textContent).not.toContain('private');
    expect(document.body.textContent).not.toContain('fixture-only-key');
  });

  it.each(['back','new','switch','delete'] as const)('protects all draft fields and clears sensitive input only after discarding for %s',async(action)=>{
    const second={...profile,id:'00000000-0000-4000-8000-000000000002',name:'备用模型'};
    const api=fixture([profile,second]);const user=await open();
    await user.clear(screen.getByLabelText('配置名称'));await user.type(screen.getByLabelText('配置名称'),'未保存名称');
    await user.clear(screen.getByLabelText('Model ID'));await user.type(screen.getByLabelText('Model ID'),'draft-model');
    await user.clear(screen.getByLabelText('Base URL'));await user.type(screen.getByLabelText('Base URL'),'https://other.example/v1');
    await user.click(screen.getByRole('button',{name:'更换密钥'}));
    const password=screen.getByLabelText('API Key') as HTMLInputElement;await user.type(password,'fixture-draft-key');
    await user.click(screen.getByRole('checkbox',{name:'启用此配置'}));
    const trigger=()=>screen.getByRole('button',{name:action==='back'?'工作台':action==='new'?'新增配置':action==='switch'?'编辑 备用模型':'删除配置'});
    await user.click(trigger());
    const dialog=screen.getByRole('dialog',{name:'保留未保存的修改？'});
    expect(dialog.hasAttribute('open')).toBe(true);expect(document.activeElement).toBe(within(dialog).getByRole('button',{name:'继续编辑'}));
    await user.click(within(dialog).getByRole('button',{name:'继续编辑'}));
    expect(document.activeElement).toBe(trigger());
    expect((screen.getByLabelText('配置名称') as HTMLInputElement).value).toBe('未保存名称');
    expect((screen.getByLabelText('Model ID') as HTMLInputElement).value).toBe('draft-model');
    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe('https://other.example/v1');
    expect(password.value).toBe('fixture-draft-key');expect((screen.getByRole('checkbox',{name:'启用此配置'}) as HTMLInputElement).checked).toBe(false);
    await user.click(trigger());await user.click(screen.getByRole('button',{name:'放弃修改并继续'}));
    expect(password.value).toBe('');
    if(action==='back')expect(screen.getByRole('main',{name:'欢迎使用'})).toBeTruthy();
    if(action==='new')expect((screen.getByLabelText('配置名称') as HTMLInputElement).value).toBe('');
    if(action==='switch')expect((screen.getByLabelText('配置名称') as HTMLInputElement).value).toBe('备用模型');
    if(action==='delete')expect(screen.getByRole('dialog',{name:/测试模型连接|检测工具调用能力|删除本地配置/}).textContent).toContain('删除本地配置');
    expect(api.save).not.toHaveBeenCalled();expect(api.remove).not.toHaveBeenCalled();expect(api.testConnection).not.toHaveBeenCalled();
  });
  it('treats Escape as continuing editing and restores focus without dropping input',async()=>{
    fixture([profile]);const user=await open();await typeKey(user,'fixture-draft-key');
    const trigger=screen.getByRole('button',{name:'新增配置'});await user.click(trigger);
    fireEvent(screen.getByRole('dialog'),new Event('cancel',{cancelable:true}));
    expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(trigger);
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('fixture-draft-key');
  });
  it('keeps all saved configurations in the named list without replacing it with a select',async()=>{
    const profiles=Array.from({length:20},(_,index)=>({...profile,id:crypto.randomUUID(),name:`模型 ${index+1}`}));
    fixture(profiles,profiles[0]!.id);await open();
    const list=screen.getByRole('list',{name:'已保存模型配置'});
    expect(within(list).getAllByRole('button',{name:/^编辑 /})).toHaveLength(20);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(within(list).getByRole('button',{name:'编辑 模型 1'}).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button',{name:'工作台使用中'})).toBeTruthy();
  });
  it('clears dirty state after saving and navigates without a discard prompt',async()=>{
    const api=fixture([profile]);const user=await open();
    await user.clear(screen.getByLabelText('配置名称'));await user.type(screen.getByLabelText('配置名称'),'新名称');
    await user.click(screen.getByRole('button',{name:'保存配置'}));await screen.findByRole('button',{name:'编辑 新名称'});
    expect(screen.getByText('配置已保存。未发起模型请求。')).toBeTruthy();
    expect(screen.queryByText('有未保存修改')).toBeNull();
    expect(screen.queryByRole('button',{name:'保存配置'})).toBeNull();
    await user.click(screen.getByRole('button',{name:'工作台'}));expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('main',{name:'欢迎使用'})).toBeTruthy();
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({id:profile.id,expectedRevision:1,key:{action:'keep'}}));
  });
  it('switches saved profiles without writing, re-entering a key or losing the selected-model distinction',async()=>{
    const second={...profile,id:'00000000-0000-4000-8000-000000000002',name:'备用模型'};
    const api=fixture([profile,second]);const user=await open();
    await user.click(screen.getByRole('button',{name:'编辑 备用模型'}));
    expect(document.activeElement).toBe(screen.getByLabelText('配置名称'));
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('尚未选择')).toBeTruthy();
    expect((screen.getByRole('button',{name:'设为工作台模型'}) as HTMLButtonElement).disabled).toBe(true);
    expect(api.save).not.toHaveBeenCalled();expect(api.select).not.toHaveBeenCalled();expect(api.testConnection).not.toHaveBeenCalled();
  });
  it('shows a failed historical test independently from saved credentials and model selection',async()=>{
    const failed={...profile,connection:{...passedSnapshot({id:profile.id,revision:1,requestId:'00000000-0000-4000-8000-000000000003',consent:{origin:'https://provider.example',accepted:true}}).profiles[0]!.connection!,outcome:'failed' as const,code:'AUTH_FAILED' as const}};
    fixture([failed]);await open();
    expect(screen.getAllByText(/上次检测失败/).length).toBeGreaterThan(0);expect(screen.getByText('密钥不会回显。')).toBeTruthy();
    expect(screen.getByText('尚未选择')).toBeTruthy();
    expect((screen.getByRole('button',{name:'设为工作台模型'}) as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps the detected profile open when a failed connection removes its selected state',async()=>{
    const second={...profile,id:'00000000-0000-4000-8000-000000000002',name:'当前模型'};
    const api=fixture([profile,second],second.id);
    api.testConnection.mockImplementation(async(input)=>({ok:true,value:{profiles:[profile,{...second,
      connection:{profileId:input.id,revision:input.revision,requestId:input.requestId,probeVersion:1,
        checkedAt:'2026-10-28T00:00:00.000Z',outcome:'failed',code:'AUTH_FAILED'}}],selectedProfileId:null,cleanupPending:false}}));
    const user=await open();await user.click(screen.getByRole('button',{name:'测试连接'}));
    await user.click(screen.getByRole('button',{name:'确认发送'}));
    expect(await screen.findByText(/认证失败/)).toBeTruthy();
    expect((screen.getByLabelText('配置名称') as HTMLInputElement).value).toBe('当前模型');
    expect(screen.getByText('尚未选择')).toBeTruthy();
    expect((screen.getByRole('button',{name:'设为工作台模型'}) as HTMLButtonElement).disabled).toBe(true);
    expect(api.testConnection).toHaveBeenCalledOnce();expect(api.select).not.toHaveBeenCalled();
  });
  it('keeps committing nonblocking for navigation and refreshes the real result on re-entry',async()=>{
    const second={...profile,id:'00000000-0000-4000-8000-000000000002',name:'备用模型'};
    const api=fixture([profile,second]);const pending=deferred<ProviderResult<ProviderSnapshot>>();
    api.testConnection.mockReturnValueOnce(pending.promise);api.cancelProbe.mockResolvedValue({ok:true,value:{status:'committing'}});
    const user=await open();await user.click(screen.getByRole('button',{name:'测试连接'}));await user.click(screen.getByRole('button',{name:'确认发送'}));
    expect(await screen.findByText('正在测试连接…')).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'取消检测'}));await screen.findByText('正在保存检测结果，已无法取消。');
    expect(screen.queryByText('检测已取消。')).toBeNull();
    await user.click(screen.getByRole('button',{name:'返回工作台'}));expect(screen.getByRole('main',{name:'欢迎使用'})).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'设置'}));await user.click(screen.getByRole('button',{name:'编辑 备用模型'}));
    expect((screen.getByLabelText('配置名称') as HTMLInputElement).value).toBe('备用模型');
    expect(screen.getByText('检测配置：示例模型')).toBeTruthy();
    expect(screen.getByText('正在保存检测结果，已无法取消。')).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'返回工作台'}));
    const savedResult={...passedSnapshot(api.testConnection.mock.calls[0]![0]),profiles:[passedSnapshot(api.testConnection.mock.calls[0]![0]).profiles[0]!,second]};
    await act(async()=>{pending.resolve({ok:true,value:savedResult});});
    api.list.mockResolvedValue({ok:true,value:savedResult});await user.click(screen.getByRole('button',{name:'设置'}));
    expect(await screen.findAllByText(/上次检测通过/)).toBeTruthy();expect(screen.queryByText('检测已取消。')).toBeNull();
    expect(api.list.mock.calls.length).toBeGreaterThan(2);expect(api.testConnection).toHaveBeenCalledOnce();
  });
  it('distinguishes ordinary configuration saving from final probe persistence',async()=>{
    const api=fixture([profile]);const pending=deferred<ProviderResult<ProviderSnapshot>>();api.save.mockReturnValueOnce(pending.promise);
    const user=await open();await user.type(screen.getByLabelText('配置名称'),'修改');await user.click(screen.getByRole('button',{name:'保存配置'}));
    expect(screen.getByRole('button',{name:'正在处理…'})).toBeTruthy();
    expect(screen.queryByText('正在保存检测结果，已无法取消。')).toBeNull();
    expect((screen.getByRole('button',{name:'返回工作台'}) as HTMLButtonElement).disabled).toBe(true);
    await act(async()=>{pending.resolve({ok:false,error:{code:'STORE_FAILED'}});});
    expect((screen.getByRole('button',{name:'返回工作台'}) as HTMLButtonElement).disabled).toBe(false);
  });
  it('ignores an older initial list response after the settings refresh has restored a newer snapshot',async()=>{
    const api=fixture([profile]);const old=deferred<ProviderResult<ProviderSnapshot>>();api.list.mockReturnValueOnce(old.promise);
    const user=await open();await screen.findByRole('button',{name:'编辑 示例模型'});
    await act(async()=>{old.resolve({ok:true,value:{profiles:[],selectedProfileId:null,cleanupPending:false}});});
    expect(screen.getByRole('button',{name:'编辑 示例模型'})).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'编辑 示例模型'}));expect((screen.getByLabelText('配置名称') as HTMLInputElement).value).toBe('示例模型');
  });
  it.each([
    ['测试连接','测试模型连接？'],['检测工具能力','检测工具调用能力？'],['删除配置','删除本地配置？'],
  ])('uses a modal with safe focus and no side effect before confirming %s',async(triggerName,title)=>{
    const api=fixture([profile]);const user=await open();
    const trigger=screen.getByRole('button',{name:triggerName});await user.click(trigger);
    const dialog=screen.getByRole('dialog',{name:title});
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(within(dialog).getByRole('button',{name:'取消'}));
    expect(api.testConnection).not.toHaveBeenCalled();expect(api.detectTools).not.toHaveBeenCalled();expect(api.remove).not.toHaveBeenCalled();
    await user.tab({shift:true});expect(document.activeElement).toBe(within(dialog).getByRole('button',{name:'关闭对话框'}));
    await user.tab({shift:true});expect(document.activeElement).toBe(within(dialog).getByRole('button',{name:triggerName==='删除配置'?'确认删除':'确认发送'}));
    await user.tab();expect(document.activeElement).toBe(within(dialog).getByRole('button',{name:'关闭对话框'}));
    fireEvent(dialog,new Event('cancel',{cancelable:true}));
    expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(trigger);
    expect(api.testConnection).not.toHaveBeenCalled();expect(api.detectTools).not.toHaveBeenCalled();expect(api.remove).not.toHaveBeenCalled();
  });
  it('reveals an empty credential editor only on demand and guards discarding a replacement',async()=>{
    const api=fixture([profile]);const user=await open();
    const password=screen.getByLabelText('API Key') as HTMLInputElement;
    expect(password.closest('[hidden]')).not.toBeNull();expect(password.value).toBe('');
    expect(screen.queryByRole('button',{name:'保存配置'})).toBeNull();
    await user.click(screen.getByRole('button',{name:'更换密钥'}));expect(document.activeElement).toBe(password);
    expect(screen.queryByRole('button',{name:'保存配置'})).toBeNull();
    await user.type(password,'fixture-replacement-key');
    expect((screen.getByRole('button',{name:'移除已保存密钥'}) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button',{name:'放弃修改'}));await user.click(screen.getByRole('button',{name:'继续编辑'}));
    expect(password.value).toBe('fixture-replacement-key');
    await user.click(screen.getByRole('button',{name:'放弃修改'}));await user.click(screen.getByRole('button',{name:'放弃修改并继续'}));
    expect(password.value).toBe('');expect(screen.getByLabelText('API Key').closest('[hidden]')).not.toBeNull();
    expect(api.save).not.toHaveBeenCalled();expect(api.remove).not.toHaveBeenCalled();
  });
  it('removes a credential only through the existing save contract',async()=>{
    const api=fixture([profile]);const user=await open();
    await user.click(screen.getByRole('button',{name:'更换密钥'}));
    await user.click(screen.getByRole('button',{name:'移除已保存密钥'}));
    expect(screen.getByText('保存后移除密钥并停用配置')).toBeTruthy();expect(api.save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button',{name:'保存配置'}));
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({id:profile.id,expectedRevision:1,key:{action:'remove'}}));
    expect(api.testConnection).not.toHaveBeenCalled();expect(api.remove).not.toHaveBeenCalled();
    expect((screen.getByRole('checkbox',{name:'启用此配置'}) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByLabelText('API Key').closest('[hidden]')).toBeNull();
  });
  it('separates the edited profile from the model selected by the workbench',async()=>{
    const second={...profile,id:'00000000-0000-4000-8000-000000000002',name:'另一个配置'};
    const api=fixture([profile,second],profile.id);const user=await open();
    await user.click(screen.getByRole('button',{name:'编辑 另一个配置'}));
    expect(screen.getByRole('button',{name:'编辑 另一个配置'}).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button',{name:'编辑 示例模型'}).getAttribute('aria-pressed')).toBe('false');
    expect(within(screen.getByRole('button',{name:'编辑 示例模型'})).getByText('工作台使用中')).toBeTruthy();
    expect(screen.getByText('工作台模型').parentElement?.textContent).toContain('示例模型');
    expect((screen.getByLabelText('配置名称') as HTMLInputElement).value).toBe('另一个配置');
    expect(api.select).not.toHaveBeenCalled();expect(api.save).not.toHaveBeenCalled();
  });
  it('keeps independent historical tool uncertainty and connection success with their checked time',async()=>{
    const snapshot=passedSnapshot({id:profile.id,revision:1,requestId:crypto.randomUUID(),consent:{origin:'https://provider.example',accepted:true}});
    const p={...snapshot.profiles[0]!,tools:{...snapshot.profiles[0]!.connection!,outcome:'unknown' as const,code:'TIMEOUT' as const}};
    fixture([p]);await open();
    expect(screen.getByText(/工具能力未知/)).toBeTruthy();expect(screen.getByText(/检测超时/)).toBeTruthy();
    expect(screen.getAllByText(/上次检测通过/).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('time[datetime="2026-10-27T00:00:00.000Z"]')).toHaveLength(2);
    expect((screen.getByRole('button',{name:'设为工作台模型'}) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText('当前协议不支持工具调用')).toBeNull();
  });
  it('blocks probing unsaved endpoints and restores readiness only from the saved snapshot',async()=>{
    const api=fixture([profile]);const user=await open();
    await user.clear(screen.getByLabelText('Base URL'));await user.type(screen.getByLabelText('Base URL'),'https://other.example/v1');
    expect((screen.getByRole('button',{name:'测试连接'}) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button',{name:'测试连接'}));
    expect(screen.queryByRole('dialog')).toBeNull();expect(api.testConnection).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button',{name:'放弃修改'}));await user.click(screen.getByRole('button',{name:'放弃修改并继续'}));
    await user.click(screen.getByRole('button',{name:'测试连接'}));
    expect(screen.getByRole('dialog').textContent).toContain('https://provider.example');
    expect(screen.getByRole('dialog').textContent).not.toContain('https://other.example');
    expect(api.testConnection).not.toHaveBeenCalled();
  });

});
