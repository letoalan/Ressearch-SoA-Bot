import { db, type TelemetryEntry } from './db/db';

export async function logTelemetry(
  entry: Omit<TelemetryEntry, 'ts'> & { ts?: number }
): Promise<void> {
  try {
    await db.telemetry.add({
      ts: entry.ts ?? Date.now(),
      ...entry,
    });
  } catch (e) {
    console.warn('Erreur enregistrement télémétrie:', e);
  }
}

/** Exporte toutes les métriques de télémétrie au format CSV */
export async function exportTelemetryCsv(): Promise<number> {
  const records = await db.telemetry.toArray();
  if (records.length === 0) {
    throw new Error('Aucune donnée de télémétrie enregistrée pour le moment.');
  }

  const headers = [
    'id',
    'horodatage',
    'phase',
    'modele',
    'duree_totale_ms',
    'prompt_tokens',
    'completion_tokens',
    'ttft_ms',
    'debit_tps',
    'json_valide',
    'repli_utilise',
    'references_invalides',
  ];

  const escapeCsv = (val: any) => {
    if (val == null) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = records.map(r => [
    r.id,
    new Date(r.ts).toISOString(),
    r.phase,
    r.model,
    Math.round(r.total_ms),
    r.prompt_tokens ?? '',
    r.completion_tokens ?? '',
    r.ttft_ms ? Math.round(r.ttft_ms) : '',
    r.tps_gen ? r.tps_gen.toFixed(1) : '',
    r.json_ok != null ? (r.json_ok ? '1' : '0') : '',
    r.fallback_used != null ? (r.fallback_used ? '1' : '0') : '',
    r.refs_invalid ?? 0,
  ]);

  const csvContent = [headers.join(','), ...rows.map(row => row.map(escapeCsv).join(','))].join(
    '\n'
  );

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `scibot-telemetry-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return records.length;
}
