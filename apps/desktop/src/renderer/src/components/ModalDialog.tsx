import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Icon } from './Icon';
import styles from './ModalDialog.module.css';

interface Props {
  title: string;
  description: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  confirmEmphasis?: 'primary' | 'danger' | 'secondary';
  restoreFocus?: HTMLElement | null;
  onConfirm: () => void;
  onClose: () => void;
}

export function ModalDialog({ title, description, children, confirmLabel, cancelLabel = '取消',
  confirmEmphasis = 'primary', restoreFocus, onConfirm, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = restoreFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const native = typeof dialog.showModal === 'function';
    if (native) dialog.showModal();
    else dialog.setAttribute('open', ''); // jsdom has no top layer; production always uses showModal().
    cancelRef.current?.focus();
    return () => {
      const shouldRestore = document.activeElement === document.body || dialog.contains(document.activeElement);
      if (native && dialog.open) dialog.close();
      else dialog.removeAttribute('open');
      if (shouldRestore && trigger?.isConnected) trigger.focus();
    };
  }, [restoreFocus]);
  function constrainFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    )].filter((node) => !node.closest('[hidden]'));
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  const cancel = <button ref={cancelRef} type="button" className={`${styles.button} ${confirmEmphasis === 'secondary' ? styles.primary : ''}`} onClick={onClose}>{cancelLabel}</button>;
  const confirm = <button type="button" className={`${styles.button} ${confirmEmphasis === 'secondary' ? '' : confirmEmphasis === 'danger' ? styles.danger : styles.primary}`} onClick={onConfirm}>{confirmLabel}</button>;
  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); onClose(); }} onKeyDown={constrainFocus}>
      <div className={styles.body}>
        <div className={styles.heading}><h2 id={titleId}>{title}</h2>
          <button type="button" className={styles.close} aria-label="关闭对话框" onClick={onClose}><Icon name="close" /></button>
        </div>
        <p id={descriptionId} className={styles.description}>{description}</p>
        {children}
      </div>
      <div className={styles.actions}>{confirmEmphasis === 'secondary' ? <>{confirm}{cancel}</> : <>{cancel}{confirm}</>}</div>
    </dialog>
  );
}
