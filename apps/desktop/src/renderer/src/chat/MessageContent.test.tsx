// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageContent } from './MessageContent';
import { CopyButton } from './CopyButton';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('bounded, inert message formatting', () => {
  it('formats paragraphs, line breaks, headings, flat lists, strong text and inline code', () => {
    render(<MessageContent text={'# 要点\n\n第一行\n第二行 **重点** 和 `value`。\n\n- 项目甲\n- 项目乙\n\n3. 步骤三\n4. 步骤四'} />);
    expect(screen.getByRole('heading', { name: '要点', level: 2 })).toBeTruthy();
    expect(document.querySelector('strong')?.textContent).toBe('重点');
    expect(document.querySelector('p')?.textContent).toContain('第一行\n第二行');
    expect(screen.getByText('value').tagName).toBe('CODE');
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(document.querySelector('ol')?.start).toBe(3);
  });

  it('keeps HTML, links, images, autolinks and unsupported constructs literal and inert', () => {
    const text = '<script>alert(1)</script>\n\n<img src="https://private.example/x">\n\n![图](https://private.example/x) [点此](javascript:alert(1))\n\n<https://private.example> https://private.example\n\n> 引用\n\n| 表 | 格 |';
    const { container } = render(<MessageContent text={text} />);
    expect(container.querySelector('script,img,a,iframe,video,style')).toBeNull();
    expect(container.textContent).toContain('<img src=');
    expect(container.textContent).toContain('javascript:alert(1)');
    expect(container.textContent).toContain('> 引用');
  });

  it('renders fenced code as text with an independent focusable scroll area', () => {
    render(<MessageContent text={'```tsx\n<img src="remote">\nconst 中文 = "😀";\n```'} />);
    expect(screen.getByRole('region', { name: '代码块，可横向滚动' }).tagName).toBe('PRE');
    expect(screen.getByRole('region', { name: '代码块，可横向滚动' }).tabIndex).toBe(0);
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('pre code')?.textContent).toBe('<img src="remote">\nconst 中文 = "😀";');
  });

  it('handles CRLF, longer/tilde fences and incomplete streaming fences without discarding text', () => {
    const { rerender } = render(<MessageContent text={'~~~~js\r\n```\r\nline\r\n~~~~'} />);
    expect(document.querySelector('pre code')?.textContent).toBe('```\nline');
    rerender(<MessageContent text={'````ts\n```\n正在到达的代码😀'} />);
    expect(document.querySelector('pre code')?.textContent).toBe('```\n正在到达的代码😀');
    rerender(<MessageContent text={'````ts\n```\n正在到达的代码😀\n````\n\n完成'} />);
    expect(screen.getByText('完成')).toBeTruthy();
  });

  it('does not interpret inline HTML or Markdown inside code and handles a bounded long response', () => {
    const { container } = render(<MessageContent text={'```text\n**不是粗体**\n<a href="javascript:x">文本</a>\n```\n\n' + '中😀'.repeat(5000)} />);
    expect(container.querySelector('strong,a')).toBeNull();
    expect(container.textContent).toContain('**不是粗体**');
    expect(container.textContent).toContain('中😀'.repeat(5000));
  });
});

