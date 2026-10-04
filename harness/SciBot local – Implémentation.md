# SciBot local — Bot de recherche d'articles scientifiques open source

Navigateur · Vite + React + TypeScript · Ollama / LM Studio · base locale IndexedDB + export/import JSON · 100 % local

> Choix retenus : React + TS, stockage IndexedDB, exécution locale (`npm run dev` ou `vite preview`).
> **Trois modes de sortie Markdown** : `complet` (état de l'art commenté, y compris ouvrages et articles sous paywall), `oa` (état de l'art en libre accès), `sitographie` (liste brute, sans LLM pour la rédaction). Voir section 10 bis.
> Choix par défaut (non précisés) : sources **OpenAlex, arXiv, HAL** (+ Unpaywall pour retrouver les PDF) ; périmètre **recherche + synthèse**, avec une phase 2 RAG décrite en fin de document.

---

## 1. Architecture

```
┌──────────────── Navigateur (React) ────────────────┐
│ ChatPanel ─► agent.ts ─► 1. LLM : requête → mots-clés (JSON)
│                          2. sources/* en parallèle (OpenAlex, arXiv, HAL)
│                          3. fusion + dédoublonnage (DOI / titre)
│                          4. LLM : synthèse citée [1], [2]… (streaming)
│ ResultsPanel ◄── Dexie (IndexedDB) : sessions, bibliothèque, réglages ⇄ sauvegarde .json
└───────────────│────────────────────────────────────┘
                │ proxy Vite (évite CORS)
   /llm/ollama → http://localhost:11434   /llm/lmstudio → http://localhost:1234
   /api/openalex → api.openalex.org   /api/arxiv → export.arxiv.org   /api/hal → api.archives-ouvertes.fr
```

Ollama et LM Studio exposent tous deux une API **compatible OpenAI** (`/v1/chat/completions`, `/v1/models`) : un seul client suffit.

## 2. Installation

```bash
npm create vite@latest scibot -- --template react-ts
cd scibot
npm i dexie dexie-react-hooks react-markdown
npm run dev
```

Prérequis :
- **Ollama** : `ollama pull qwen2.5:7b` (ou `llama3.1:8b`, `mistral-nemo`). Serveur sur `:11434`.
- **LM Studio** : onglet Developer → *Start Server* (port `1234`), charger un modèle.
- Sans le proxy Vite (build statique ouvert ailleurs), autoriser l'origine : `OLLAMA_ORIGINS=http://localhost:5173` ; dans LM Studio activer *Enable CORS*.

## 3. Arborescence

```
src/
  config.ts
  llm/client.ts
  sources/types.ts  openalex.ts  arxiv.ts  hal.ts  crossref.ts  openlibrary.ts  unpaywall.ts  index.ts
  output/markdown.ts
  agent/prompts.ts  agent.ts
  db/db.ts  backup.ts
  components/Settings.tsx  ChatPanel.tsx  ResultCard.tsx  DataManager.tsx
  App.tsx  main.tsx  index.css
vite.config.ts
```

## 4. `vite.config.ts`

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const p = (target: string, prefix: string) => ({
  target, changeOrigin: true, rewrite: (s: string) => s.replace(new RegExp(`^${prefix}`), ''),
});

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/llm/ollama':   p('http://localhost:11434', '/llm/ollama'),
      '/llm/lmstudio': p('http://localhost:1234', '/llm/lmstudio'),
      '/api/openalex': p('https://api.openalex.org', '/api/openalex'),
      '/api/arxiv':    p('https://export.arxiv.org', '/api/arxiv'),
      '/api/hal':      p('https://api.archives-ouvertes.fr', '/api/hal'),
      '/api/unpaywall':p('https://api.unpaywall.org', '/api/unpaywall'),
      '/api/crossref': p('https://api.crossref.org', '/api/crossref'),
      '/api/openlibrary': p('https://openlibrary.org', '/api/openlibrary'),
    },
  },
  preview: { proxy: undefined }, // pour `vite preview`, recopier le bloc proxy ci-dessus
});
```

## 5. `src/config.ts`

```ts
export type Provider = 'ollama' | 'lmstudio';
export type OutputMode = 'complet' | 'oa' | 'sitographie';

export interface Settings {
  provider: Provider;
  model: string;
  temperature: number;
  email: string;          // requis par Unpaywall, recommandé par OpenAlex (polite pool)
  maxPerSource: number;
  mode: OutputMode;
  sources: { openalex: boolean; arxiv: boolean; hal: boolean };
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'ollama', model: '', temperature: 0.2, email: '',
  maxPerSource: 8, mode: 'oa', sources: { openalex: true, arxiv: true, hal: true },
};

export const baseUrl = (p: Provider) => (p === 'ollama' ? '/llm/ollama/v1' : '/llm/lmstudio/v1');
```

## 6. Client LLM — `src/llm/client.ts`

```ts
import { baseUrl, type Provider } from '../config';

export interface Msg { role: 'system' | 'user' | 'assistant'; content: string }

export async function listModels(p: Provider): Promise<string[]> {
  const r = await fetch(`${baseUrl(p)}/models`);
  if (!r.ok) throw new Error(`Serveur ${p} injoignable (${r.status})`);
  const j = await r.json();
  return (j.data ?? []).map((m: { id: string }) => m.id);
}

/** Réponse complète (non streamée) */
export async function chat(p: Provider, model: string, messages: Msg[], temperature = 0.2, json = false) {
  const r = await fetch(`${baseUrl(p)}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature, stream: false,
      ...(json && p === 'ollama' ? { response_format: { type: 'json_object' } } : {}) }),
  });
  if (!r.ok) throw new Error(`LLM ${r.status}: ${await r.text()}`);
  return (await r.json()).choices[0].message.content as string;
}

/** Streaming SSE (format OpenAI) */
export async function* chatStream(p: Provider, model: string, messages: Msg[], temperature = 0.2, signal?: AbortSignal) {
  const r = await fetch(`${baseUrl(p)}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ model, messages, temperature, stream: true }),
  });
  if (!r.ok || !r.body) throw new Error(`LLM ${r.status}`);
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() ?? '';
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith('data:')) continue;
      const data = l.slice(5).trim();
      if (data === '[DONE]') return;
      try { const d = JSON.parse(data).choices?.[0]?.delta?.content; if (d) yield d as string; } catch { /* ligne partielle */ }
    }
  }
}
```

## 7. Sources

### `src/sources/types.ts`

```ts
export interface Paper {
  id: string;              // DOI normalisé ou id source
  title: string;
  authors: string[];
  year?: number;
  abstract?: string;
  doi?: string;
  url: string;             // page de l'article
  pdfUrl?: string;         // texte intégral libre
  venue?: string;
  citations?: number;
  source: 'openalex' | 'arxiv' | 'hal' | 'crossref' | 'openlibrary';
  lang?: string;
  type?: 'article' | 'book' | 'chapter' | 'preprint' | 'thesis' | 'other';
  isOA: boolean;           // texte intégral librement accessible
  publisher?: string;
  isbn?: string;
}
export interface SearchOpts { limit: number; email?: string; yearFrom?: number; signal?: AbortSignal; oaOnly: boolean }
```

### `src/sources/openalex.ts`

```ts
import type { Paper, SearchOpts } from './types';

const fromInverted = (inv?: Record<string, number[]>) => {
  if (!inv) return undefined;
  const words: string[] = [];
  for (const [w, pos] of Object.entries(inv)) pos.forEach(i => (words[i] = w));
  return words.join(' ');
};

export async function searchOpenAlex(q: string, o: SearchOpts): Promise<Paper[]> {
  const filters: string[] = o.oaOnly ? ['open_access.is_oa:true'] : [];
  if (o.yearFrom) filters.push(`from_publication_date:${o.yearFrom}-01-01`);
  const params = new URLSearchParams({ search: q, 'per-page': String(o.limit) });
  if (filters.length) params.set('filter', filters.join(','));
  if (o.email) params.set('mailto', o.email);
  const r = await fetch(`/api/openalex/works?${params}`, { signal: o.signal });
  if (!r.ok) throw new Error(`OpenAlex ${r.status}`);
  const j = await r.json();
  return j.results.map((w: any): Paper => ({
    id: w.doi?.replace('https://doi.org/', '').toLowerCase() ?? w.id,
    title: w.display_name ?? w.title,
    authors: (w.authorships ?? []).map((a: any) => a.author.display_name),
    year: w.publication_year,
    abstract: fromInverted(w.abstract_inverted_index),
    doi: w.doi?.replace('https://doi.org/', ''),
    url: w.primary_location?.landing_page_url ?? w.doi ?? w.id,
    pdfUrl: w.best_oa_location?.pdf_url ?? w.open_access?.oa_url,
    venue: w.primary_location?.source?.display_name,
    citations: w.cited_by_count, source: 'openalex', lang: w.language,
    isOA: !!w.open_access?.is_oa, publisher: w.primary_location?.source?.host_organization_name,
    type: w.type === 'book' ? 'book' : w.type === 'book-chapter' ? 'chapter'
        : w.type === 'preprint' ? 'preprint' : w.type === 'dissertation' ? 'thesis' : 'article',
  }));
}
```

### `src/sources/arxiv.ts` (Atom XML)

```ts
import type { Paper, SearchOpts } from './types';

export async function searchArxiv(q: string, o: SearchOpts): Promise<Paper[]> {
  const params = new URLSearchParams({
    search_query: `all:${q}`, start: '0', max_results: String(o.limit), sortBy: 'relevance',
  });
  const r = await fetch(`/api/arxiv/api/query?${params}`, { signal: o.signal });
  if (!r.ok) throw new Error(`arXiv ${r.status}`);
  const xml = new DOMParser().parseFromString(await r.text(), 'application/xml');
  return [...xml.getElementsByTagName('entry')].map((e): Paper => {
    const t = (tag: string) => e.getElementsByTagName(tag)[0]?.textContent?.trim().replace(/\s+/g, ' ') ?? '';
    const absUrl = t('id');
    const pdf = [...e.getElementsByTagName('link')].find(l => l.getAttribute('title') === 'pdf')?.getAttribute('href') ?? undefined;
    const doi = e.getElementsByTagName('arxiv:doi')[0]?.textContent ?? undefined;
    return {
      id: doi?.toLowerCase() ?? absUrl, title: t('title'),
      authors: [...e.getElementsByTagName('author')].map(a => a.getElementsByTagName('name')[0]?.textContent ?? ''),
      year: Number(t('published').slice(0, 4)) || undefined,
      abstract: t('summary'), doi, url: absUrl, pdfUrl: pdf, venue: 'arXiv', source: 'arxiv', lang: 'en', isOA: true, type: 'preprint',
    };
  }).filter(p => !o.yearFrom || (p.year ?? 0) >= o.yearFrom);
}
```

> arXiv demande au plus ~1 requête / 3 s : ne pas relancer en boucle.

### `src/sources/hal.ts` (idéal pour les SHS françaises)

```ts
import type { Paper, SearchOpts } from './types';

