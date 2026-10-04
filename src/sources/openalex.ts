import type { Paper, SearchOpts } from './types';
import { getApiBaseUrl } from './endpoints';

const fromInverted = (inv?: Record<string, number[]>): string | undefined => {
  if (!inv) return undefined;
  const words: string[] = [];
  for (const [w, pos] of Object.entries(inv)) {
    pos.forEach(i => {
      words[i] = w;
    });
  }
  return words.join(' ');
};

export async function searchOpenAlex(q: string, o: SearchOpts): Promise<Paper[]> {
  const filters: string[] = o.oaOnly ? ['open_access.is_oa:true'] : [];
  if (o.yearFrom) filters.push(`from_publication_date:${o.yearFrom}-01-01`);

  const params = new URLSearchParams({ search: q, 'per-page': String(o.limit) });
  if (filters.length) params.set('filter', filters.join(','));
  if (o.email) params.set('mailto', o.email);

  const base = getApiBaseUrl('openalex');
  const r = await fetch(`${base}/works?${params}`, { signal: o.signal });
  if (!r.ok) throw new Error(`OpenAlex ${r.status}`);
  const j = await r.json();

  return (j.results ?? []).map((w: any): Paper => ({
    id: w.doi?.replace('https://doi.org/', '').toLowerCase() ?? w.id,
    title: w.display_name ?? w.title ?? '(Sans titre)',
    authors: (w.authorships ?? []).map((a: any) => a.author?.display_name).filter(Boolean),
    year: w.publication_year,
    abstract: fromInverted(w.abstract_inverted_index),
    doi: w.doi?.replace('https://doi.org/', ''),
    url: w.primary_location?.landing_page_url ?? w.doi ?? w.id,
    pdfUrl: w.best_oa_location?.pdf_url ?? w.open_access?.oa_url,
    venue: w.primary_location?.source?.display_name,
    citations: w.cited_by_count,
    source: 'openalex',
    lang: w.language,
    isOA: !!w.open_access?.is_oa,
    publisher: w.primary_location?.source?.host_organization_name,
    type:
      w.type === 'book'
        ? 'book'
        : w.type === 'book-chapter'
        ? 'chapter'
        : w.type === 'preprint'
        ? 'preprint'
        : w.type === 'dissertation'
        ? 'thesis'
        : 'article',
  }));
}
