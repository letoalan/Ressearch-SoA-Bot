import type { Paper } from '../sources/types';
import type { OutputMode, AccessScope } from '../config';

export type Phase = 'brief' | 'exploring' | 'quiz' | 'refining' | 'producing' | 'done';

export interface Brief {
  text: string;
  mode: OutputMode;
  access: AccessScope;
}

export interface QuizOption {
  id: string;
  label: string;
  hint?: string;
  refs?: number[]; // Index des références associées dans le corpus
}

export interface QuizQuestion {
  id: string;
  kind: 'single' | 'multi' | 'range' | 'text';
  dimension:
    | 'axe'
    | 'periode'
    | 'espace'
    | 'discipline'
    | 'type'
    | 'langue'
    | 'references'
    | 'niveau'
    | 'libre';
  question: string;
  options?: QuizOption[];
  min?: number;
  max?: number; // Pour le type 'range'
}

export type Answers = Record<string, string[] | [number, number] | string>;

export interface CorpusStats {
  total: number;
  oa: number;
  byType: Record<string, number>;
  byDecade: Record<string, number>;
  byLang: Record<string, number>;
  topVenues: [string, number][];
  yearMin?: number;
  yearMax?: number;
}

export interface Session {
  id?: number;
  createdAt: number;
  phase: Phase;
  brief: Brief;
  explore: {
    queries: string[];
    corpus: Paper[];
    stats: CorpusStats;
  };
  quiz: QuizQuestion[];
  answers: Answers;
  refined?: {
    queries: string[];
    yearFrom?: number;
    yearTo?: number;
    keepIds: string[];
    excludeIds: string[];
    focus: string;
  };
  output?: string; // Markdown produit
}