export async function searchHal(q: string, o: SearchOpts): Promise<Paper[]> {
  const params = new URLSearchParams({
    q, wt: 'json', rows: String(o.limit),
    fl: 'halId_s,title_s,authFullName_s,producedDateY_i,abstract_s,doiId_s,uri_s,fileMain_s,journalTitle_s,language_s,docType_s,openAccess_bool',
  });
  if (o.oaOnly) params.append('fq', 'openAccess_bool:true');
  if (o.yearFrom) params.append('fq', `producedDateY_i:[${o.yearFrom} TO *]`);
  const r = await fetch(`/api/hal/search/?${params}`, { signal: o.signal });
  if (!r.ok) throw new Error(`HAL ${r.status}`);
  const j = await r.json();
  return j.response.docs.map((d: any): Paper => ({
    id: d.doiId_s?.toLowerCase() ?? d.halId_s,
    title: d.title_s?.[0] ?? '(sans titre)', authors: d.authFullName_s ?? [],
    year: d.producedDateY_i, abstract: d.abstract_s?.[0], doi: d.doiId_s,
    url: d.uri_s, pdfUrl: d.fileMain_s, venue: d.journalTitle_s ?? 'HAL', source: 'hal', lang: d.language_s?.[0],
    isOA: !!d.openAccess_bool || !!d.fileMain_s,
    type: d.docType_s === 'OUV' ? 'book' : d.docType_s === 'COUV' ? 'chapter' : d.docType_s === 'THESE' ? 'thesis' : 'article',
  }));
}
```

### `src/sources/unpaywall.ts` (complète les PDF manquants)

```ts
export async function findOaPdf(doi: string, email: string): Promise<string | undefined> {
  if (!email) return;
  const r = await fetch(`/api/unpaywall/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`);
  if (!r.ok) return;
  const j = await r.json();
  return j.best_oa_location?.url_for_pdf ?? j.best_oa_location?.url ?? undefined;
}
```

### `src/sources/crossref.ts` (articles et chapitres sous paywall)

```ts
import type { Paper, SearchOpts } from './types';

export async function searchCrossref(q: string, o: SearchOpts): Promise<Paper[]> {
  const params = new URLSearchParams({ 'query.bibliographic': q, rows: String(o.limit),
    select: 'DOI,title,author,issued,container-title,publisher,type,abstract,URL,is-referenced-by-count,ISBN,link,license' });
  if (o.yearFrom) params.set('filter', `from-pub-date:${o.yearFrom}`);
  if (o.email) params.set('mailto', o.email);
  const r = await fetch(`/api/crossref/works?${params}`, { signal: o.signal });
  if (!r.ok) throw new Error(`Crossref ${r.status}`);
  const j = await r.json();
  return j.message.items.map((w: any): Paper => ({
    id: w.DOI.toLowerCase(), doi: w.DOI, title: w.title?.[0] ?? '(sans titre)',
    authors: (w.author ?? []).map((a: any) => [a.given, a.family].filter(Boolean).join(' ')),
    year: w.issued?.['date-parts']?.[0]?.[0],
    abstract: w.abstract?.replace(/<[^>]+>/g, ''),   // JATS → texte
    url: w.URL, venue: w['container-title']?.[0], publisher: w.publisher,
    citations: w['is-referenced-by-count'], isbn: w.ISBN?.[0], source: 'crossref',
    isOA: (w.license ?? []).some((l: any) => /creativecommons/.test(l.URL)),
    type: w.type === 'book' || w.type === 'monograph' ? 'book' : w.type === 'book-chapter' ? 'chapter' : 'article',
  }));
}
```

### `src/sources/openlibrary.ts` (ouvrages)

```ts
import type { Paper, SearchOpts } from './types';

export async function searchOpenLibrary(q: string, o: SearchOpts): Promise<Paper[]> {
  const params = new URLSearchParams({ q, limit: String(o.limit),
    fields: 'key,title,author_name,first_publish_year,publisher,isbn,ebook_access,subject' });
  const r = await fetch(`/api/openlibrary/search.json?${params}`, { signal: o.signal });
  if (!r.ok) throw new Error(`OpenLibrary ${r.status}`);
  const j = await r.json();
  return j.docs.map((d: any): Paper => ({
    id: d.isbn?.[0] ?? d.key, title: d.title, authors: d.author_name ?? [],
    year: d.first_publish_year, url: `https://openlibrary.org${d.key}`,
    publisher: d.publisher?.[0], isbn: d.isbn?.[0], source: 'openlibrary', type: 'book',
    isOA: d.ebook_access === 'public',
    abstract: d.subject ? `Sujets : ${d.subject.slice(0, 8).join(', ')}` : undefined,
  })).filter((p: Paper) => !o.yearFrom || (p.year ?? 0) >= o.yearFrom);
}
```

> En mode `complet`, les documents sous paywall sont commentés à partir de leurs **métadonnées et résumés** (OpenAlex/Crossref) : le bot ne lit pas le texte intégral et le signale explicitement.

### `src/sources/index.ts` — recherche parallèle + dédoublonnage

```ts
import type { Paper, SearchOpts } from './types';
import { searchOpenAlex } from './openalex';
import { searchArxiv } from './arxiv';
import { searchHal } from './hal';
import type { Settings } from '../config';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

import { searchCrossref } from './crossref';
import { searchOpenLibrary } from './openlibrary';

export async function searchAll(queries: string[], s: Settings, o: Omit<SearchOpts, 'limit' | 'oaOnly'>) {
  const oaOnly = s.mode === 'oa';
  const tasks: Promise<Paper[]>[] = [];
  const errors: string[] = [];
  for (const q of queries) {
    const opts = { ...o, limit: s.maxPerSource, email: s.email, oaOnly };
    if (s.sources.openalex) tasks.push(searchOpenAlex(q, opts));
    if (s.sources.arxiv) tasks.push(searchArxiv(q, opts));
    if (s.sources.hal) tasks.push(searchHal(q, opts));
    if (!oaOnly) {                       // modes complet et sitographie : métadonnées hors OA
      tasks.push(searchCrossref(q, opts));
      tasks.push(searchOpenLibrary(q, opts));
    }
  }
  const settled = await Promise.allSettled(tasks);
  const map = new Map<string, Paper>();
  for (const r of settled) {
    if (r.status === 'rejected') { errors.push(String(r.reason)); continue; }
    for (const p of r.value) {
      const key = p.doi ? p.doi.toLowerCase() : norm(p.title).slice(0, 80);
      const prev = map.get(key);
      map.set(key, prev ? { ...prev, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v != null && !(prev as any)[v as any])),
        abstract: prev.abstract ?? p.abstract, pdfUrl: prev.pdfUrl ?? p.pdfUrl, isOA: prev.isOA || p.isOA } : p);
    }
  }
  let papers = [...map.values()];
  if (oaOnly) papers = papers.filter(p => p.isOA);
  return { papers, errors };
}
```

## 8. Agent

### `src/agent/prompts.ts`

```ts
export const PLANNER = `Tu es un documentaliste scientifique. À partir de la question de l'utilisateur,
produis UNIQUEMENT un JSON : {"queries": ["..."], "yearFrom": null | number, "lang": "fr"|"en"}.
- 2 à 3 requêtes courtes (3-6 mots), dont au moins une en anglais.
- Pas d'opérateurs booléens. yearFrom seulement si la question l'implique.`;

export const RERANK = `Note la pertinence de chaque article (0 à 3) pour la question.
Réponds UNIQUEMENT en JSON : {"scores": [{"i": number, "s": number}]}.`;

export const SYNTH_COMPLET = `Tu es un chercheur qui rédige un ÉTAT DE L'ART COMMENTÉ en Markdown, en français,
à partir EXCLUSIVEMENT des références fournies (articles, ouvrages, chapitres, en accès libre ou non).
Structure obligatoire :
## Introduction (problématique, bornes chronologiques et disciplinaires)
## Courants et approches (regroupe les références par école, méthode ou période ; compare-les)
## Apports majeurs (ouvrages de référence d'abord)
## Débats, controverses et angles morts
## Pistes de recherche
Règles : cite [n] après chaque affirmation ; pour une référence marquée PAYWALL ou OUVRAGE sans résumé,
commente uniquement ce que permettent les métadonnées et indique "(commentaire fondé sur la notice)".
N'invente ni contenu, ni référence.`;

export const SYNTH_OA = `Tu es un chercheur qui rédige un ÉTAT DE L'ART en Markdown, en français, fondé uniquement
sur des publications en LIBRE ACCÈS fournies. Structure :
## Introduction
## Synthèse thématique (sous-sections par thème)
## Limites du corpus en accès ouvert
## Lectures prioritaires (avec lien PDF)
Cite [n] après chaque affirmation. N'invente rien.`;

export const SYNTH = `Tu es un assistant de recherche académique. Rédige en français une synthèse structurée
à partir EXCLUSIVEMENT des articles fournis. Cite chaque affirmation avec [n].
Structure : 1) Réponse courte 2) Principaux apports 3) Débats / limites 4) Lectures prioritaires.
N'invente aucun article ni résultat. Si les sources sont insuffisantes, dis-le.`;
```

### `src/agent/agent.ts`

```ts
import { chat, chatStream, type Msg } from '../llm/client';
import { searchAll } from '../sources';
import type { Paper } from '../sources/types';
import type { Settings } from '../config';
import { PLANNER, RERANK, SYNTH_COMPLET, SYNTH_OA } from './prompts';
import { bibliography, sitography } from '../output/markdown';

const parseJson = <T,>(txt: string, fallback: T): T => {
  const m = txt.match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : fallback; } catch { return fallback; }
};

export type Step = { kind: 'plan' | 'search' | 'rank' | 'synth'; info: string };

