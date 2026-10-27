import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import { MascotArtwork } from '../components/MascotArtwork';
import styles from './WelcomeContent.module.css';

const examples: { title: string; description: string; icon: IconName }[] = [
  { title: '整理下载文件夹', description: '按类型分类，先预览方案再执行', icon: 'folder' },
  { title: '找一份技术笔记', description: '在授权的目录中搜索文件', icon: 'search' },
  { title: '总结本地资料', description: '读取 Markdown 和文本内容', icon: 'document' },
];

function WelcomeHero() {
  return (
    <section className={styles.hero} aria-labelledby="welcome-title">
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}><Icon name="heart" />一二布布 · 陪伴式文件助理</p>
        <h2 id="welcome-title">你好呀，<br />我是 <span>布布 AI</span>！</h2>
        <p>找文件、读资料、整理文件夹。<br />从连接模型和授权目录开始。</p>
      </div>
      <div className={styles.artworkSlot}><MascotArtwork size="hero" /></div>
    </section>
  );
}

export function WelcomeContent() {
  return (
    <div className={styles.content}>
      <WelcomeHero />
      <section className={styles.examples} aria-labelledby="examples-title">
        <h3 id="examples-title">未来可以这样使用</h3>
        <ul className={styles.exampleList}>
          {examples.map(({ title, description, icon }) => (
            <li key={title} className={styles.example}>
              <span className={styles.exampleIcon}><Icon name={icon} /></span>
              <h4>{title}</h4>
              <p>{description}</p>
              <span className={styles.availability}>后续开放</span>
            </li>
          ))}
        </ul>
      </section>
      <p className={styles.privacyNote}><Icon name="shield" /><span>首次使用需要配置模型并授权目录。当前界面不会读取或修改本地文件。</span></p>
    </div>
  );
}
