import { useEffect, useState } from 'react';
import { WorkbenchShell } from './workbench/WorkbenchShell';

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

  return <WorkbenchShell version={version} versionFailed={failed} />;
}