export async function* runAgent(question: string, s: Settings, history: Msg[], signal: AbortSignal,
  onStep: (st: Step) => void, onPapers: (p: Paper[]) => void) {

  // 1. Planification
  const plan = parseJson(await chat(s.provider, s.model,
    [{ role: 'system', content: PLANNER }, { role: 'user', content: question }], 0, true),
    { queries: [question], yearFrom: null as number | null });
  onStep({ kind: 'plan', info: plan.queries.join(' · ') });

  // 2. Recherche
  const { papers, errors } = await searchAll(plan.queries, s, { yearFrom: plan.yearFrom ?? undefined, signal });
  onStep({ kind: 'search', info: `${papers.length} articles${errors.length ? ` (erreurs : ${errors.join(', ')})` : ''}` });

  // 3. Re-ranking LLM (sur titres + débuts de résumés)
  const list = papers.slice(0, 40).map((p, i) => `${i}. ${p.title} (${p.year ?? 's.d.'}) — ${p.abstract?.slice(0, 200) ?? ''}`).join('\n');
  const { scores } = parseJson(await chat(s.provider, s.model,
    [{ role: 'system', content: RERANK }, { role: 'user', content: `Question : ${question}\n\n${list}` }], 0, true),
    { scores: [] as { i: number; s: number }[] });
  const score = new Map(scores.map(x => [x.i, x.s]));
  const top = papers.slice(0, 40).map((p, i) => ({ p, s: score.get(i) ?? 1 }))
    .filter(x => x.s >= 1).sort((a, b) => b.s - a.s || (b.p.citations ?? 0) - (a.p.citations ?? 0))
    .slice(0, s.mode === 'complet' ? 20 : 12).map(x => x.p);
  onPapers(top);
  onStep({ kind: 'rank', info: `${top.length} retenus` });

  // Mode sitographie : pas de rédaction LLM, liste brute de TOUS les résultats pertinents
  if (s.mode === 'sitographie') {
    const all = papers.slice(0, 40).filter((_, i) => (score.get(i) ?? 1) >= 1);
    yield sitography(question, all);
    return;
  }

  // 4. Synthèse streamée
  const ctx = top.map((p, i) => `[${i + 1}] ${p.type === 'book' ? 'OUVRAGE' : (p.type ?? 'article').toUpperCase()} · ${p.isOA ? 'OA' : 'PAYWALL'}
${p.title} — ${p.authors.slice(0, 3).join(', ')} (${p.year ?? 's.d.'}), ${p.venue ?? p.publisher ?? ''}
${p.abstract?.slice(0, 1200) ?? '(pas de résumé : notice seule)'}`).join('\n\n');
  onStep({ kind: 'synth', info: 'Rédaction…' });
  yield `# État de l'art ${s.mode === 'oa' ? 'en libre accès' : 'commenté'} : ${question}\n\n`;
  yield* chatStream(s.provider, s.model, [
    { role: 'system', content: s.mode === 'complet' ? SYNTH_COMPLET : SYNTH_OA }, ...history.slice(-6),
    { role: 'user', content: `Question : ${question}\n\nRéférences :\n${ctx}` },
  ], s.temperature, signal);
  yield `\n\n${bibliography(top)}`;
}
```

## 9. Base locale du navigateur + export / import JSON

Principe : **la base vit uniquement dans le stockage du navigateur (IndexedDB)**, rien n'est envoyé vers un serveur. Comme ce stockage peut être effacé (vidage du cache, navigation privée, changement de poste), la portabilité et la sauvegarde passent par **un fichier JSON exportable et réimportable**.

```
 IndexedDB "scibot" (navigateur)        Fichier scibot-backup-AAAA-MM-JJ.json
 ┌───────────────────────────┐ export  ┌─────────────────────────────────────┐
 │ sessions   (parcours)     │ ──────► │ { format, schemaVersion, exportedAt,│
 │ library    (références)   │         │   checksum (SHA-256),               │
 │ conversations (historique)│ ◄────── │   data: { sessions, library, ... } }│
 │ settings   (préférences)  │ import  └─────────────────────────────────────┘
 └───────────────────────────┘ (validation + fusion ou remplacement)
```

### 9.1 `src/db/db.ts`

```ts
import Dexie, { type Table } from 'dexie';
import type { Paper } from '../sources/types';
import type { Settings } from '../config';
import type { Session } from '../workflow/types';

export interface Conversation { id?: number; title: string; createdAt: number;
  messages: { role: 'user' | 'assistant'; content: string; papers?: Paper[] }[] }
export interface SavedPaper extends Paper { savedAt: number; tags: string[]; note?: string }

class SciDB extends Dexie {
  sessions!: Table<Session, number>;
  library!: Table<SavedPaper, string>;
  conversations!: Table<Conversation, number>;
  settings!: Table<{ key: string; value: Settings }, string>;
  constructor() {
    super('scibot');
    this.version(1).stores({
      sessions: '++id, createdAt, phase',
      library: 'id, savedAt, year, source, *tags',
      conversations: '++id, createdAt',
      settings: 'key',
    });
  }
}
export const db = new SciDB();

/** Demande au navigateur de ne pas purger la base automatiquement (best effort). */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return { persisted: false, usage: 0, quota: 0 };
  const persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { persisted, usage, quota };
}

export const toBibTeX = (p: Paper) => `@${p.type === 'book' ? 'book' : 'article'}{${(p.authors[0]?.split(' ').pop() ?? 'anon')}${p.year ?? ''},
  title = {${p.title}},
  author = {${p.authors.join(' and ')}},
  year = {${p.year ?? ''}},
  ${p.type === 'book' ? `publisher = {${p.publisher ?? ''}}` : `journal = {${p.venue ?? ''}}`},${p.doi ? `\n  doi = {${p.doi}},` : ''}${p.isbn ? `\n  isbn = {${p.isbn}},` : ''}
  url = {${p.pdfUrl ?? p.url}}
}`;
```

### 9.2 Format du fichier de sauvegarde

```jsonc
{
  "format": "scibot-backup",
  "schemaVersion": 1,
  "appVersion": "0.3.0",
  "exportedAt": "2026-10-04T11:39:00.000Z",
  "tables": ["sessions", "library", "conversations", "settings"],
  "counts": { "sessions": 4, "library": 37, "conversations": 2, "settings": 1 },
  "checksum": "sha256:9f2c…",          // empreinte de "data" (contrôle d'intégrité)
  "data": {
    "sessions": [ { "id": 1, "createdAt": 1791107940000, "phase": "done", "brief": { … }, "output": "# État de l'art…" } ],
    "library": [ { "id": "10.1016/j.tourman.2019.104009", "title": "…", "isOA": true, "tags": ["surtourisme"] } ],
    "conversations": [],
    "settings": [ { "key": "main", "value": { "provider": "ollama", "model": "qwen2.5:7b", "email": "" } } ]
  }
}
```

### 9.3 `src/db/backup.ts` — export et import

```ts
import { db } from './db';

export const BACKUP_FORMAT = 'scibot-backup';
export const SCHEMA_VERSION = 1;
const TABLES = ['sessions', 'library', 'conversations', 'settings'] as const;
type TableName = typeof TABLES[number];
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;   // 50 Mo

export interface ExportOptions {
  tables?: TableName[];          // export partiel possible
  includeSettings?: boolean;     // défaut false : ne pas diffuser e-mail / préférences
  stripOutputs?: boolean;        // alléger : supprime le Markdown produit des sessions
}
export interface ImportReport { added: Record<string, number>; updated: Record<string, number>; skipped: number; warnings: string[] }
export type ImportMode = 'merge' | 'replace';

/* ---------- utilitaires ---------- */
// JSON canonique (clés triées) → l'empreinte est stable quel que soit l'ordre des clés
const canonical = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(',')}}`
  : JSON.stringify(v ?? null);

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return 'sha256:' + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- EXPORT ---------- */
export async function exportDatabase(opts: ExportOptions = {}) {
  const tables = (opts.tables ?? [...TABLES]).filter(t => t !== 'settings' || opts.includeSettings);
  const data: Record<string, unknown[]> = {};
  await db.transaction('r', tables.map(t => db.table(t)), async () => {
    for (const t of tables) data[t] = await db.table(t).toArray();
  });
  if (opts.stripOutputs && data.sessions) data.sessions = (data.sessions as any[]).map(({ output, ...rest }) => rest);

  const payload = {
    format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, appVersion: import.meta.env.VITE_APP_VERSION ?? 'dev',
    exportedAt: new Date().toISOString(), tables,
    counts: Object.fromEntries(tables.map(t => [t, data[t].length])),
    checksum: await sha256(canonical(data)), data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `scibot-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return payload.counts;
}

/* ---------- VALIDATION ---------- */
const isStr = (v: unknown) => typeof v === 'string';
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const validators: Record<TableName, (r: any) => boolean> = {
  sessions: r => r && isNum(r.createdAt) && isStr(r.phase) && r.brief && isStr(r.brief.text),
  library: r => r && isStr(r.id) && isStr(r.title) && Array.isArray(r.authors) && isStr(r.url),
  conversations: r => r && isNum(r.createdAt) && Array.isArray(r.messages),
  settings: r => r && isStr(r.key) && typeof r.value === 'object',
};

/** Neutralise les URL dangereuses (javascript:, data:) qui pourraient être injectées dans un fichier modifié. */
const safeUrl = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : undefined);
function sanitize(t: TableName, r: any) {
  if (t === 'library') return { ...r, url: safeUrl(r.url) ?? '#', pdfUrl: safeUrl(r.pdfUrl), tags: Array.isArray(r.tags) ? r.tags.filter(isStr) : [] };
  if (t === 'sessions') {
    const clean = structuredClone(r);            // copie « plate » : aucune fonction ni prototype exotique
    const fix = (ps: any[] = []) => ps.map(p => ({ ...p, url: safeUrl(p.url) ?? '#', pdfUrl: safeUrl(p.pdfUrl) }));
    return { ...clean, explore: clean.explore ? { ...clean.explore, corpus: fix(clean.explore.corpus) } : clean.explore };
  }
  return r;
}

/** Migration des anciennes versions du schéma (à compléter au fil des versions). */
function migrate(payload: any): any {
  let p = payload;
  // if (p.schemaVersion === 1) { …transformations…; p.schemaVersion = 2; }
  return p;
}

/* ---------- IMPORT ---------- */
export async function readBackupFile(file: File) {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('Fichier trop volumineux (> 50 Mo)');
  let payload: any;
  try { payload = JSON.parse(await file.text()); } catch { throw new Error('Le fichier n\'est pas un JSON valide'); }
  if (payload?.format !== BACKUP_FORMAT) throw new Error('Ce fichier n\'est pas une sauvegarde SciBot');
  if (!isNum(payload.schemaVersion) || payload.schemaVersion > SCHEMA_VERSION)
    throw new Error(`Version de schéma ${payload.schemaVersion} non prise en charge (max ${SCHEMA_VERSION}) : mettez l'application à jour`);
  const integrity = (await sha256(canonical(payload.data))) === payload.checksum;
  return { payload: migrate(payload), integrity };   // aperçu avant import
}

