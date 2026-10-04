import type { Paper, SearchOpts } from './types';
import { getApiBaseUrl } from './endpoints';

export async function searchOpenLibrary(q: string, o: SearchOpts): Promise<Paper[]> {
  const params = new URLSearchParams({
    q,
    limit: String(o.limit),
    fields: 'key,title,author_name,first_publish_year,publisher,isbn,ebook_access,subject',
  });

  const base = getApiBaseUrl('openlibrary');
  const r = await fetch(`${base}/search.json?${params}`, { signal: o.signal });
  if (!r.ok) throw new Error(`OpenLibrary ${r.status}`);
  const j = await r.json();

  return (j.docs ?? [])
    .map((d: any): Paper => ({
      id: d.isbn?.[0] ?? d.key,
      title: d.title ?? '(Sans titre)',
      authors: d.author_name ?? [],
      year: d.first_publish_year,
      url: `https://openlibrary.org${d.key}`,
      publisher: d.publisher?.[0],
      isbn: d.isbn?.[0],
      source: 'openlibrary',
      type: 'book',
      isOA: d.ebook_access === 'public',
      abstract: d.subject ? `Sujets : ${d.subject.slice(0, 8).join(', ')}` : undefined,
    }))
    .filter((p: Paper) => !o.yearFrom || (p.year ?? 0) >= o.yearFrom);
}
