import { useEffect, useRef, useState } from 'react';
import {
  exportDatabase,
  readBackupFile,
  importDatabase,
  wipeDatabase,
  type ImportMode,
  type ImportReport,
} from '../db/backup';
import { requestPersistence } from '../db/db';
import { exportTelemetryCsv } from '../telemetry';

const fmt = (b: number) =>
  b > 1e6 ? `${(b / 1e6).toFixed(1)} Mo` : `${Math.round(b / 1e3)} ko`;

export function DataManager({ onChanged }: { onChanged?: () => void }) {
  const [info, setInfo] = useState<{ persisted: boolean; usage: number; quota: number }>();
  const [preview, setPreview] = useState<{ payload: any; integrity: boolean; name: string }>();
  const [mode, setMode] = useState<ImportMode>('merge');
  const [withSettings, setWithSettings] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestPersistence().then(setInfo);
  }, []);

  const doExport = async () => {
    try {
      const counts = await exportDatabase({ includeSettings: withSettings });
      setMsg(
        `Export réussi : ${Object.entries(counts)
          .map(([k, n]) => `${k} (${n})`)
          .join(' · ')}`
      );
    } catch (e: any) {
      setMsg(`Erreur export : ${e.message}`);
    }
  };

  const onFile = async (f?: File) => {
    if (!f) return;
    setMsg('');
    try {
      const { payload, integrity } = await readBackupFile(f);
      setPreview({ payload, integrity, name: f.name });
    } catch (e: any) {
      setMsg(e.message);
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const doImport = async () => {
    if (!preview) return;
    if (
      mode === 'replace' &&
      !window.confirm('Remplacer TOUTES les données locales existantes par celles du fichier ?')
    ) {
      return;
    }
    try {
      const r: ImportReport = await importDatabase(preview.payload, mode);
      const summary = `Ajoutés : ${Object.values(r.added).reduce((a, b) => a + b, 0)} · Mis à jour : ${Object.values(
        r.updated
      ).reduce((a, b) => a + b, 0)}`;
      setMsg(`Import terminé (${summary})${r.warnings.length ? ' · ' + r.warnings.join(' ; ') : ''}`);
      setPreview(undefined);
      onChanged?.();
    } catch (e: any) {
      setMsg(`Erreur import : ${e.message}`);
    }
  };

  return (
    <section className="data-manager">
      <div className="section-title">
        <span>💾 Données locales</span>
      </div>

      {info && (
        <p className="hint">
          {fmt(info.usage)} utilisés · stockage{' '}
          {info.persisted ? (
            <span className="badge-ok">persistant</span>
          ) : (
            <span className="badge-warn">standard (export recommandé)</span>
          )}
        </p>
      )}

      <div className="button-group">
        <button type="button" className="btn-secondary" onClick={doExport}>
          Exporter en JSON
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => fileRef.current?.click()}
        >
          Importer un JSON…
        </button>
      </div>

      <label className="checkbox-label small">
        <input
          type="checkbox"
          checked={withSettings}
          onChange={e => setWithSettings(e.target.checked)}
        />
        Inclure les préférences privées (e-mail, modèle)
      </label>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={e => onFile(e.target.files?.[0])}
      />

      {preview && (
        <div className="import-preview">
          <p>
            <strong>{preview.name}</strong> · exporté le{' '}
            {new Date(preview.payload.exportedAt).toLocaleDateString('fr-FR')}
          </p>
          <p className="hint">
            {Object.entries(preview.payload.counts ?? {})
              .map(([k, n]) => `${k}: ${n}`)
              .join(' · ')}
          </p>

          {!preview.integrity && (
            <p className="err">
              ⚠️ Empreinte SHA-256 discordante : le fichier a été modifié manuellement. L'intégrité
              globale n'est pas garantie mais chaque enregistrement sera validé.
            </p>
          )}

          <div className="import-mode-selector">
            <label>
              <input
                type="radio"
                checked={mode === 'merge'}
                onChange={() => setMode('merge')}
              />
              Fusionner avec mes données
            </label>
            <label>
              <input
                type="radio"
                checked={mode === 'replace'}
                onChange={() => setMode('replace')}
              />
              Remplacer mes données
            </label>
          </div>

          <div className="row mt-sm">
            <button type="button" className="btn-primary" onClick={doImport}>
              Confirmer l'import
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setPreview(undefined)}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        className="btn-secondary"
        onClick={async () => {
          try {
            const count = await exportTelemetryCsv();
            setMsg(`Export télémétrie : ${count} mesures exportées en CSV.`);
          } catch (e: any) {
            setMsg(e.message);
          }
        }}
      >
        📊 Exporter la télémétrie (CSV)
      </button>

      <button
        type="button"
        className="btn-danger-outline"
        onClick={async () => {
          if (
            window.confirm(
              'Attention : effacer toutes les données SciBot de ce navigateur ? Pensez à exporter vos sessions importantes au préalable.'
            )
          ) {
            await wipeDatabase();
            onChanged?.();
            setMsg('Base locale entièrement vidée.');
          }
        }}
      >
        Vider la base locale
      </button>

      {msg && <p className="status-msg">{msg}</p>}
    </section>
  );
}
