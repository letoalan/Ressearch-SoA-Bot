import type { Paper, SearchOpts } from './types';
import { getApiBaseUrl } from './endpoints';

export async function searchCrossref(q: string, o: SearchOpts): Promise<Paper[]> {
  const params = new URLSearchParams({
    'query.bibliographic': q,
    rows: String(o.limit),
    select:
      'DOI,title,author,issued,container-title,publisher,type,abstract,URL,is-referenced-by-count,ISBN,link,license',
  });
  if (o.yearFrom) params.set('filter', `from-pub-date:${o.yearFrom}`);
  if (o.email) params.set('mailto', o.email);

  const base = getApiBaseUrl('crossref');
  const r = await fetch(`${base}/works?${params}`, { signal: o.signal });
  if (!r.ok) throw new Error(`Crossref ${r.status}`);
  const j = await r.json();

  return (j.message?.items ?? []).map((w: any): Paper => ({
    id: (w.DOI ?? '').toLowerCase(),
    doi: w.DOI,
    title: w.title?.[0] ?? '(Sans titre)',
    authors: (w.author ?? [])
      .map((a: any) => [a.given, a.family].filter(Boolean).join(' '))
      .filter(Boolean),
    year: w.issued?.['date-parts']?.[0]?.[0],
    abstract: w.abstract?.replace(/<[^>]+>/g, ''),
    url: w.URL ?? (w.DOI ? `https://doi.org/${w.DOI}` : '#'),
    venue: w['container-title']?.[0],
    publisher: w.publisher,
    citations: w['is-referenced-by-count'],
    isbn: w.ISBN?.[0],
    source: 'crossref',
    isOA: (w.license ?? []).some((l: any) => /creativecommons/i.test(l.URL ?? '')),
    type:
      w.type === 'book' || w.type === 'monograph'
        ? 'book'
        : w.type === 'book-chapter'
        ? 'chapter'
        : 'article',
  }));
}