describe('explicit write-only clipboard actions', () => {
  function clipboard(writeText: ReturnType<typeof vi.fn>) {
    const readText = vi.fn();
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText, readText } as unknown as Clipboard);
    return readText;
  }
  it('writes only after a user click and copies the exact fence-free code', async () => {
    const user = userEvent.setup(), writeText = vi.fn().mockResolvedValue(undefined);
    const readText = clipboard(writeText);
    render(<MessageContent text={'```ts\nconst greeting = "你好😀";\n```'} />);
    expect(writeText).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '复制代码' }));
    expect(writeText).toHaveBeenCalledExactlyOnceWith('const greeting = "你好😀";');
    expect(screen.getByRole('button', { name: '已复制代码' })).toBeTruthy();
    expect(readText).not.toHaveBeenCalled();
  });

  it('copies the whole original answer and does not reuse success for changed text', async () => {
    const user = userEvent.setup(), writeText = vi.fn().mockResolvedValue(undefined);clipboard(writeText);
    const { rerender } = render(<CopyButton text={'## 原文\n**重点**'} label="回答" />);
    await user.click(screen.getByRole('button', { name: '复制回答' }));
    expect(writeText).toHaveBeenCalledExactlyOnceWith('## 原文\n**重点**');
    rerender(<CopyButton text="新内容" label="回答" />);
    expect(screen.getByRole('button', { name: '复制回答' })).toBeTruthy();
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('offers manual selection on permission denial, never claims success or expands permission', async () => {
    const user = userEvent.setup(), writeText = vi.fn().mockRejectedValue(new Error('private OS failure'));const readText = clipboard(writeText);
    render(<CopyButton text={'不能丢失的原文\n😀'} label="回答" />);
    const trigger = screen.getByRole('button', { name: '复制回答' });await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '手动复制文本' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '关闭' }));
    expect(screen.queryByText('private OS failure')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: '选中文本' }));
    const text = within(dialog).getByRole<HTMLTextAreaElement>('textbox', { name: '待复制文本' });
    expect(text.value).toBe('不能丢失的原文\n😀');expect(document.activeElement).toBe(text);
    expect(text.selectionStart).toBe(0);expect(text.selectionEnd).toBe(text.value.length);
    fireEvent(dialog, new Event('cancel', { cancelable: true }));expect(document.activeElement).toBe(trigger);
    expect(writeText).toHaveBeenCalledTimes(1);expect(readText).not.toHaveBeenCalled();
  });

  it('offers manual copy when the browser API is unavailable', async () => {
    const user = userEvent.setup();vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(undefined as unknown as Clipboard);
    render(<CopyButton text="原文" label="回答" />);await user.click(screen.getByRole('button', { name: '复制回答' }));
    expect(screen.getByRole('dialog', { name: '手动复制文本' })).toBeTruthy();
  });

  it('keeps a pending write separate from success or manual fallback', async () => {
    const user = userEvent.setup();
    let complete!: () => void;
    const writeText = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
    const readText = clipboard(writeText);
    render(<CopyButton text="完整的虚构回答" label="回答" />);
    await user.click(screen.getByRole('button', { name: '复制回答' }));
    expect(screen.getByText('正在复制…')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '复制回答' }).disabled).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(writeText).toHaveBeenCalledExactlyOnceWith('完整的虚构回答');
    await act(async () => complete());
    expect(screen.getByRole('button', { name: '已复制回答' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(readText).not.toHaveBeenCalled();
  });

  it.each(['NotAllowedError', 'SecurityError'])('reports a denied write without blaming macOS or exposing raw errors: %s', async name => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new DOMException('private host details', name));
    clipboard(writeText);
    render(<CopyButton text="虚构文本" label="回答" />);
    await user.click(screen.getByRole('button', { name: '复制回答' }));
    expect(screen.getByText(/剪贴板写入被应用或系统拒绝/)).toBeTruthy();
    expect(screen.queryByText(/private host details/)).toBeNull();
    expect(screen.queryByRole('button', { name: '已复制回答' })).toBeNull();
  });

  it('distinguishes an unavailable API from a synchronous write failure', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(undefined as unknown as Clipboard);
    const view = render(<CopyButton text="虚构文本" label="回答" />);
    await user.click(screen.getByRole('button', { name: '复制回答' }));
    expect(screen.getByText(/当前环境不支持直接复制/)).toBeTruthy();
    view.unmount();
    clipboard(vi.fn(() => { throw Error('private detail'); }));
    render(<CopyButton text="虚构文本" label="回答" />);
    await user.click(screen.getByRole('button', { name: '复制回答' }));
    expect(screen.getByText(/剪贴板写入未成功/)).toBeTruthy();
    expect(screen.queryByText(/private detail/)).toBeNull();
  });


  it('does not retain an earlier success label when the next explicit copy fails', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new DOMException('Mock denied', 'NotAllowedError'));
    clipboard(writeText);
    render(<CopyButton text="虚构回答" label="回答" />);
    await user.click(screen.getByRole('button', { name: '复制回答' }));
    await user.click(screen.getByRole('button', { name: '已复制回答' }));
    expect(screen.getByRole('dialog', { name: '手动复制文本' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '已复制回答' })).toBeNull();
    expect(writeText).toHaveBeenCalledTimes(2);
  });

});
