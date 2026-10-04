import type { Paper, SearchOpts } from './types';
import { getApiBaseUrl } from './endpoints';

export async function searchHal(q: string, o: SearchOpts): Promise<Paper[]> {
  const params = new URLSearchParams({
    q,
    wt: 'json',
    rows: String(o.limit),
    fl: 'halId_s,title_s,authFullName_s,producedDateY_i,abstract_s,doiId_s,uri_s,fileMain_s,journalTitle_s,language_s,docType_s,openAccess_bool',
  });
  if (o.oaOnly) params.append('fq', 'openAccess_bool:true');
  if (o.yearFrom) params.append('fq', `producedDateY_i:[${o.yearFrom} TO *]`);

  const base = getApiBaseUrl('hal');
  const r = await fetch(`${base}/search/?${params}`, { signal: o.signal });
  if (!r.ok) throw new Error(`HAL ${r.status}`);
  const j = await r.json();

  return (j.response?.docs ?? []).map((d: any): Paper => ({
    id: d.doiId_s?.toLowerCase() ?? d.halId_s,
    title: d.title_s?.[0] ?? '(Sans titre)',
    authors: d.authFullName_s ?? [],
    year: d.producedDateY_i,
    abstract: d.abstract_s?.[0],
    doi: d.doiId_s,
    url: d.uri_s,
    pdfUrl: d.fileMain_s,
    venue: d.journalTitle_s ?? 'HAL',
    source: 'hal',
    lang: d.language_s?.[0],
    isOA: Boolean(d.openAccess_bool || d.fileMain_s),
    type:
      d.docType_s === 'OUV'
        ? 'book'
        : d.docType_s === 'COUV'
        ? 'chapter'
        : d.docType_s === 'THESE'
        ? 'thesis'
        : 'article',
  }));
}
