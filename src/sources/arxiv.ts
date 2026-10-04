import type { Paper, SearchOpts } from './types';
import { getApiBaseUrl } from './endpoints';

export async function searchArxiv(q: string, o: SearchOpts): Promise<Paper[]> {
  const params = new URLSearchParams({
    search_query: `all:${q}`,
    start: '0',
    max_results: String(o.limit),
    sortBy: 'relevance',
  });

  const base = getApiBaseUrl('arxiv');
  const target = `${base}/api/query?${params}`;

  let xmlText = '';
  try {
    const r = await fetch(target, { signal: o.signal });
    if (!r.ok) throw new Error(`arXiv ${r.status}`);
    xmlText = await r.text();
  } catch (err: any) {
    // Si nous sommes sur GitHub Pages / build statique, arXiv bloque le CORS direct dans le navigateur
    // Un relais CORS transparent est sollicité en secours
    if (!import.meta.env.DEV) {
      const fallbackUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`;
      const r2 = await fetch(fallbackUrl, { signal: o.signal });
      if (!r2.ok) throw new Error(`arXiv ${r2.status}`);
      xmlText = await r2.text();
    } else {
      throw err;
    }
  }

  const xml = new DOMParser().parseFromString(xmlText, 'application/xml');

  return [...xml.getElementsByTagName('entry')]
    .map((e): Paper => {
      const t = (tag: string) =>
        e.getElementsByTagName(tag)[0]?.textContent?.trim().replace(/\s+/g, ' ') ?? '';
      const absUrl = t('id');
      const pdf =
        [...e.getElementsByTagName('link')].find(l => l.getAttribute('title') === 'pdf')?.getAttribute('href') ??
        undefined;
      const doi = e.getElementsByTagName('arxiv:doi')[0]?.textContent?.trim() ?? undefined;

      return {
        id: doi?.toLowerCase() ?? absUrl,
        title: t('title'),
        authors: [...e.getElementsByTagName('author')]
          .map(a => a.getElementsByTagName('name')[0]?.textContent?.trim() ?? '')
          .filter(Boolean),
        year: Number(t('published').slice(0, 4)) || undefined,
        abstract: t('summary'),
        doi,
        url: absUrl,
        pdfUrl: pdf,
        venue: 'arXiv',
        source: 'arxiv',
        lang: 'en',
        isOA: true,
        type: 'preprint',
      };
    })
    .filter(p => !o.yearFrom || (p.year ?? 0) >= o.yearFrom);
}
