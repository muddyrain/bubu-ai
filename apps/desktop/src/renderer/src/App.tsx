import { useEffect, useState } from 'react';

export function App() {
  const [version, setVersion] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const value = await window.bubu.app.getVersion();
        if (active) setVersion(value);
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => { active = false; };
  }, []);

  return (
    <main className="shell">
      <header className="brand">Bubu AI</header>
      <section className="welcome" aria-labelledby="welcome-title">
        <p className="eyebrow">工程初始化</p>
        <h1 id="welcome-title">从这里开始。</h1>
        <p className="description">这是 Bubu AI 的最小桌面应用壳。</p>
        <p className="description">对话、模型连接与文件功能将在后续版本中实现。</p>
        <p className="version" role="status">
          {failed ? '无法获取应用版本，请关闭应用后重试。' : version ? `应用版本 ${version}` : '正在获取应用版本…'}
        </p>
      </section>
      <footer>本地优先 · 每一步都由你掌握</footer>
    </main>
  );
}
