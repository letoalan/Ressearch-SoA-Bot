import { db } from './db';

export const BACKUP_FORMAT = 'scibot-backup';
export const SCHEMA_VERSION = 1;
const TABLES = ['sessions', 'library', 'conversations', 'settings'] as const;
type TableName = (typeof TABLES)[number];
const MAX_IMPORT_BYTES = 50 * 1024 * 1024; // 50 Mo max

export interface ExportOptions {
  tables?: TableName[];
  includeSettings?: boolean; // Faux par défaut pour ne pas exporter l'e-mail ou réglages privés
  stripOutputs?: boolean; // Allège la sauvegarde en retirant le texte Markdown volumineux
}

export interface ImportReport {
  added: Record<string, number>;
  updated: Record<string, number>;
  skipped: number;
  warnings: string[];
}

export type ImportMode = 'merge' | 'replace';

/* ---------- Utilitaires d'intégrité ---------- */

// Sérialisation JSON canonique (clés triées) pour une empreinte SHA-256 déterministe
const canonical = (v: unknown): string => {
  if (Array.isArray(v)) {
    return `[${v.map(canonical).join(',')}]`;
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as object).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
};

async function computeSha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return 'sha256:' + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- EXPORT ---------- */

export async function exportDatabase(opts: ExportOptions = {}): Promise<Record<string, number>> {
  const tables = (opts.tables ?? [...TABLES]).filter(t => t !== 'settings' || opts.includeSettings);
  const data: Record<string, unknown[]> = {};

  await db.transaction('r', tables.map(t => db.table(t)), async () => {
    for (const t of tables) {
      data[t] = await db.table(t).toArray();
    }
  });

  if (opts.stripOutputs && data.sessions) {
    data.sessions = (data.sessions as any[]).map(({ output, ...rest }) => rest);
  }

  const payload = {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    appVersion: '1.0.0',
    exportedAt: new Date().toISOString(),
    tables,
    counts: Object.fromEntries(tables.map(t => [t, data[t]?.length ?? 0])),
    checksum: await computeSha256(canonical(data)),
    data,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `scibot-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);

  return payload.counts;
}

/* ---------- VALIDATION & ASSAINISSEMENT ---------- */

const isStr = (v: unknown): boolean => typeof v === 'string';
const isNum = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);

const validators: Record<TableName, (r: any) => boolean> = {
  sessions: r => Boolean(r && isNum(r.createdAt) && isStr(r.phase) && r.brief && isStr(r.brief.text)),
  library: r => Boolean(r && isStr(r.id) && isStr(r.title) && Array.isArray(r.authors) && isStr(r.url)),
  conversations: r => Boolean(r && isNum(r.createdAt) && Array.isArray(r.messages)),
  settings: r => Boolean(r && isStr(r.key) && typeof r.value === 'object'),
};

/** Neutralise les URL malveillantes (javascript:, data:) */
const safeUrl = (u?: string): string | undefined => (u && /^https?:\/\//i.test(u) ? u : undefined);

function sanitize(t: TableName, r: any): any {
  if (t === 'library') {
    return {
      ...r,
      url: safeUrl(r.url) ?? '#',
      pdfUrl: safeUrl(r.pdfUrl),
      tags: Array.isArray(r.tags) ? r.tags.filter(isStr) : [],
    };
  }
  if (t === 'sessions') {
    const clean = structuredClone(r);
    const fix = (ps: any[] = []) =>
      ps.map(p => ({
        ...p,
        url: safeUrl(p.url) ?? '#',
        pdfUrl: safeUrl(p.pdfUrl),
      }));
    return {
      ...clean,
      explore: clean.explore ? { ...clean.explore, corpus: fix(clean.explore.corpus) } : clean.explore,
    };
  }
  return r;
}

/* ---------- IMPORT ---------- */

export async function readBackupFile(file: File): Promise<{ payload: any; integrity: boolean }> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error('Fichier trop volumineux (> 50 Mo)');
  }
  let payload: any;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    throw new Error("Le fichier sélectionné n'est pas un JSON valide");
  }

  if (payload?.format !== BACKUP_FORMAT) {
    throw new Error("Ce fichier n'est pas une sauvegarde SciBot valide");
  }
  if (!isNum(payload.schemaVersion) || payload.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `Version de schéma ${payload.schemaVersion} non supportée (version max : ${SCHEMA_VERSION})`
    );
  }

  const checksumCalc = await computeSha256(canonical(payload.data));
  const integrity = checksumCalc === payload.checksum;

  return { payload, integrity };
}

export async function importDatabase(
  payload: any,
  mode: ImportMode = 'merge'
): Promise<ImportReport> {
  const report: ImportReport = { added: {}, updated: {}, skipped: 0, warnings: [] };
  const tables = TABLES.filter(t => Array.isArray(payload.data?.[t]));

  await db.transaction('rw', tables.map(t => db.table(t)), async () => {
    for (const t of tables) {
      const rows = (payload.data[t] as any[])
        .filter(r => {
          const ok = validators[t](r);
          if (!ok) report.skipped++;
          return ok;
        })
        .map(r => sanitize(t, r));

      const table = db.table(t);
      report.added[t] = 0;
      report.updated[t] = 0;

      if (mode === 'replace') {
        await table.clear();
        await table.bulkPut(rows);
        report.added[t] = rows.length;
        continue;
      }

      // Mode 'merge' (fusion fine avec dédoublonnage)
      for (const r of rows) {
        if (t === 'sessions' || t === 'conversations') {
          const dup = await table.where('createdAt').equals(r.createdAt).first();
          if (dup) {
            report.updated[t]++;
            await table.put({ ...r, id: dup.id });
          } else {
            const { id: _, ...rest } = r;
            await table.add(rest);
            report.added[t]++;
          }
        } else if (t === 'library') {
          const cur = await table.get(r.id);
          if (cur) {
            await table.put({
              ...cur,
              ...r,
              tags: [...new Set([...(cur.tags ?? []), ...(r.tags ?? [])])],
              note: (r.savedAt ?? 0) > (cur.savedAt ?? 0) ? r.note : cur.note,
            });
            report.updated[t]++;
          } else {
            await table.add(r);
            report.added[t]++;
          }
        } else {
          // settings
          if (await table.get(r.key)) {
            report.warnings.push('Réglages locaux existants conservés');
          } else {
            await table.add(r);
            report.added[t]++;
          }
        }
      }
    }
  });

  return report;
}

/** Effacement complet des tables locales de SciBot */
export async function wipeDatabase(): Promise<void> {
  await Promise.all(TABLES.map(t => db.table(t).clear()));
}
