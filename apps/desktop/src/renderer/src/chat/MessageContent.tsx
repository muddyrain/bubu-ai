import { Fragment, useMemo } from 'react';
import type { ReactNode } from 'react';
import { CopyButton } from './CopyButton';
import styles from './Chat.module.css';

type Block = { kind: 'paragraph' | 'heading'; text: string; level?: number } |
  { kind: 'code'; text: string; language: string } |
  { kind: 'list'; items: string[]; ordered: boolean; start: number };
const fence = (line: string) => /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
const heading = (line: string) => /^ {0,3}(#{1,6})[ \t]+(.+)$/.exec(line);
const listItem = (line: string) => /^ {0,3}([-+*]|\d{1,3}[.)])[ \t]+(.+)$/.exec(line);

// Intentionally limited formatting, not a full Markdown engine. No HTML, URL,
// image, plugin or renderer hooks. Model text is only ever React text nodes.
function blocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n'), result: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    const opening = fence(line);
    if (opening) {
      const marker = opening[1]!, info = opening[2]!.trim(), content: string[] = [];
      i++;
      while (i < lines.length) {
        const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(lines[i]!);
        if (closing?.[1] && closing[1][0] === marker[0] && closing[1].length >= marker.length) { i++; break; }
        content.push(lines[i++]!);
      }
      result.push({ kind: 'code', language: /^[\w.+#-]{1,32}$/.test(info) ? info : '代码', text: content.join('\n') });
      continue;
    }
    const title = heading(line);
    if (title) { result.push({ kind: 'heading', level: Math.max(2, title[1]!.length), text: title[2]! }); i++; continue; }
    const item = listItem(line);
    if (item) {
      const ordered = /^\d/.test(item[1]!), start = ordered ? Number.parseInt(item[1]!, 10) : 1, items: string[] = [];
      while (i < lines.length) {
        const next = listItem(lines[i]!);
        if (!next || /^\d/.test(next[1]!) !== ordered) break;
        items.push(next[2]!); i++;
      }
      result.push({ kind: 'list', items, ordered, start });
      continue;
    }
    const paragraph = [line]; i++;
    while (i < lines.length && lines[i]!.trim() && !fence(lines[i]!) && !heading(lines[i]!) && !listItem(lines[i]!)) paragraph.push(lines[i++]!);
    result.push({ kind: 'paragraph', text: paragraph.join('\n') });
  }
  return result;
}

function inline(text: string): ReactNode[] {
  const result: ReactNode[] = [];
  const pattern = /\*\*[^*\n]+\*\*|`[^`\n]+`/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    result.push(text.slice(cursor, match.index));
    const token = match[0];
    result.push(token.startsWith('**') ? <strong key={match.index}>{token.slice(2, -2)}</strong> : <code key={match.index}>{token.slice(1, -1)}</code>);
    cursor = match.index + token.length;
  }
  result.push(text.slice(cursor));
  return result;
}

export function MessageContent({ text }: { text: string }) {
  const content = useMemo(() => blocks(text), [text]);
  return <div className={styles.messageText}>{content.map((block, index) => {
    if (block.kind === 'code') return <section key={index} className={styles.codeBlock}>
      <header className={styles.codeHeader}><span>{block.language}</span><CopyButton text={block.text} label="代码" /></header>
      <pre role="region" aria-label="代码块，可横向滚动" tabIndex={0}><code>{block.text}</code></pre>
    </section>;
    if (block.kind === 'list') {
      const items = block.items.map((item, i) => <li key={i}>{inline(item)}</li>);
      return block.ordered ? <ol key={index} start={block.start}>{items}</ol> : <ul key={index}>{items}</ul>;
    }
    if (block.kind === 'heading') {
      const Tag = `h${block.level}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return <Tag key={index}>{inline(block.text)}</Tag>;
    }
    return <Fragment key={index}><p>{inline(block.text)}</p></Fragment>;
  })}</div>;
}