export async function importDatabase(payload: any, mode: ImportMode = 'merge'): Promise<ImportReport> {
  const report: ImportReport = { added: {}, updated: {}, skipped: 0, warnings: [] };
  const tables = TABLES.filter(t => Array.isArray(payload.data?.[t]));

  await db.transaction('rw', tables.map(t => db.table(t)), async () => {   // tout ou rien
    for (const t of tables) {
      const rows = (payload.data[t] as any[]).filter(r => {
        const ok = validators[t](r); if (!ok) report.skipped++; return ok;
      }).map(r => sanitize(t, r));
      const table = db.table(t);
      report.added[t] = 0; report.updated[t] = 0;

      if (mode === 'replace') { await table.clear(); await table.bulkPut(rows); report.added[t] = rows.length; continue; }

      // Fusion
      for (const r of rows) {
        if (t === 'sessions' || t === 'conversations') {
          // clés auto-incrémentées : on dédoublonne par createdAt pour éviter d'écraser des données locales
          const dup = await table.where('createdAt').equals(r.createdAt).first();
          if (dup) { report.updated[t]++; await table.put({ ...r, id: dup.id }); }
          else { const { id, ...rest } = r; await table.add(rest); report.added[t]++; }
        } else if (t === 'library') {
          const cur = await table.get(r.id);
          if (cur) {                                // fusion fine : tags unis, note la plus récente
            await table.put({ ...cur, ...r, tags: [...new Set([...(cur.tags ?? []), ...r.tags])],
              note: (r.savedAt ?? 0) > (cur.savedAt ?? 0) ? r.note : cur.note });
            report.updated[t]++;
          } else { await table.add(r); report.added[t]++; }
        } else {                                    // settings : ne remplace que si absent
          if (await table.get(r.key)) { report.warnings.push('Réglages locaux conservés'); }
          else { await table.add(r); report.added[t]++; }
        }
      }
    }
  });
  return report;
}

/* ---------- Effacement complet (avant de quitter un poste partagé) ---------- */
export async function wipeDatabase() { await Promise.all(TABLES.map(t => db.table(t).clear())); }
```

### 9.4 Interface de gestion — `src/components/DataManager.tsx`

```tsx
import { useEffect, useRef, useState } from 'react';
import { exportDatabase, readBackupFile, importDatabase, wipeDatabase, type ImportMode, type ImportReport } from '../db/backup';
import { requestPersistence } from '../db/db';

