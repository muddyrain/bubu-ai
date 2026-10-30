// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { chatMock } from './test-helpers';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
async function fixture() {
  const mock = chatMock();
  const ids: string[] = [];
  for (const title of ['会话甲', '会话乙', '会话丙']) {
    const result = await mock.api.create();
    if (!result.ok) throw Error('Mock fixture failed');
    ids.push(result.value.conversation.id);
    mock.data.get(result.value.conversation.id)!.conversation.title = title;
  }
  const p = mock.profile();
  vi.stubGlobal('bubu', { app: { getVersion: async () => '0.1.0' }, chat: mock.api,
    providers: { list: async () => ({ ok: true, value: { profiles: [p], selectedProfileId: p.id, cleanupPending: false } }) } });
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(screen.getByRole('button', { name: '打开会话 会话甲' }).getAttribute('aria-current')).toBe('true'));
  const original = mock.api.subscribe.getMockImplementation()!;
  const pending: ReturnType<typeof deferred>[] = [];
  mock.api.subscribe.mockImplementation(async (...args) => {
    const result = await original(...args), gate = deferred();
    pending.push(gate);
    await gate.promise;
    return result;
  });
  const open = (title: string) => screen.getByRole('button', { name: '打开会话 ' + title });
  return { mock, ids, user, open, pending };
}

describe('session navigation keeps the populated list stable', () => {
  it('retains list/row DOM and its loading footprint through consecutive delayed switches', async () => {
    const f = await fixture();
    const list = screen.getByRole('region', { name: '本地会话' });
    const row = f.open('会话乙');
    for (const [index, title] of ['会话乙', '会话丙', '会话甲'].entries()) {
      await f.user.click(f.open(title));
      await waitFor(() => expect(f.pending).toHaveLength(index + 1));
      expect(screen.queryByText('正在读取会话…')).toBeNull();
      expect(screen.getByRole('region', { name: '本地会话' })).toBe(list);
      expect(f.open('会话乙')).toBe(row);
      await act(async () => f.pending[index]!.resolve());
      await waitFor(() => expect(f.open(title).getAttribute('aria-current')).toBe('true'));
    }
    expect(f.mock.api.send).not.toHaveBeenCalled();
    expect(f.mock.api.cancel).not.toHaveBeenCalled();
  });

  it('does not select a delayed destination early or accept its stale receipt after a faster switch', async () => {
    const f = await fixture();
    await f.user.click(f.open('会话乙'));
    await waitFor(() => expect(f.pending).toHaveLength(1));
    expect(f.open('会话甲').getAttribute('aria-current')).toBe('true');
    await f.user.click(f.open('会话丙'));
    await waitFor(() => expect(f.pending).toHaveLength(2));
    expect(screen.queryByText('正在读取会话…')).toBeNull();
    await act(async () => f.pending[1]!.resolve());
    await waitFor(() => expect(f.open('会话丙').getAttribute('aria-current')).toBe('true'));
    await act(async () => f.pending[0]!.resolve());
    expect(f.open('会话丙').getAttribute('aria-current')).toBe('true');
    expect(f.open('会话乙').getAttribute('aria-current')).toBeNull();
    expect(f.mock.api.send).not.toHaveBeenCalled();
  });

  it('preserves pointer/keyboard target while loading and restores the existing Composer focus on success', async () => {
    const f = await fixture(), button = f.open('会话乙');
    button.focus();
    await f.user.keyboard('{Enter}');
    await waitFor(() => expect(f.pending).toHaveLength(1));
    expect(document.activeElement).toBe(button);
    expect(button.isConnected).toBe(true);
    expect(screen.queryByText('正在读取会话…')).toBeNull();
    await act(async () => f.pending[0]!.resolve());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '消息输入' })));
  });

  it('retains the initial loading message until the first session list is actually read', async () => {
    const mock = chatMock(), gate = deferred(), original = mock.api.list.getMockImplementation()!;
    mock.api.list.mockImplementation(async () => { await gate.promise; return original(); });
    vi.stubGlobal('bubu', { app: { getVersion: async () => '0.1.0' }, chat: mock.api,
      providers: { list: async () => ({ ok: true, value: { profiles: [], selectedProfileId: null, cleanupPending: false } }) } });
    render(<App />);
    expect(await screen.findByText('正在读取会话…')).toBeTruthy();
    await act(async () => gate.resolve());
    await waitFor(() => expect(screen.queryByText('正在读取会话…')).toBeNull());
    expect(screen.getByText('暂无会话')).toBeTruthy();
  });

  it('requires confirmation before stopping generation and delays navigation until the real Mock terminal', async () => {
    const f = await fixture();
    await f.user.type(screen.getByRole('textbox', { name: '消息输入' }), '一条虚构问题');
    await f.user.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(f.mock.api.send).toHaveBeenCalledOnce());
    const button = f.open('会话乙');
    await f.user.click(button);
    expect(screen.getByRole('dialog', { name: '停止回复并继续？' })).toBeTruthy();
    expect(f.pending).toHaveLength(0);
    expect(f.mock.api.cancel).not.toHaveBeenCalled();
    await f.user.click(screen.getByRole('button', { name: '停止并继续' }));
    await waitFor(() => expect(f.pending).toHaveLength(1));
    expect(f.mock.api.cancel).toHaveBeenCalledOnce();
    expect(screen.queryByText('正在读取会话…')).toBeNull();
    expect(button.isConnected).toBe(true);
    await act(async () => f.pending[0]!.resolve());
    await waitFor(() => expect(button.getAttribute('aria-current')).toBe('true'));
    expect(f.mock.api.send).toHaveBeenCalledOnce();
  });
});
