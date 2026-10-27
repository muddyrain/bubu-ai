// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const getVersion = vi.fn<() => Promise<string>>();

beforeEach(() => {
  getVersion.mockReset().mockResolvedValue('0.1.0');
  vi.stubGlobal('bubu', { app: { getVersion } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderWorkbench() {
  const result = render(<App />);
  await screen.findByText('应用版本 0.1.0');
  return result;
}

describe('Workbench welcome shell', () => {
  it('renders the named work areas and honest unconfigured state', async () => {
    await renderWorkbench();
    expect(screen.getByRole('banner', { name: '应用信息' }).textContent).toContain('Bubu AI');
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeTruthy();
    expect(screen.getByRole('main', { name: '欢迎使用' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: '开始使用' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '消息输入区' })).toBeTruthy();
    expect(screen.getByText('暂无会话')).toBeTruthy();
    expect(screen.getByText('未授权本地目录。目录授权后续开放。')).toBeTruthy();
    expect(screen.getAllByText('暂无模型连接').length).toBeGreaterThan(0);
    expect(getVersion).toHaveBeenCalledExactlyOnceWith();
  });

  it('keeps all three examples informational and all unavailable actions disabled', async () => {
    const user = userEvent.setup();
    await renderWorkbench();
    const examples = screen.getByRole('region', { name: '未来可以这样使用' });
    expect(within(examples).getAllByRole('listitem')).toHaveLength(3);
    expect(within(examples).queryByRole('button')).toBeNull();
    expect(within(examples).getAllByText('后续开放')).toHaveLength(3);
    const toggle = screen.getByRole('button', { name: '收起面板' });
    for (const button of screen.getAllByRole<HTMLButtonElement>('button')) {
      expect(button.disabled).toBe(button !== toggle);
    }
    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '消息输入' });
    expect(input.disabled).toBe(true);
    await user.type(input, '不要执行任何任务');
    await user.click(screen.getByRole('button', { name: '发送消息，后续开放' }));
    await user.click(screen.getByRole('button', { name: '文件空间，后续开放' }));
    expect(input.value).toBe('');
    expect(screen.getByRole('main', { name: '欢迎使用' })).toBeTruthy();
    expect(getVersion).toHaveBeenCalledTimes(1);
  });

  it('collapses and restores the same panel, keeping its control ID and button focus', async () => {
    const user = userEvent.setup();
    await renderWorkbench();
    const toggle = screen.getByRole('button', { name: '收起面板' });
    const panelId = toggle.getAttribute('aria-controls');
    if (!panelId) throw new Error('Missing panel control ID');
    const panel = document.getElementById(panelId);
    expect(panel).toBe(screen.getByRole('complementary', { name: '开始使用' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(panelId);
    expect(panel?.hidden).toBe(true);
    expect(screen.queryByRole('complementary', { name: '开始使用' })).toBeNull();
    expect(document.activeElement).toBe(toggle);

    await user.click(screen.getByRole('button', { name: '展开面板' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(panel?.hidden).toBe(false);
    expect(screen.getByRole('complementary', { name: '开始使用' })).toBe(panel);
    expect(document.activeElement).toBe(toggle);
  });

  it('supports Tab, Enter and Space while excluding the collapsed panel from Tab order', async () => {
    const user = userEvent.setup();
    await renderWorkbench();
    const toggle = screen.getByRole('button', { name: '收起面板' });
    await user.tab();
    expect(document.activeElement).toBe(toggle);
    await user.keyboard('{Enter}');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('region', { name: '欢迎内容' }));
    await user.tab();
    expect(document.activeElement).toBe(document.body);
    await user.tab();
    expect(document.activeElement).toBe(toggle);
    await user.keyboard(' ');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(toggle);
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('region', { name: '首次配置内容' }));
  });

  it('shows the pending state and then the version returned by the bridge', async () => {
    let resolveVersion: (version: string) => void = () => { throw new Error('Version promise is not initialized'); };
    getVersion.mockReturnValueOnce(new Promise<string>((resolve) => { resolveVersion = resolve; }));
    render(<App />);
    expect(screen.getByRole('status').textContent).toBe('版本读取中…');
    await act(async () => { resolveVersion('2.3.4'); });
    expect(screen.getByRole('status').textContent).toBe('应用版本 2.3.4');
  });

  it('keeps the workbench usable if the version bridge rejects without exposing error details', async () => {
    const user = userEvent.setup();
    getVersion.mockRejectedValueOnce(new Error('private bridge detail'));
    render(<App />);
    await screen.findByText('版本暂不可用');
    expect(screen.queryByText(/private bridge detail/)).toBeNull();
    await user.click(screen.getByRole('button', { name: '收起面板' }));
    expect(screen.getByRole('button', { name: '展开面板' })).toBeTruthy();
    expect(screen.getByRole('main', { name: '欢迎使用' })).toBeTruthy();
  });
});
