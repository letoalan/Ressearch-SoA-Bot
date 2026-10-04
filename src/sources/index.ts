import type { Paper, SearchOpts } from './types';
import { searchOpenAlex } from './openalex';
import { searchArxiv } from './arxiv';
import { searchHal } from './hal';
import { searchCrossref } from './crossref';
import { searchOpenLibrary } from './openlibrary';
import type { Settings } from '../config';

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

export async function searchAll(
  queries: string[],
  s: Settings,
  o: Omit<SearchOpts, 'limit' | 'oaOnly'>
): Promise<{ papers: Paper[]; errors: string[] }> {
  const oaOnly = s.access === 'oa';
  const tasks: Promise<Paper[]>[] = [];
  const errors: string[] = [];

  for (const q of queries) {
    const opts: SearchOpts = { ...o, limit: s.maxPerSource, email: s.email, oaOnly };
    if (s.sources.openalex) tasks.push(searchOpenAlex(q, opts));
    if (s.sources.arxiv) tasks.push(searchArxiv(q, opts));
    if (s.sources.hal) tasks.push(searchHal(q, opts));
    if (!oaOnly) {
      if (s.sources.crossref) tasks.push(searchCrossref(q, opts));
      if (s.sources.openlibrary) tasks.push(searchOpenLibrary(q, opts));
    }
  }

  const settled = await Promise.allSettled(tasks);
  const map = new Map<string, Paper>();

  for (const r of settled) {
    if (r.status === 'rejected') {
      errors.push(String(r.reason?.message ?? r.reason));
      continue;
    }
    for (const p of r.value) {
      const key = p.doi ? p.doi.toLowerCase().trim() : norm(p.title).slice(0, 80);
      if (!key) continue;
      const prev = map.get(key);
      if (prev) {
        map.set(key, {
          ...prev,
          ...p,
          abstract: prev.abstract || p.abstract,
          pdfUrl: prev.pdfUrl || p.pdfUrl,
          isOA: prev.isOA || p.isOA,
          citations: Math.max(prev.citations ?? 0, p.citations ?? 0),
        });
      } else {
        map.set(key, p);
      }
    }
  }

  let papers = [...map.values()];
  if (oaOnly) {
    papers = papers.filter(p => p.isOA);
  }
  return { papers, errors };
}

export * from './types';
export * from './openalex';
export * from './arxiv';
export * from './hal';
export * from './crossref';
export * from './openlibrary';
export * from './unpaywall';
