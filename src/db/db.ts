import Dexie, { type Table } from 'dexie';
import type { Paper } from '../sources/types';
import type { Settings } from '../config';
import type { Session } from '../workflow/types';

export interface Conversation {
  id?: number;
  title: string;
  createdAt: number;
  messages: {
    role: 'user' | 'assistant';
    content: string;
    papers?: Paper[];
  }[];
}

export interface SavedPaper extends Paper {
  savedAt: number;
  tags: string[];
  note?: string;
}

export interface TelemetryEntry {
  id?: number;
  ts: number;
  phase: 'plan' | 'quiz' | 'refine' | 'synth' | 'annot';
  model: string;
  total_ms: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  ttft_ms?: number;
  tps_gen?: number;
  json_ok?: boolean;
  fallback_used?: boolean;
  refs_invalid?: number;
}

export class SciDB extends Dexie {
  sessions!: Table<Session, number>;
  library!: Table<SavedPaper, string>;
  conversations!: Table<Conversation, number>;
  settings!: Table<{ key: string; value: Settings }, string>;
  telemetry!: Table<TelemetryEntry, number>;

  constructor() {
    super('scibot');
    this.version(1).stores({
      sessions: '++id, createdAt, phase',
      library: 'id, savedAt, year, source, *tags',
      conversations: '++id, createdAt',
      settings: 'key',
    });
    this.version(2).stores({
      telemetry: '++id, ts, phase, model',
    });
  }
}

export const db = new SciDB();

/** Demande au navigateur d'accorder le statut de stockage persistant (best effort) */
export async function requestPersistence(): Promise<{
  persisted: boolean;
  usage: number;
  quota: number;
}> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return { persisted: false, usage: 0, quota: 0 };
  }
  const persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { persisted, usage, quota };
}

/** Formate une référence au standard BibTeX */
export const toBibTeX = (p: Paper): string => {
  const premierAuteur = p.authors?.[0]?.split(' ').pop() ?? 'anon';
  const cleBib = `${premierAuteur}${p.year ?? ''}`.replace(/[^a-zA-Z0-9]/g, '');
  const typeEntry = p.type === 'book' ? 'book' : 'article';

  return `@${typeEntry}{${cleBib},
  title = {${p.title}},
  author = {${(p.authors ?? []).join(' and ')}},
  year = {${p.year ?? ''}},
  ${p.type === 'book' ? `publisher = {${p.publisher ?? ''}}` : `journal = {${p.venue ?? ''}}`},${
    p.doi ? `\n  doi = {${p.doi}},` : ''
  }${p.isbn ? `\n  isbn = {${p.isbn}},` : ''}
  url = {${p.pdfUrl ?? p.url}}
}`;
};
