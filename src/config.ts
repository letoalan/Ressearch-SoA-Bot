export type Provider = 'ollama' | 'lmstudio' | 'custom';
export type OutputMode = 'etat-art' | 'sitographie-commentee' | 'sitographie-seche';
export type AccessScope = 'tout' | 'oa';
export type SynthLength = 'court' | 'standard' | 'approfondi';

export interface Settings {
  provider: Provider;
  model: string;
  customEndpoint: string; // URL d'API compatible OpenAI (ex. Tunnel HTTPS, Groq, OpenRouter)
  apiKey: string; // Clé d'API optionnelle (stockée UNIQUEMENT dans IndexedDB local)
  temperature: number;
  email: string;
  maxPerSource: number;
  mode: OutputMode;
  access: AccessScope;
  synthLength: SynthLength; // Longueur cible de la synthèse (P3 - Plafonnement)
  sources: {
    openalex: boolean;
    arxiv: boolean;
    hal: boolean;
    crossref: boolean;
    openlibrary: boolean;
  };
}

export const SYNTH_LIMITS: Record<SynthLength, { maxTokens: number; wordsPrompt: string; label: string }> = {
  court: {
    maxTokens: 750,
    wordsPrompt: '400 à 600 mots (synthétique et direct)',
    label: 'Court (~600 tok · 500 mots)',
  },
  standard: {
    maxTokens: 1800,
    wordsPrompt: '900 à 1 300 mots (équilibré et structuré)',
    label: 'Standard (~1 500 tok · 1 100 mots)',
  },
  approfondi: {
    maxTokens: 3200,
    wordsPrompt: '1 800 à 2 500 mots (exhaustif et approfondi)',
    label: 'Approfondi (~3 000 tok · 2 000 mots)',
  },
};

export const DEFAULT_SETTINGS: Settings = {
  provider: 'ollama',
  model: '',
  customEndpoint: 'https://api.groq.com/openai/v1',
  apiKey: '',
  temperature: 0.25, // 0.25 recommandé pour limiter l'extrapolation et optimiser le décodage spéculatif MTP
  email: '',
  maxPerSource: 8,
  mode: 'etat-art',
  access: 'tout',
  synthLength: 'standard',
  sources: {
    openalex: true,
    arxiv: true,
    hal: true,
    crossref: true,
    openlibrary: true,
  },
};

export const baseUrl = (p: Provider): string => {
  if (p === 'ollama') return import.meta.env.DEV ? '/llm/ollama/v1' : 'http://localhost:11434/v1';
  if (p === 'lmstudio') return import.meta.env.DEV ? '/llm/lmstudio/v1' : 'http://localhost:1234/v1';
  return '';
};

export const getBaseUrlFromSettings = (s: Settings): string => {
  if (s.provider === 'custom') {
    return (s.customEndpoint || '').replace(/\/+$/, '');
  }
  return baseUrl(s.provider);
};
