export interface Paper {
  id: string; // DOI normalisé ou identifiant source
  title: string;
  authors: string[];
  year?: number;
  abstract?: string;
  doi?: string;
  url: string; // page de l'article ou notice
  pdfUrl?: string; // texte intégral libre si trouvé
  venue?: string;
  citations?: number;
  source: 'openalex' | 'arxiv' | 'hal' | 'crossref' | 'openlibrary';
  lang?: string;
  type?: 'article' | 'book' | 'chapter' | 'preprint' | 'thesis' | 'other';
  isOA: boolean; // texte intégral en accès libre
  publisher?: string;
  isbn?: string;
}

export interface SearchOpts {
  limit: number;
  email?: string;
  yearFrom?: number;
  signal?: AbortSignal;
  oaOnly: boolean;
}
