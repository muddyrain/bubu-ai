// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { chatMock } from './chat/test-helpers';
import type { ProviderResult, ProviderSnapshot } from '../../shared/providers';

const getVersion = vi.fn<() => Promise<string>>();
function bridge(ready = false) {
  const mock = chatMock(), p = mock.profile();
  const providers = { list: vi.fn<() => Promise<ProviderResult<ProviderSnapshot>>>(async () => ({ ok: true, value: { profiles: ready ? [p] : [], selectedProfileId: ready ? p.id : null, cleanupPending: false } })) };
  vi.stubGlobal('bubu', { app: { getVersion }, chat: mock.api, providers });
  return { mock, p, providers };
}
beforeEach(() => { getVersion.mockReset().mockResolvedValue('0.1.0'); bridge(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function renderWorkbench() { const result = render(<App />); await screen.findByText('应用版本 0.1.0'); return result; }

describe('conversation-first Workbench shell', () => {
  it.each([true,false])('does not infer an empty Provider configuration before the first list resolves: ready=%s', async ready => {
    const f=bridge(ready),user=userEvent.setup();
    type Result=Awaited<ReturnType<typeof f.providers.list>>;
    let resolve!:(value:Result)=>void;
    const original=f.providers.list.getMockImplementation()!;
    f.providers.list.mockImplementationOnce(()=>new Promise<Result>(r=>{resolve=r;}));
    await renderWorkbench();
    expect(screen.getAllByText('正在读取模型配置…').length).toBeGreaterThan(0);
    expect(screen.queryByText('未配置模型')).toBeNull();
    expect(screen.queryByRole('button',{name:'添加模型'})).toBeNull();
    expect(screen.queryByText('还没有选中可用模型，先在设置中配置、验证并选择。')).toBeNull();
    expect(screen.queryByRole('list',{name:'对话建议'})).toBeNull();
    await user.click(screen.getByRole('button',{name:'展开面板'}));
    expect(screen.queryByRole('button',{name:'添加模型'})).toBeNull();
    expect(within(screen.getByRole('complementary',{name:'对话信息'})).getByText('正在读取模型配置…')).toBeTruthy();
    await act(async()=>resolve(await original()));
    expect(screen.queryByText('正在读取模型配置…')).toBeNull();
    if(ready){expect(screen.getByRole('list',{name:'对话建议'})).toBeTruthy();expect(screen.queryByRole('button',{name:'添加模型'})).toBeNull();}
    else expect(within(screen.getByRole('region',{name:'欢迎内容'})).getByRole('button',{name:'添加模型'})).toBeTruthy();
    expect(f.providers.list).toHaveBeenCalledOnce();expect(f.mock.api.prepareSend).not.toHaveBeenCalled();expect(f.mock.api.send).not.toHaveBeenCalled();
  });

  it('keeps existing conversation history visible while the first Provider list is pending',async()=>{
    const f=bridge(true),created=await f.mock.api.create();if(!created.ok)throw Error();
    const snapshot=f.mock.data.get(created.value.conversation.id)!;snapshot.conversation.title='已保存的会话';
    const now=new Date().toISOString();snapshot.conversation.messages.push({id:crypto.randomUUID(),requestId:crypto.randomUUID(),runId:crypto.randomUUID(),role:'user',text:'保留已有历史，不用等待模型配置',status:'completed',seq:0,createdAt:now,updatedAt:now,
      recipient:{providerId:f.p.id,revision:1,name:f.p.name,baseUrl:f.p.baseUrl,origin:new URL(f.p.baseUrl).origin,modelId:f.p.modelId}});
    type Result=Awaited<ReturnType<typeof f.providers.list>>;let resolve!:(value:Result)=>void;const original=f.providers.list.getMockImplementation()!;
    f.providers.list.mockImplementationOnce(()=>new Promise<Result>(r=>{resolve=r;}));await renderWorkbench();
    expect(await screen.findByText('保留已有历史，不用等待模型配置')).toBeTruthy();
    expect(screen.queryByRole('region',{name:'欢迎内容'})).toBeNull();expect(screen.queryByRole('button',{name:'添加模型'})).toBeNull();
    expect(screen.getAllByText('正在读取模型配置…').length).toBeGreaterThan(0);
    await act(async()=>resolve(await original()));
    expect(screen.getByText('保留已有历史，不用等待模型配置')).toBeTruthy();expect(f.mock.api.subscribe).toHaveBeenCalledOnce();
    expect(f.mock.api.prepareSend).not.toHaveBeenCalled();expect(f.mock.api.send).not.toHaveBeenCalled();
  });

  it.each(['selected','empty','unselected'].flatMap(next=>['result','rejection'].map(failure=>({next,failure}))))('retains unknown configuration after dismissing a first-list $failure, then refreshes to $next',async({next,failure})=>{
    const f=bridge(),user=userEvent.setup();type Result=ProviderResult<ProviderSnapshot>;
    let resolve!:(value:Result)=>void,reject!:(reason:unknown)=>void,refresh!:(value:Result)=>void;
    f.providers.list.mockImplementationOnce(()=>new Promise<Result>((yes,no)=>{resolve=yes;reject=no;}))
      .mockImplementationOnce(()=>new Promise<Result>(yes=>{refresh=yes;}));await renderWorkbench();
    await act(async()=>{if(failure==='rejection')reject(new Error('private Provider failure'));else resolve({ok:false,error:{code:'STORE_FAILED'}});});
    await waitFor(()=>expect(screen.queryByText('正在读取模型配置…')).toBeNull());
    expect(screen.queryByRole('button',{name:'添加模型'})).toBeNull();expect(screen.queryByText('未配置模型')).toBeNull();
    expect(screen.queryByText('private Provider failure')).toBeNull();expect(screen.getByRole('alert')).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'关闭模型错误'}));expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button',{name:'添加模型'})).toBeNull();expect(screen.queryByText('未配置模型')).toBeNull();
    await user.click(screen.getByRole('button',{name:'展开面板'}));
    expect(screen.queryByRole('button',{name:'添加模型'})).toBeNull();
    const unknownWelcome=screen.getByRole('region',{name:'欢迎内容'}),unknownPanel=screen.getByRole('complementary',{name:'对话信息'});
    expect(within(unknownWelcome).getByText(/模型配置/)).toBeTruthy();expect(within(unknownPanel).getByText('模型配置暂不可用。')).toBeTruthy();
    expect(f.providers.list).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button',{name:'设置'}));expect(f.providers.list).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button',{name:'返回工作台'}));
    expect(screen.queryByRole('button',{name:'添加模型'})).toBeNull();
    await act(async()=>refresh({ok:true,value:{profiles:next==='empty'?[]:[f.p],selectedProfileId:next==='selected'?f.p.id:null,cleanupPending:false}}));
    const welcome=screen.getByRole('region',{name:'欢迎内容'}),panel=screen.getByRole('complementary',{name:'对话信息'});
    expect(within(panel).queryByText('模型配置暂不可用。')).toBeNull();
    if(next==='selected'){
      expect(within(welcome).getByRole('list',{name:'对话建议'})).toBeTruthy();expect(within(panel).getByText(f.p.name)).toBeTruthy();
      expect(screen.getByText('当前模型：'+f.p.name)).toBeTruthy();expect(screen.queryByRole('button',{name:'添加模型'})).toBeNull();
    }else{
      expect(within(welcome).getByRole('button',{name:'添加模型'})).toBeTruthy();expect(within(panel).getByRole('button',{name:'添加模型'})).toBeTruthy();
      expect(screen.getByText(next==='empty'?'未配置模型':'已保存配置 · 未选择模型')).toBeTruthy();
    }
    expect(f.providers.list).toHaveBeenCalledTimes(2);expect(f.mock.api.prepareSend).not.toHaveBeenCalled();expect(f.mock.api.send).not.toHaveBeenCalled();
  });
  it('starts without a permanent inspector or unrelated onboarding, and gives one unconfigured CTA', async () => {
    await renderWorkbench();
    expect(screen.getByRole('banner', { name: '应用信息' }).textContent).toContain('Bubu AI');
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeTruthy();
    expect(screen.getByRole('main', { name: '欢迎使用' })).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: '对话信息' })).toBeNull();
    expect(screen.getByRole('button', { name: '展开面板' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByRole('button', { name: '添加模型' })).toHaveLength(1);
    expect(screen.getByText('暂无会话')).toBeTruthy();
    expect(screen.queryByText('三步开始使用')).toBeNull();
    expect(getVersion).toHaveBeenCalledExactlyOnceWith();
  });

  it('uses three text-chat suggestions as drafts, never automatic sends or file actions', async () => {
    const f = bridge(true), user = userEvent.setup(); await renderWorkbench();
    const suggestions = screen.getByRole('list', { name: '对话建议' });
    expect(within(suggestions).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: '添加模型' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '整理一段思路' }));
    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '消息输入' });
    expect(input.value).toBe('帮我把一段零散的想法整理清楚。'); expect(document.activeElement).toBe(input);
    expect(f.mock.api.prepareSend).not.toHaveBeenCalled(); expect(f.mock.api.send).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '添加文件，后续开放' })).toBeNull();
    expect(screen.getByText('文件与任务功能后续开放。')).toBeTruthy();
  });

  it('retains the panel ID and returns focus from its close button to the persistent toggle', async () => {
    bridge(true); const user = userEvent.setup(); await renderWorkbench();
    const toggle = screen.getByRole('button', { name: '展开面板' }), id = toggle.getAttribute('aria-controls');
    if (!id) throw new Error('Missing panel control ID');
    const panel = document.getElementById(id); expect(panel?.hidden).toBe(true);
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('complementary', { name: '对话信息' })).toBe(panel);
    expect(within(panel!).getByText('尚无消息')).toBeTruthy();
    expect(within(panel!).getByText('已选择配置，不代表持续在线。')).toBeTruthy();
    expect(screen.queryByText('三步开始使用')).toBeNull();
    await user.click(screen.getByRole('button', { name: '收起对话信息' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false'); expect(toggle.getAttribute('aria-controls')).toBe(id);
    expect(panel?.hidden).toBe(true); expect(document.activeElement).toBe(toggle);
  });

  it('supports keyboard toggle and an always-discoverable recent-session dialog', async () => {
    bridge(true); const user = userEvent.setup(); await renderWorkbench();
    const toggle = screen.getByRole('button', { name: '展开面板' }); toggle.focus(); await user.keyboard('{Enter}');
    expect(toggle.getAttribute('aria-expanded')).toBe('true'); expect(document.activeElement).toBe(toggle);
    await user.keyboard(' '); expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const recent = screen.getByRole('button', { name: '最近会话' }); recent.focus(); await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: '本地会话' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '取消' })); expect(document.activeElement).toBe(recent);
  });

  it('shows the pending version and then the real bridge response', async () => {
    let resolve!: (value: string) => void; getVersion.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    render(<App />); expect(screen.getByText('版本读取中…')).toBeTruthy();
    await act(async () => resolve('0.1.7')); expect(screen.getByText('应用版本 0.1.7')).toBeTruthy();
  });

  it.each([true, false])('switches exclusive views and restores the user panel preference: %s', async open => {
    const user = userEvent.setup(); await renderWorkbench();
    if (open) await user.click(screen.getByRole('button', { name: '展开面板' }));
    await user.click(screen.getByRole('button', { name: '设置' }));
    expect(screen.getByRole('main', { name: '模型供应商' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '设置' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('region', { name: '消息输入区' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: '对话信息' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '工作台' }));
    expect(screen.getByRole('button', { name: open ? '收起面板' : '展开面板' }).getAttribute('aria-expanded')).toBe(String(open));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '工作台' }));
  });

  it('opens existing Settings from the welcome CTA and returns using its back button', async () => {
    const user = userEvent.setup(); await renderWorkbench();
    await user.click(screen.getByRole('button', { name: '添加模型' }));
    expect(screen.getByRole('main', { name: '模型供应商' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '返回工作台' }));
    expect(screen.getByRole('main', { name: '欢迎使用' })).toBeTruthy();
  });

  it('keeps the workbench usable on a failed version bridge without exposing exception details', async () => {
    getVersion.mockRejectedValueOnce(new Error('private detail')); render(<App />);
    await screen.findByText('版本暂不可用'); expect(screen.queryByText('private detail')).toBeNull();
    expect(screen.getByRole('button', { name: '新对话' })).toBeTruthy();
  });
});
