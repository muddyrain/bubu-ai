import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { ModalDialog } from '../components/ModalDialog';
import styles from './Chat.module.css';

type CopyFailure = 'unavailable' | 'denied' | 'failed';
const failureText: Record<CopyFailure, string> = {
  unavailable: '当前环境不支持直接复制。',
  denied: '剪贴板写入被应用或系统拒绝。',
  failed: '剪贴板写入未成功。',
};

export function CopyButton({ text, label }: { text: string; label: '回答' | '代码' }) {
  const [copied, setCopied] = useState<string>();
  const [manual, setManual] = useState<{ text: string; trigger: HTMLElement; reason: CopyFailure }>();
  const [writing, setWriting] = useState(false);
  const selection = useRef<HTMLTextAreaElement>(null);
  const active = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function copy(trigger: HTMLElement) {
    if (writing) return;
    setWriting(true);
    setCopied(undefined);
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') {
        if (active.current) setManual({ text, trigger, reason: 'unavailable' });
        return;
      }
      // Invoked synchronously from a deliberate click. Never read the clipboard.
      await navigator.clipboard.writeText(text);
      if (active.current) setCopied(text);
    } catch (error) {
      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      if (active.current) setManual({ text, trigger, reason: denied ? 'denied' : 'failed' });
    } finally { if (active.current) setWriting(false); }
  }
  const done = copied === text;
  return <>
    <button type="button" className={styles.copyButton} disabled={writing}
      aria-label={done ? `已复制${label}` : `复制${label}`} onClick={event => { void copy(event.currentTarget); }}>
      <Icon name={done ? 'check' : 'copy'} /><span aria-live="polite">{done ? '已复制' : writing ? '正在复制…' : `复制${label === '代码' ? '代码' : ''}`}</span>
    </button>
    {manual !== undefined && <ModalDialog title="手动复制文本"
      description={`${failureText[manual.reason]}选中文本后按 ⌘C 或 Ctrl+C 复制；应用不会读取剪贴板。`}
      restoreFocus={manual.trigger} cancelLabel="关闭" confirmLabel="选中文本" confirmEmphasis="secondary"
      onClose={() => setManual(undefined)} onConfirm={() => { selection.current?.focus(); selection.current?.select(); }}>
      <textarea ref={selection} className={styles.manualCopy} aria-label="待复制文本" readOnly value={manual.text} />
    </ModalDialog>}
  </>;
}
