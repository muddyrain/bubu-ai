import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import styles from './WelcomeContent.module.css';

const examples: { title: string; text: string; icon: IconName }[] = [
  { title: '整理一段思路', text: '帮我把一段零散的想法整理清楚。', icon: 'edit' },
  { title: '解释一段代码', text: '用一个简单的例子解释 async 和 await。', icon: 'document' },
  { title: '写一封清晰的邮件', text: '帮我写一封简洁自然的沟通邮件。', icon: 'message' },
];

export function WelcomeContent({ ready, loading, failed, onOpenSettings, onPrompt }: {
  ready: boolean; loading: boolean; failed: boolean; onOpenSettings: () => void; onPrompt: (text: string) => void;
}) {
  return <div className={styles.content}>
    <p className={styles.intro}>Bubu AI · 让思路慢慢清晰</p>
    <h2>今天想聊些什么？</h2>
    <p className={styles.description}>写作、理解、推敲想法。先从你最在意的那件事开始。</p>
    {loading ? <p className={styles.setup} role="status">正在读取模型配置…</p> : ready ? <ul className={styles.examples} aria-label="对话建议">
      {examples.map(example => <li key={example.title}><button type="button" onClick={() => onPrompt(example.text)}>
        <Icon name={example.icon} />{example.title}
      </button></li>)}
    </ul> : failed ? <p className={styles.setup} role="status">暂时无法确认模型配置，请在设置中重新读取。</p> : <div className={styles.setup}>
      <p>还没有选中可用模型，先在设置中配置、验证并选择。</p>
      <button type="button" onClick={onOpenSettings}>添加模型</button>
    </div>}
  </div>;
}
