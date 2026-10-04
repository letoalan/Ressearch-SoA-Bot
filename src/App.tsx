import { useEffect, useState, useCallback } from 'react';
import { Settings } from './components/Settings';
import { Wizard } from './ui/Wizard';
import { DEFAULT_SETTINGS, type Settings as S } from './config';
import { db } from './db/db';

export default function App() {
  const [s, setS] = useState<S>(DEFAULT_SETTINGS);

  const loadSettings = useCallback(() => {
    db.settings
      .get('main')
      .then(r => {
        if (r?.value) {
          setS({
            ...DEFAULT_SETTINGS,
            ...r.value,
            sources: { ...DEFAULT_SETTINGS.sources, ...(r.value.sources ?? {}) },
          });
        }
      })
      .catch(() => {
        // Fallback silencieux sur les paramètres par défaut
      });
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const update = (v: S) => {
    setS(v);
    db.settings.put({ key: 'main', value: v });
  };

  return (
    <div className="app-layout">
      <Settings value={s} onChange={update} onReload={loadSettings} />
      <Wizard settings={s} />
    </div>
  );
}