const fmt = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} Mo` : `${Math.round(b / 1e3)} ko`);

export function DataManager({ onChanged }: { onChanged?: () => void }) {
  const [info, setInfo] = useState<{ persisted: boolean; usage: number; quota: number }>();
  const [preview, setPreview] = useState<{ payload: any; integrity: boolean; name: string }>();
  const [mode, setMode] = useState<ImportMode>('merge');
  const [withSettings, setWithSettings] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { requestPersistence().then(setInfo); }, []);

  const doExport = async () => {
    const counts = await exportDatabase({ includeSettings: withSettings });
    setMsg(`Export : ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  };
  const onFile = async (f?: File) => {
    if (!f) return; setMsg('');
    try { setPreview({ ...(await readBackupFile(f)), name: f.name }); } catch (e: any) { setMsg(e.message); }
    if (fileRef.current) fileRef.current.value = '';
  };
  const doImport = async () => {
    if (!preview) return;
    if (mode === 'replace' && !confirm('Remplacer TOUTES les données locales par celles du fichier ?')) return;
    const r: ImportReport = await importDatabase(preview.payload, mode);
    setMsg(`Import terminé : ajoutés ${JSON.stringify(r.added)}, mis à jour ${JSON.stringify(r.updated)}, ignorés ${r.skipped}${r.warnings.length ? ' · ' + r.warnings.join(' ; ') : ''}`);
    setPreview(undefined); onChanged?.();
  };

  return (
    <section className="data-manager">
      <h3>Données locales</h3>
      {info && <p className="hint">{fmt(info.usage)} utilisés · stockage {info.persisted ? 'persistant' : 'non persistant (risque de purge : exportez régulièrement)'}</p>}

      <button onClick={doExport}>Exporter en JSON</button>
      <label><input type="checkbox" checked={withSettings} onChange={e => setWithSettings(e.target.checked)} /> inclure les réglages (e-mail, modèle)</label>

      <button onClick={() => fileRef.current?.click()}>Importer un JSON…</button>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={e => onFile(e.target.files?.[0])} />

      {preview && (
        <div className="import-preview">
          <p><b>{preview.name}</b> · exporté le {new Date(preview.payload.exportedAt).toLocaleString('fr-FR')}</p>
          <p>{Object.entries(preview.payload.counts ?? {}).map(([k, n]) => `${k} : ${n}`).join(' · ')}</p>
          {!preview.integrity && <p className="err">Empreinte SHA-256 différente : le fichier a été modifié ou corrompu. Import possible, avec validation de chaque entrée.</p>}
          <label><input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} /> Fusionner avec mes données</label>
          <label><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Remplacer mes données</label>
          <div className="row"><button className="primary" onClick={doImport}>Confirmer l'import</button>
            <button onClick={() => setPreview(undefined)}>Annuler</button></div>
        </div>)}

      <button className="danger" onClick={async () => {
        if (confirm('Effacer toutes les données SciBot de ce navigateur ? Pensez à exporter avant.')) { await wipeDatabase(); onChanged?.(); setMsg('Base effacée'); }
      }}>Effacer la base locale</button>
      {msg && <p className="hint">{msg}</p>}
    </section>
  );
}
```

À placer en bas de la barre latérale, dans `Settings.tsx` : `<DataManager />`.

Styles :

```css
.data-manager { border-top: 1px solid #8884; padding-top: .8rem; display: flex; flex-direction: column; gap: .5rem; }
.import-preview { border: 1px solid #2563eb; border-radius: 8px; padding: .6rem; font-size: .9em; }
.danger { color: crimson; border: 1px solid crimson; background: none; border-radius: 6px; padding: .4rem; }
```

### 9.5 Sécurité et portabilité

| Risque | Réponse |
|---|---|
| Purge du cache par le navigateur | `navigator.storage.persist()` + indicateur ; export JSON régulier |
| Fichier corrompu ou modifié | Contrôle `format`, `schemaVersion`, empreinte SHA-256, validation entrée par entrée |
| Injection (liens `javascript:`, HTML) | URL limitées à `http(s)` ; `react-markdown` n'exécute pas de HTML brut par défaut (ne pas ajouter `rehype-raw`) |
| Import partiel en cas d'erreur | Transaction Dexie `rw` : tout ou rien |
| Données personnelles dans l'export | Réglages (e-mail) exclus par défaut, case à cocher explicite |
| Poste partagé (salle de classe) | Bouton « Effacer la base locale » |
| Évolution du schéma | `schemaVersion` + fonction `migrate()` ; refus des versions plus récentes que l'application |
| Fichiers volumineux | Limite de 50 Mo à l'import, option `stripOutputs` à l'export |

Pour chiffrer les sauvegardes (option), on peut chiffrer `data` en AES-GCM avec une clé dérivée d'un mot de passe (`crypto.subtle.deriveKey` + PBKDF2, 310 000 itérations) et ajouter `"encrypted": true, "salt", "iv"` à l'en-tête.

## 9 bis. Sorties Markdown — `src/output/markdown.ts`

```ts
import type { Paper } from '../sources/types';

const authors = (p: Paper) => p.authors.length > 3 ? `${p.authors.slice(0, 3).join(', ')} et al.` : p.authors.join(', ') || 'Anonyme';
const access = (p: Paper) => (p.isOA ? '🔓 Accès libre' : '🔒 Accès restreint');   // remplacer par [OA]/[Paywall] si besoin
const link = (p: Paper) => p.pdfUrl ?? (p.doi ? `https://doi.org/${p.doi}` : p.url);

/** Notice bibliographique au format proche de la norme ISO 690 */
export const cite = (p: Paper) => p.type === 'book'
  ? `${authors(p)}, *${p.title}*, ${p.publisher ?? 's.l.'}, ${p.year ?? 's.d.'}${p.isbn ? `, ISBN ${p.isbn}` : ''}.`
  : `${authors(p)}, « ${p.title} », ${p.venue ? `*${p.venue}*, ` : ''}${p.year ?? 's.d.'}${p.doi ? `, DOI ${p.doi}` : ''}.`;

/** Bibliographie numérotée en fin d'état de l'art (modes 1 et 2) */
export function bibliography(ps: Paper[]) {
  return `## Bibliographie\n\n` + ps.map((p, i) => `${i + 1}. ${cite(p)} [${access(p)}](${link(p)})`).join('\n');
}

/** Mode 3 : sitographie brute, groupée par type, sans rédaction */
export function sitography(question: string, ps: Paper[]) {
  const groups: Record<string, Paper[]> = {};
  for (const p of ps) (groups[p.type ?? 'other'] ??= []).push(p);
  const label: Record<string, string> = { book: 'Ouvrages', chapter: 'Chapitres', article: 'Articles',
    preprint: 'Prépublications', thesis: 'Thèses', other: 'Autres' };
  const date = new Date().toLocaleDateString('fr-FR');
  let md = `# Sitographie : ${question}\n\n> ${ps.length} références · générée le ${date} · sources : OpenAlex, arXiv, HAL, Crossref, Open Library\n\n`;
  for (const [k, list] of Object.entries(groups)) {
    md += `## ${label[k] ?? k}\n\n`;
    list.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
        .forEach(p => { md += `- ${cite(p)} — ${access(p)} — <${link(p)}> (consulté le ${date})\n`; });
    md += '\n';
  }
  return md;
}

export function downloadMd(content: string, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  a.download = `${name.replace(/[^\p{L}\p{N}-]+/gu, '_')}.md`; a.click(); URL.revokeObjectURL(a.href);
}
```

## 10. Interface

### `src/components/Settings.tsx`

```tsx
import { useEffect, useState } from 'react';
import { listModels } from '../llm/client';
import type { Settings as S } from '../config';

export function Settings({ value, onChange }: { value: S; onChange: (s: S) => void }) {
  const [models, setModels] = useState<string[]>([]); const [err, setErr] = useState('');
  useEffect(() => {
    listModels(value.provider).then(m => { setModels(m); setErr('');
      if (!m.includes(value.model) && m[0]) onChange({ ...value, model: m[0] }); })
      .catch(e => { setModels([]); setErr(String(e.message)); });
  }, [value.provider]);
  return (
    <aside className="settings">
      <label>Fournisseur
        <select value={value.provider} onChange={e => onChange({ ...value, provider: e.target.value as S['provider'] })}>
          <option value="ollama">Ollama (:11434)</option><option value="lmstudio">LM Studio (:1234)</option>
        </select></label>
      <label>Modèle
        <select value={value.model} onChange={e => onChange({ ...value, model: e.target.value })}>
          {models.map(m => <option key={m}>{m}</option>)}</select></label>
      {err && <p className="err">{err}</p>}
      <label>Sortie
        <select value={value.mode} onChange={e => onChange({ ...value, mode: e.target.value as S['mode'] })}>
          <option value="complet">1. État de l'art complet commenté (OA + paywall)</option>
          <option value="oa">2. État de l'art en libre accès</option>
          <option value="sitographie">3. Sitographie brute</option>
        </select></label>
      <label>E-mail (OpenAlex / Unpaywall)
        <input value={value.email} onChange={e => onChange({ ...value, email: e.target.value })} /></label>
      <fieldset><legend>Sources</legend>
        {(['openalex', 'arxiv', 'hal'] as const).map(k => (
          <label key={k}><input type="checkbox" checked={value.sources[k]}
            onChange={e => onChange({ ...value, sources: { ...value.sources, [k]: e.target.checked } })} /> {k}</label>))}
      </fieldset>
      <label>Résultats / source : {value.maxPerSource}
        <input type="range" min={3} max={25} value={value.maxPerSource}
          onChange={e => onChange({ ...value, maxPerSource: +e.target.value })} /></label>
    </aside>
  );
}
```

### `src/components/ResultCard.tsx`

```tsx
import type { Paper } from '../sources/types';
import { db, toBibTeX } from '../db/db';

export function ResultCard({ p, n }: { p: Paper; n: number }) {
  return (
    <article className="card">
      <h4>[{n}] <a href={p.url} target="_blank" rel="noreferrer">{p.title}</a></h4>
      <p className="meta">{p.authors.slice(0, 4).join(', ')}{p.authors.length > 4 ? ' et al.' : ''} · {p.year ?? 's.d.'} · {p.venue} · <span className={`tag ${p.source}`}>{p.source}</span>
        {p.citations != null && ` · ${p.citations} citations`}</p>
      {p.abstract && <details><summary>Résumé</summary><p>{p.abstract}</p></details>}
      <div className="actions">
        {p.pdfUrl && <a href={p.pdfUrl} target="_blank" rel="noreferrer">PDF</a>}
        <button onClick={() => db.library.put({ ...p, savedAt: Date.now(), tags: [] })}>Enregistrer</button>
        <button onClick={() => navigator.clipboard.writeText(toBibTeX(p))}>BibTeX</button>
      </div>
    </article>
  );
}
```

### `src/components/ChatPanel.tsx`

```tsx
import { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { runAgent, type Step } from '../agent/agent';
import type { Paper } from '../sources/types';
import type { Settings } from '../config';
import { db, type Conversation } from '../db/db';
import { ResultCard } from './ResultCard';
import { downloadMd } from '../output/markdown';

export function ChatPanel({ settings }: { settings: Settings }) {
  const [conv, setConv] = useState<Conversation>({ title: '', createdAt: Date.now(), messages: [] });
  const [input, setInput] = useState(''); const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false); const abort = useRef<AbortController>();

  async function send() {
    if (!input.trim() || !settings.model) return;
    const q = input.trim(); setInput(''); setBusy(true); setSteps([]);
    abort.current = new AbortController();
    let papers: Paper[] = []; let answer = '';
    const base = [...conv.messages, { role: 'user' as const, content: q }];
    const history = conv.messages.map(m => ({ role: m.role, content: m.content }));
    try {
      for await (const tok of runAgent(q, settings, history, abort.current.signal,
        st => setSteps(s => [...s, st]), p => (papers = p))) {
        answer += tok;
        setConv(c => ({ ...c, messages: [...base, { role: 'assistant', content: answer, papers }] }));
      }
    } catch (e: any) { answer += `\n\n> Erreur : ${e.message}`; }
    const final = { ...conv, title: conv.title || q.slice(0, 60), messages: [...base, { role: 'assistant' as const, content: answer, papers }] };
    final.id = await db.conversations.put(final); setConv(final); setBusy(false);
  }

  return (
    <main className="chat">
      {conv.messages.map((m, i) => (
        <section key={i} className={`msg ${m.role}`}>
          <ReactMarkdown>{m.content}</ReactMarkdown>
          {m.papers?.map((p, j) => <ResultCard key={p.id} p={p} n={j + 1} />)}
        </section>))}
      {busy && <ul className="steps">{steps.map((s, i) => <li key={i}><b>{s.kind}</b> {s.info}</li>)}</ul>}
      <form onSubmit={e => { e.preventDefault(); send(); }}>
        <textarea value={input} onChange={e => setInput(e.target.value)} placeholder="Ex. : impact du surtourisme sur les centres historiques européens depuis 2015"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        {busy ? <button type="button" onClick={() => abort.current?.abort()}>Stop</button> : <button>Rechercher</button>}
        <button type="button" disabled={!conv.messages.length} onClick={() => {
          const last = [...conv.messages].reverse().find(m => m.role === 'assistant');
          if (last) downloadMd(last.content, `${settings.mode}-${(conv.title || 'recherche').slice(0, 40)}`);
        }}>Exporter .md</button>
      </form>
    </main>
  );
}
```

### `src/App.tsx`

```tsx
import { useEffect, useState } from 'react';
import { Settings } from './components/Settings';
import { ChatPanel } from './components/ChatPanel';
import { DEFAULT_SETTINGS, type Settings as S } from './config';
import { db } from './db/db';

export default function App() {
  const [s, setS] = useState<S>(DEFAULT_SETTINGS);
  useEffect(() => { db.settings.get('main').then(r => r && setS({ ...DEFAULT_SETTINGS, ...r.value })); }, []);
  const update = (v: S) => { setS(v); db.settings.put({ key: 'main', value: v }); };
  return <div className="layout"><Settings value={s} onChange={update} /><ChatPanel settings={s} /></div>;
}
```

### `src/index.css` (minimal)

```css
:root { font-family: system-ui, sans-serif; color-scheme: light dark; }
.layout { display: grid; grid-template-columns: 280px 1fr; height: 100vh; }
.settings { padding: 1rem; border-right: 1px solid #8884; display: flex; flex-direction: column; gap: .8rem; }
.chat { display: flex; flex-direction: column; overflow-y: auto; padding: 1rem; gap: 1rem; }
.chat form { position: sticky; bottom: 0; display: flex; gap: .5rem; background: Canvas; padding-top: .5rem; }
.chat textarea { flex: 1; min-height: 3rem; }
.card { border: 1px solid #8884; border-radius: 8px; padding: .6rem .8rem; margin: .4rem 0; }
.meta { font-size: .85em; opacity: .75; }
.tag { padding: 0 .4em; border-radius: 4px; background: #8882; }
.err { color: crimson; font-size: .85em; }
```

## 10 bis. Les trois modes de sortie

| | 1. État de l'art complet | 2. État de l'art OA | 3. Sitographie brute |
|---|---|---|---|
| Sources | OpenAlex (sans filtre OA), HAL, arXiv, Crossref, Open Library | OpenAlex `is_oa`, HAL `openAccess_bool`, arXiv | Toutes, comme le mode 1 |
| Types | Articles, ouvrages, chapitres, thèses | Uniquement ce qui a un texte intégral libre | Tous, groupés par type |
| LLM | Plan + tri + rédaction commentée (20 réf. max) | Plan + tri + rédaction (12 réf. max) | Plan + tri uniquement, aucune rédaction |
| Paywall | Commenté d'après la notice/résumé, mention explicite | Exclu | Listé avec mention « Accès restreint » |
| Sortie | `# État de l'art commenté` + bibliographie ISO 690 | `# État de l'art en libre accès` + bibliographie avec liens PDF | `# Sitographie` : liste datée « consulté le » |

Exemple de sortie (mode 3) :

```markdown
# Sitographie : surtourisme et centres historiques

> 27 références · générée le 03/10/2026 · sources : OpenAlex, arXiv, HAL, Crossref, Open Library

## Ouvrages
- Dupont J., *Le tourisme urbain*, Armand Colin, 2021, ISBN … — 🔒 Accès restreint — <https://openlibrary.org/…> (consulté le 03/10/2026)

## Articles
- Martin A. et al., « Overtourism in heritage cities », *Tourism Management*, 2020, DOI … — 🔓 Accès libre — <https://…pdf> (consulté le 03/10/2026)
```

Limite assumée du mode 1 : un modèle local ne lit pas les ouvrages sous paywall ; pour un commentaire approfondi, l'utilisateur peut déposer ses propres PDF (phase RAG) qui seront alors traités comme sources de plein texte.

## 11. Feuille de route

| Phase | Contenu | Critère de validation |
|---|---|---|
| 1 | Squelette Vite, proxy, client LLM, liste des modèles | Le sélecteur affiche les modèles Ollama et LM Studio |
| 2 | Sources OpenAlex / arXiv / HAL + dédoublonnage | Une requête renvoie des résultats des 3 sources |
| 3 | Agent (plan → recherche → rerank → synthèse streamée) | Synthèse citée [n] cohérente avec les cartes |
| 4 | Base locale + export/import JSON + 3 modes de sortie Markdown, export `.md` / BibTeX (puis parcours en 3 étapes, partie 2) | Données conservées après rechargement |
| 5 (option RAG) | PDF.js pour extraire le texte des `pdfUrl`, découpage ~800 tokens, embeddings via `/v1/embeddings` (`nomic-embed-text` sous Ollama), stockage des vecteurs dans IndexedDB, similarité cosinus en JS | Questions-réponses sur un article enregistré |
| 6 (option) | Sources supplémentaires : Persée, CORE, DOAJ, Semantic Scholar ; export Zotero (RIS) | — |

## 12. Points d'attention

- **CORS** : le proxy Vite règle tout en local. Pour un build statique servi autrement, il faut un mini-proxy (ou `OLLAMA_ORIGINS` / option CORS de LM Studio) ; arXiv et certains PDF ne renvoient pas d'en-têtes CORS.
- **Modèles conseillés** : 7–14 B avec bon suivi d'instructions JSON (Qwen 2.5/3, Llama 3.1, Mistral Nemo). Fenêtre de contexte ≥ 8k : avec Ollama, régler `num_ctx` dans un Modelfile si la synthèse est tronquée.
- **Hallucinations** : le prompt impose de ne citer que les articles fournis ; on peut ajouter un contrôle qui supprime les `[n]` hors plage.
- **Politesse API** : renseigner l'e-mail (OpenAlex polite pool, Unpaywall obligatoire), limiter arXiv à 1 requête / 3 s.
- **Résumés OpenAlex** : fournis en index inversé, reconstruits par `fromInverted`.

---

# Partie 2 — Interface en trois étapes (consigne → quiz → production)

Cette partie **remplace** `ChatPanel.tsx` et `App.tsx` des sections 10 et 10 bis. Le parcours devient guidé : une machine à états pilote l'écran.

```
 ┌─────────────┐   exploration    ┌──────────────┐  réponses   ┌───────────────┐
 │ 1. CONSIGNE │ ───────────────► │ 2. QUIZ      │ ──────────► │ 3. PRODUCTION │
 │ texte libre │  (40-60 réf.)    │ généré depuis│  requêtes   │ .md streamé + │
 │ + type de   │                  │ les sources  │  affinées   │ export        │
 │ sortie      │ ◄─── modifier ── │              │ ◄─ revenir ─│               │
 └─────────────┘                  └──────────────┘             └───────────────┘
```

## 14. Modes de sortie révisés — `src/config.ts`

Les trois produits finaux, combinables avec un périmètre d'accès :

```ts
export type OutputMode = 'etat-art' | 'sitographie-commentee' | 'sitographie-seche';
export type AccessScope = 'tout' | 'oa';   // 'tout' = OA + paywall (ouvrages compris)

export interface Settings {
  provider: Provider; model: string; temperature: number; email: string;
  maxPerSource: number; mode: OutputMode; access: AccessScope;
  sources: { openalex: boolean; arxiv: boolean; hal: boolean };
}
export const DEFAULT_SETTINGS: Settings = {
  provider: 'ollama', model: '', temperature: 0.2, email: '', maxPerSource: 10,
  mode: 'etat-art', access: 'tout', sources: { openalex: true, arxiv: true, hal: true },
};
```

Dans `sources/index.ts`, remplacer `const oaOnly = s.mode === 'oa';` par `const oaOnly = s.access === 'oa';`.

| Combinaison | Équivaut à |
|---|---|
| `etat-art` + `tout` | ancien mode 1 (état de l'art complet commenté) |
| `etat-art` + `oa` | ancien mode 2 (état de l'art en accès libre) |
| `sitographie-commentee` | une notice + 2 à 4 lignes de commentaire par référence |
| `sitographie-seche` | ancien mode 3 (liste brute, aucune rédaction) |

## 15. Modèle de données du parcours — `src/workflow/types.ts`

```ts
import type { Paper } from '../sources/types';
import type { OutputMode, AccessScope } from '../config';

export type Phase = 'brief' | 'exploring' | 'quiz' | 'refining' | 'producing' | 'done';

export interface Brief { text: string; mode: OutputMode; access: AccessScope }

export interface QuizOption { id: string; label: string; hint?: string; refs?: number[] } // refs = index dans corpus
export interface QuizQuestion {
  id: string;
  kind: 'single' | 'multi' | 'range' | 'text';
  dimension: 'axe' | 'periode' | 'espace' | 'discipline' | 'type' | 'langue' | 'references' | 'niveau' | 'libre';
  question: string;
  options?: QuizOption[];
  min?: number; max?: number;              // pour 'range' (années)
}
export type Answers = Record<string, string[] | [number, number] | string>;

export interface Session {
  id?: number;
  createdAt: number;
  phase: Phase;
  brief: Brief;
  explore: { queries: string[]; corpus: Paper[]; stats: CorpusStats };
  quiz: QuizQuestion[];
  answers: Answers;
  refined?: { queries: string[]; yearFrom?: number; yearTo?: number; keepIds: string[]; excludeIds: string[]; focus: string };
  output?: string;                          // Markdown final
}

export interface CorpusStats {
  total: number; oa: number; byType: Record<string, number>; byDecade: Record<string, number>;
  byLang: Record<string, number>; topVenues: [string, number][]; yearMin?: number; yearMax?: number;
}
```

Les sessions sont stockées dans la table `sessions` de la base locale (section 9), ce qui permet de reprendre un parcours interrompu et de les inclure dans l'export JSON.

## 16. Logique de l'agent — `src/workflow/engine.ts`

```ts
import { chat, chatStream } from '../llm/client';
import { searchAll } from '../sources';
import type { Paper } from '../sources/types';
import type { Settings } from '../config';
import type { Brief, CorpusStats, QuizQuestion, Answers, Session } from './types';
import { PLANNER, SYNTH_COMPLET, SYNTH_OA } from '../agent/prompts';
import { QUIZ, REFINE, ANNOTATE } from './prompts';
import { bibliography, sitography, cite } from '../output/markdown';

const parseJson = <T,>(t: string, fb: T): T => { const m = t.match(/[\[{][\s\S]*[\]}]/); try { return m ? JSON.parse(m[0]) : fb; } catch { return fb; } };

/* ---------- Étape 1 : exploration large ---------- */
export async function explore(brief: Brief, s: Settings, signal: AbortSignal, log: (m: string) => void) {
  const plan = parseJson(await chat(s.provider, s.model,
    [{ role: 'system', content: PLANNER }, { role: 'user', content: brief.text }], 0, true), { queries: [brief.text] });
  log(`Requêtes : ${plan.queries.join(' · ')}`);
  const { papers, errors } = await searchAll(plan.queries, { ...s, access: brief.access }, { signal });
  errors.forEach(e => log(`⚠ ${e}`));
  log(`${papers.length} références trouvées`);
  return { queries: plan.queries, corpus: papers.slice(0, 60), stats: computeStats(papers) };
}

export function computeStats(ps: Paper[]): CorpusStats {
  const count = (f: (p: Paper) => string | undefined) => ps.reduce<Record<string, number>>((a, p) => { const k = f(p) ?? '?'; a[k] = (a[k] ?? 0) + 1; return a; }, {});
  const years = ps.map(p => p.year).filter(Boolean) as number[];
  return {
    total: ps.length, oa: ps.filter(p => p.isOA).length,
    byType: count(p => p.type), byLang: count(p => p.lang),
    byDecade: count(p => (p.year ? `${Math.floor(p.year / 10) * 10}s` : undefined)),
    topVenues: Object.entries(count(p => p.venue)).filter(([k]) => k !== '?').sort((a, b) => b[1] - a[1]).slice(0, 8),
    yearMin: years.length ? Math.min(...years) : undefined, yearMax: years.length ? Math.max(...years) : undefined,
  };
}

/* ---------- Étape 2 : quiz construit à partir du corpus ---------- */
export async function buildQuiz(brief: Brief, corpus: Paper[], stats: CorpusStats, s: Settings): Promise<QuizQuestion[]> {
  const digest = corpus.slice(0, 40).map((p, i) => `${i}. ${p.title} (${p.year ?? 's.d.'}, ${p.type}, ${p.lang ?? '?'})`).join('\n');
  const raw = await chat(s.provider, s.model, [
    { role: 'system', content: QUIZ },
    { role: 'user', content: `Consigne : ${brief.text}\n\nStatistiques : ${JSON.stringify(stats)}\n\nCorpus :\n${digest}` },
  ], 0.3, true);
  const llmQs = parseJson<{ questions: QuizQuestion[] }>(raw, { questions: [] }).questions
    .filter(q => q.question && (q.kind === 'text' || q.kind === 'range' || q.options?.length));

  // Questions déterministes toujours présentes (indépendantes du LLM)
  const fixed: QuizQuestion[] = [
    { id: 'periode', kind: 'range', dimension: 'periode', question: 'Quelle période de publication retenir ?',
      min: stats.yearMin ?? 1950, max: stats.yearMax ?? new Date().getFullYear() },
    { id: 'types', kind: 'multi', dimension: 'type', question: 'Quels types de documents garder ?',
      options: Object.entries(stats.byType).map(([k, n]) => ({ id: k, label: `${k} (${n})` })) },
    { id: 'refs', kind: 'multi', dimension: 'references',
      question: 'Parmi ces références trouvées, lesquelles correspondent le mieux à votre attente ? (elles serviront de « graines »)',
      options: corpus.slice(0, 12).map((p, i) => ({ id: String(i), label: `${p.title} (${p.year ?? 's.d.'})`, hint: p.authors.slice(0, 2).join(', ') })) },
    { id: 'libre', kind: 'text', dimension: 'libre', question: 'Une précision à ajouter ? (auteurs, terrain, notion, exclusions…)' },
  ];
  return [...llmQs.slice(0, 5), ...fixed];
}

/* ---------- Transition 2 → 3 : affinage ---------- */
export async function refine(session: Session, s: Settings, signal: AbortSignal, log: (m: string) => void) {
  const { brief, quiz, answers, explore: ex } = session;
  const readable = quiz.map(q => {
    const a = answers[q.id]; if (a == null || (Array.isArray(a) && !a.length)) return null;
    const val = q.kind === 'range' ? `${(a as number[])[0]}–${(a as number[])[1]}`
      : q.kind === 'text' ? a : (a as string[]).map(id => q.options?.find(o => o.id === id)?.label ?? id).join(' ; ');
    return `- ${q.question} → ${val}`;
  }).filter(Boolean).join('\n');

  const r = parseJson(await chat(s.provider, s.model, [
    { role: 'system', content: REFINE },
    { role: 'user', content: `Consigne initiale : ${brief.text}\nRequêtes initiales : ${ex.queries.join(' · ')}\n\nRéponses :\n${readable}` },
  ], 0, true), { queries: ex.queries, focus: brief.text });

  const [yFrom, yTo] = (answers.periode as [number, number]) ?? [];
  const seedIdx = ((answers.refs as string[]) ?? []).map(Number);
  const types = (answers.types as string[]) ?? [];
  log(`Requêtes affinées : ${r.queries.join(' · ')}`);

  const { papers } = await searchAll(r.queries, { ...s, access: brief.access, maxPerSource: s.maxPerSource }, { yearFrom: yFrom, signal });
  const seeds = seedIdx.map(i => ex.corpus[i]).filter(Boolean);
  const merged = dedupe([...seeds, ...papers, ...ex.corpus])
    .filter(p => !yFrom || !p.year || (p.year >= yFrom && p.year <= yTo))
    .filter(p => !types.length || types.includes(p.type ?? 'other'))
    .filter(p => brief.access === 'tout' || p.isOA);
  log(`${merged.length} références après affinage`);
  return { refined: { queries: r.queries, yearFrom: yFrom, yearTo: yTo, keepIds: seeds.map(p => p.id), excludeIds: [], focus: r.focus as string }, corpus: merged };
}

const dedupe = (ps: Paper[]) => { const m = new Map<string, Paper>(); ps.forEach(p => { const k = (p.doi ?? p.title).toLowerCase(); if (!m.has(k)) m.set(k, p); }); return [...m.values()]; };

/* ---------- Étape 3 : production Markdown ---------- */
export async function* produce(session: Session, corpus: Paper[], s: Settings, signal: AbortSignal) {
  const { brief, refined } = session;
  const focus = refined?.focus ?? brief.text;
  const top = rankForOutput(corpus, refined?.keepIds ?? []).slice(0, brief.mode === 'sitographie-seche' ? 60 : 20);

  if (brief.mode === 'sitographie-seche') { yield sitography(focus, top); return; }

  if (brief.mode === 'sitographie-commentee') {
    yield `# Sitographie commentée : ${focus}\n\n> ${top.length} références · ${new Date().toLocaleDateString('fr-FR')}\n\n`;
    for (const [i, p] of top.entries()) {                       // une annotation par référence, en flux
      yield `### ${i + 1}. ${cite(p)}\n${p.isOA ? '[Accès libre]' : '[Accès restreint]'} <${p.pdfUrl ?? (p.doi ? `https://doi.org/${p.doi}` : p.url)}>\n\n`;
      yield* chatStream(s.provider, s.model, [
        { role: 'system', content: ANNOTATE },
        { role: 'user', content: `Problématique : ${focus}\n\nRéférence : ${cite(p)}\nRésumé : ${p.abstract?.slice(0, 1500) ?? '(notice seule)'}` },
      ], 0.2, signal);
      yield '\n\n';
    }
    return;
  }

  // état de l'art
  const ctx = top.map((p, i) => `[${i + 1}] ${(p.type ?? 'article').toUpperCase()} · ${p.isOA ? 'OA' : 'PAYWALL'}\n${cite(p)}\n${p.abstract?.slice(0, 1200) ?? '(notice seule)'}`).join('\n\n');
  yield `# État de l'art${brief.access === 'oa' ? ' (accès libre)' : ''} : ${focus}\n\n`;
  yield* chatStream(s.provider, s.model, [
    { role: 'system', content: brief.access === 'oa' ? SYNTH_OA : SYNTH_COMPLET },
    { role: 'user', content: `Problématique affinée : ${focus}\n\nRéférences :\n${ctx}` },
  ], s.temperature, signal);
  yield `\n\n${bibliography(top)}`;
}

const rankForOutput = (ps: Paper[], keep: string[]) =>
  [...ps].sort((a, b) => Number(keep.includes(b.id)) - Number(keep.includes(a.id)) || (b.citations ?? 0) - (a.citations ?? 0));
```

## 17. Prompts du parcours — `src/workflow/prompts.ts`

```ts
export const QUIZ = `Tu aides un chercheur à préciser sa demande. À partir de la consigne et du corpus trouvé,
propose 3 à 5 questions de cadrage FONDÉES SUR LE CORPUS (thèmes réellement présents, controverses,
terrains, approches disciplinaires). Chaque option doit refléter des références du corpus (indiquer leurs index dans "refs").
Réponds UNIQUEMENT en JSON :
{"questions":[{"id":"q1","kind":"single|multi","dimension":"axe|espace|discipline|niveau|langue",
"question":"...","options":[{"id":"a","label":"...","hint":"≤ 12 mots","refs":[0,4]}]}]}
Règles : 3 à 6 options par question, libellés courts, en français, pas de question sur la période ni le type (déjà posées).`;

export const REFINE = `À partir de la consigne initiale et des réponses au quiz, produis UNIQUEMENT un JSON :
{"queries":["..."], "focus":"problématique reformulée en une phrase"}
- 3 à 4 requêtes de 3 à 6 mots, au moins une en anglais, qui intègrent les choix de l'utilisateur.`;

export const ANNOTATE = `Rédige en français 2 à 4 phrases de commentaire critique sur cette référence au regard de la problématique :
apport principal, méthode ou corpus, intérêt ou limite. Si seule la notice est disponible, commence par
"D'après la notice :" et reste prudent. Pas de titre, pas de liste, n'invente rien.`;
```

## 18. Composants d'interface

```
src/ui/
  Wizard.tsx         orchestre les phases + barre de progression
  StepBrief.tsx      étape 1
  StepQuiz.tsx       étape 2 (+ aperçu du corpus)
  StepOutput.tsx     étape 3 (aperçu Markdown, export)
  CorpusPreview.tsx  statistiques + liste repliable
  Stepper.tsx        fil d'Ariane 1-2-3
```

### `src/ui/Wizard.tsx`

```tsx
import { useRef, useState } from 'react';
import type { Settings } from '../config';
import type { Paper } from '../sources/types';
import type { Session, Brief, Answers } from '../workflow/types';
import { explore, buildQuiz, refine, produce } from '../workflow/engine';
import { db } from '../db/db';
import { Stepper } from './Stepper';
import { StepBrief } from './StepBrief';
import { StepQuiz } from './StepQuiz';
import { StepOutput } from './StepOutput';

const empty = (s: Settings): Session => ({ createdAt: Date.now(), phase: 'brief',
  brief: { text: '', mode: s.mode, access: s.access },
  explore: { queries: [], corpus: [], stats: { total: 0, oa: 0, byType: {}, byDecade: {}, byLang: {}, topVenues: [] } },
  quiz: [], answers: {} });

export function Wizard({ settings }: { settings: Settings }) {
  const [ses, setSes] = useState<Session>(() => empty(settings));
  const [logs, setLogs] = useState<string[]>([]);
  const [finalCorpus, setFinalCorpus] = useState<Paper[]>([]);
  const ctrl = useRef<AbortController>();
  const log = (m: string) => setLogs(l => [...l, m]);
  const save = async (s: Session) => { const id = await db.sessions.put(s); const n = { ...s, id }; setSes(n); return n; };
  const guard = async (fn: (sig: AbortSignal) => Promise<void>) => {
    ctrl.current = new AbortController();
    try { await fn(ctrl.current.signal); } catch (e: any) { if (e.name !== 'AbortError') log(`Erreur : ${e.message}`); }
  };

  /* 1 → 2 */
  const onBrief = (brief: Brief) => guard(async sig => {
    setLogs([]); let s = await save({ ...ses, brief, phase: 'exploring' });
    const ex = await explore(brief, settings, sig, log);
    log('Préparation du quiz…');
    const quiz = await buildQuiz(brief, ex.corpus, ex.stats, settings);
    await save({ ...s, explore: ex, quiz, phase: 'quiz' });
  });

  /* 2 → 3 */
  const onAnswers = (answers: Answers) => guard(async sig => {
    let s = await save({ ...ses, answers, phase: 'refining' });
    const { refined, corpus } = await refine(s, settings, sig, log);
    setFinalCorpus(corpus);
    s = await save({ ...s, refined, phase: 'producing', output: '' });
    let out = '';
    for await (const chunk of produce(s, corpus, settings, sig)) { out += chunk; setSes(x => ({ ...x, output: out })); }
    await save({ ...s, output: out, phase: 'done' });
  });

  const busy = ['exploring', 'refining', 'producing'].includes(ses.phase);
  return (
    <div className="wizard">
      <Stepper phase={ses.phase} onJump={p => !busy && setSes(x => ({ ...x, phase: p }))} />
      {busy && <div className="progress"><ul>{logs.map((l, i) => <li key={i}>{l}</li>)}</ul>
        <button onClick={() => ctrl.current?.abort()}>Annuler</button></div>}

      {ses.phase === 'brief' && <StepBrief initial={ses.brief} onSubmit={onBrief} />}
      {ses.phase === 'exploring' && <p className="hint">Exploration des sources…</p>}
      {ses.phase === 'quiz' && <StepQuiz session={ses} onSubmit={onAnswers}
        onBack={() => setSes(x => ({ ...x, phase: 'brief' }))} />}
      {(ses.phase === 'refining' || ses.phase === 'producing' || ses.phase === 'done') &&
        <StepOutput session={ses} corpus={finalCorpus} streaming={ses.phase !== 'done'}
          onBackToQuiz={() => setSes(x => ({ ...x, phase: 'quiz' }))}
          onNew={() => { setSes(empty(settings)); setLogs([]); }} />}
    </div>
  );
}
```

### `src/ui/Stepper.tsx`

```tsx
import type { Phase } from '../workflow/types';
const steps: { label: string; phases: Phase[]; target: Phase }[] = [
  { label: '1. Consigne', phases: ['brief', 'exploring'], target: 'brief' },
  { label: '2. Affinage', phases: ['quiz', 'refining'], target: 'quiz' },
  { label: '3. Production', phases: ['producing', 'done'], target: 'done' },
];
export function Stepper({ phase, onJump }: { phase: Phase; onJump: (p: Phase) => void }) {
  const cur = steps.findIndex(s => s.phases.includes(phase));
  return <nav className="stepper">{steps.map((s, i) =>
    <button key={s.label} className={i === cur ? 'active' : i < cur ? 'done' : ''}
      disabled={i > cur} onClick={() => onJump(s.target)}>{s.label}</button>)}</nav>;
}
```

### `src/ui/StepBrief.tsx` — étape 1

```tsx
import { useState } from 'react';
import type { Brief } from '../workflow/types';

const MODES = [
  { id: 'etat-art', title: "État de l'art", desc: 'Synthèse rédigée et problématisée, bibliographie finale' },
  { id: 'sitographie-commentee', title: 'Sitographie commentée', desc: 'Une notice + 2 à 4 phrases critiques par référence' },
  { id: 'sitographie-seche', title: 'Sitographie sèche', desc: 'Liste brute classée par type, sans rédaction' },
] as const;

export function StepBrief({ initial, onSubmit }: { initial: Brief; onSubmit: (b: Brief) => void }) {
  const [b, setB] = useState(initial);
  return (
    <form className="step" onSubmit={e => { e.preventDefault(); b.text.trim() && onSubmit(b); }}>
      <h2>Quelle est votre recherche ?</h2>
      <textarea rows={5} value={b.text} onChange={e => setB({ ...b, text: e.target.value })}
        placeholder="Ex. : Je prépare un cours sur le surtourisme dans les villes patrimoniales européennes ; je cherche les grands débats depuis les années 2000." />
      <h3>Livrable attendu</h3>
      <div className="cards">{MODES.map(m =>
        <label key={m.id} className={`choice ${b.mode === m.id ? 'on' : ''}`}>
          <input type="radio" name="mode" checked={b.mode === m.id} onChange={() => setB({ ...b, mode: m.id })} />
          <strong>{m.title}</strong><span>{m.desc}</span></label>)}</div>
      <h3>Périmètre d'accès</h3>
      <div className="seg">
        <label><input type="radio" checked={b.access === 'tout'} onChange={() => setB({ ...b, access: 'tout' })} /> Tout (y compris paywall et ouvrages)</label>
        <label><input type="radio" checked={b.access === 'oa'} onChange={() => setB({ ...b, access: 'oa' })} /> Accès libre uniquement</label>
      </div>
      <button className="primary">Lancer l'exploration</button>
    </form>
  );
}
```

### `src/ui/StepQuiz.tsx` — étape 2

```tsx
import { useState } from 'react';
import type { Session, Answers, QuizQuestion } from '../workflow/types';
import { CorpusPreview } from './CorpusPreview';

export function StepQuiz({ session, onSubmit, onBack }: { session: Session; onSubmit: (a: Answers) => void; onBack: () => void }) {
  const [ans, setAns] = useState<Answers>(session.answers);
  const set = (id: string, v: Answers[string]) => setAns(a => ({ ...a, [id]: v }));
  const toggle = (q: QuizQuestion, optId: string) => {
    const cur = (ans[q.id] as string[]) ?? [];
    set(q.id, q.kind === 'single' ? [optId] : cur.includes(optId) ? cur.filter(x => x !== optId) : [...cur, optId]);
  };
  return (
    <div className="step quiz-layout">
      <form onSubmit={e => { e.preventDefault(); onSubmit(ans); }}>
        <h2>Affinons votre demande</h2>
        <p className="hint">Questions construites à partir des {session.explore.stats.total} références trouvées. Toutes sont facultatives.</p>
        {session.quiz.map((q, n) => (
          <fieldset key={q.id} className="q">
            <legend><span className="badge">{q.dimension}</span> {n + 1}. {q.question}</legend>
            {q.kind === 'range' && <Range q={q} value={ans[q.id] as [number, number]} onChange={v => set(q.id, v)} />}
            {q.kind === 'text' && <textarea rows={2} value={(ans[q.id] as string) ?? ''} onChange={e => set(q.id, e.target.value)} />}
            {(q.kind === 'single' || q.kind === 'multi') && <div className="opts">{q.options!.map(o => {
              const on = ((ans[q.id] as string[]) ?? []).includes(o.id);
              return <button type="button" key={o.id} className={`opt ${on ? 'on' : ''}`} onClick={() => toggle(q, o.id)} title={o.hint}>
                {o.label}{o.refs?.length ? <small> · {o.refs.length} réf.</small> : null}</button>;
            })}</div>}
          </fieldset>))}
        <div className="row">
          <button type="button" onClick={onBack}>← Modifier la consigne</button>
          <button type="button" onClick={() => onSubmit({})}>Passer le quiz</button>
          <button className="primary">Produire le livrable →</button>
        </div>
      </form>
      <CorpusPreview stats={session.explore.stats} corpus={session.explore.corpus} queries={session.explore.queries} />
    </div>
  );
}

function Range({ q, value, onChange }: { q: QuizQuestion; value?: [number, number]; onChange: (v: [number, number]) => void }) {
  const [a, b] = value ?? [q.min!, q.max!];
  return <div className="range">
    <input type="number" min={q.min} max={b} value={a} onChange={e => onChange([+e.target.value, b])} /> –
    <input type="number" min={a} max={q.max} value={b} onChange={e => onChange([a, +e.target.value])} />
  </div>;
}
```

### `src/ui/CorpusPreview.tsx`

```tsx
import type { Paper } from '../sources/types';
import type { CorpusStats } from '../workflow/types';

export function CorpusPreview({ stats, corpus, queries }: { stats: CorpusStats; corpus: Paper[]; queries: string[] }) {
  const maxDec = Math.max(1, ...Object.values(stats.byDecade));
  return (
    <aside className="corpus">
      <h3>Corpus exploratoire</h3>
      <p>{stats.total} références · {stats.oa} en accès libre · {stats.yearMin ?? '?'}–{stats.yearMax ?? '?'}</p>
      <p className="hint">Requêtes : {queries.join(' · ')}</p>
      <h4>Par décennie</h4>
      {Object.entries(stats.byDecade).sort().map(([d, n]) =>
        <div key={d} className="bar"><span>{d}</span><i style={{ width: `${(n / maxDec) * 100}%` }} /><b>{n}</b></div>)}
      <h4>Par type</h4><p>{Object.entries(stats.byType).map(([k, n]) => `${k} ${n}`).join(' · ')}</p>
      <h4>Revues principales</h4><ol>{stats.topVenues.map(([v, n]) => <li key={v}>{v} ({n})</li>)}</ol>
      <details><summary>Voir les {corpus.length} références</summary>
        <ol className="mini">{corpus.map(p => <li key={p.id}>{p.title} <small>({p.year ?? 's.d.'}{p.isOA ? ', OA' : ''})</small></li>)}</ol>
      </details>
    </aside>
  );
}
```

### `src/ui/StepOutput.tsx` — étape 3

```tsx
import ReactMarkdown from 'react-markdown';
import { useState } from 'react';
import type { Session } from '../workflow/types';
import type { Paper } from '../sources/types';
import { downloadMd } from '../output/markdown';

export function StepOutput({ session, corpus, streaming, onBackToQuiz, onNew }:
  { session: Session; corpus: Paper[]; streaming: boolean; onBackToQuiz: () => void; onNew: () => void }) {
  const [raw, setRaw] = useState(false);
  const md = session.output ?? '';
  const name = `${session.brief.mode}-${(session.refined?.focus ?? session.brief.text).slice(0, 40)}`;
  return (
    <div className="step">
      <header className="row">
        <h2>{streaming ? 'Rédaction en cours…' : 'Livrable prêt'}</h2>
        <span className="hint">{corpus.length} références retenues · problématique : {session.refined?.focus}</span>
      </header>
      <div className="row">
        <button onClick={() => setRaw(r => !r)}>{raw ? 'Aperçu' : 'Markdown brut'}</button>
        <button disabled={streaming} onClick={() => navigator.clipboard.writeText(md)}>Copier</button>
        <button className="primary" disabled={streaming} onClick={() => downloadMd(md, name)}>Télécharger .md</button>
        <button disabled={streaming} onClick={onBackToQuiz}>← Réajuster le quiz</button>
        <button disabled={streaming} onClick={onNew}>Nouvelle recherche</button>
      </div>
      <article className="output">{raw ? <pre>{md}</pre> : <ReactMarkdown>{md}</ReactMarkdown>}</article>
    </div>
  );
}
```

### `src/App.tsx` (nouvelle version)

```tsx
import { useEffect, useState } from 'react';
import { Settings } from './components/Settings';
import { Wizard } from './ui/Wizard';
import { DEFAULT_SETTINGS, type Settings as S } from './config';
import { db } from './db/db';

export default function App() {
  const [s, setS] = useState<S>(DEFAULT_SETTINGS);
  useEffect(() => { db.settings.get('main').then(r => r && setS({ ...DEFAULT_SETTINGS, ...r.value })); }, []);
  const update = (v: S) => { setS(v); db.settings.put({ key: 'main', value: v }); };
  return <div className="layout"><Settings value={s} onChange={update} /><Wizard settings={s} /></div>;
}
```

Dans `Settings.tsx`, retirer le sélecteur « Sortie » : le livrable et le périmètre sont désormais choisis à l'étape 1.

### Styles complémentaires (`index.css`)

```css
.wizard { overflow-y: auto; padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; }
.stepper { display: flex; gap: .5rem; }
.stepper button { flex: 1; padding: .6rem; border-radius: 6px; border: 1px solid #8885; background: none; }
.stepper .active { background: #2563eb; color: #fff; } .stepper .done { border-color: #2563eb; }
.step { display: flex; flex-direction: column; gap: .8rem; max-width: 1100px; }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: .6rem; }
.choice { border: 1px solid #8885; border-radius: 8px; padding: .8rem; display: flex; flex-direction: column; gap: .3rem; cursor: pointer; }
.choice.on { border-color: #2563eb; box-shadow: 0 0 0 2px #2563eb40; } .choice input { display: none; }
.quiz-layout { display: grid; grid-template-columns: 1fr 320px; gap: 1.5rem; max-width: none; }
.q { border: 1px solid #8884; border-radius: 8px; padding: .8rem; }
.opts { display: flex; flex-wrap: wrap; gap: .4rem; }
.opt { border: 1px solid #8886; border-radius: 999px; padding: .35rem .8rem; background: none; cursor: pointer; text-align: left; }
.opt.on { background: #2563eb; color: #fff; border-color: #2563eb; }
.badge { font-size: .7em; text-transform: uppercase; background: #8882; padding: .1em .4em; border-radius: 4px; }
.corpus { position: sticky; top: 0; align-self: start; font-size: .9em; border-left: 1px solid #8884; padding-left: 1rem; }
.bar { display: grid; grid-template-columns: 4em 1fr 2em; align-items: center; gap: .4rem; }
.bar i { display: block; height: 8px; background: #2563eb; border-radius: 4px; }
.progress { border: 1px dashed #8886; border-radius: 8px; padding: .6rem 1rem; font-size: .9em; }
.output { border: 1px solid #8884; border-radius: 8px; padding: 1.2rem 1.6rem; line-height: 1.6; }
.output pre { white-space: pre-wrap; }
.row { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
.primary { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: .5rem 1rem; }
.hint { opacity: .7; font-size: .9em; }
@media (max-width: 900px) { .cards, .quiz-layout { grid-template-columns: 1fr; } }
```

## 19. Exemple de quiz généré

Consigne : « surtourisme dans les villes patrimoniales européennes, grands débats depuis 2000 ».

1. **[axe]** Quel angle privilégier ? → Gouvernance et régulation · Habitants et gentrification · Mesure de la capacité de charge · Plateformes de location (Airbnb)
2. **[espace]** Quels terrains ? → Venise · Barcelone · Dubrovnik · Comparaisons européennes
3. **[discipline]** Quelle approche ? → Géographie · Économie · Sociologie · Gestion du patrimoine
4. **[niveau]** Pour quel public ? → Recherche · Enseignement supérieur (BTS / licence) · Grand public
5. **[periode]** 2000 – 2026 (curseur)
6. **[type]** article (31) · ouvrage (9) · chapitre (6) · thèse (2)
7. **[references]** Cochez les références « graines » parmi les 12 premières
8. **[libre]** « Exclure les études hors Europe ; inclure Doxey et Butler »

## 20. Points de vigilance de l'interface

- **Robustesse du quiz** : si le JSON du LLM est invalide, les 4 questions déterministes (période, type, références, précision libre) suffisent à faire fonctionner l'étape 2.
- **Modèles légers** : avec moins de 7 B paramètres, réduire le corpus envoyé au quiz à 25 titres et demander 3 questions.
- **Sitographie commentée** : un appel LLM par référence (20 au maximum). C'est plus lent mais plus fiable qu'un appel unique, et le texte s'affiche au fur et à mesure.
- **Sauvegarde** : proposer un rappel d'export (par exemple après chaque livrable produit) tant que le stockage n'est pas persistant.
- **Reprise** : chaque changement de phase est enregistré dans IndexedDB (`sessions`). On peut ajouter une liste « Recherches récentes » dans la barre latérale avec `db.sessions.orderBy('createdAt').reverse()`.
- **Retour arrière** : depuis l'étape 3, « Réajuster le quiz » conserve les réponses et relance seulement l'affinage et la production, sans refaire l'exploration.
