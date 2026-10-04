/**
 * Résolveur d'adresses d'APIs scientifiques.
 * - En mode développement local (DEV) : utilise le proxy Vite (/api/...) pour contourner tout CORS.
 * - En mode production statique (GitHub Pages) : bascule sur les URLs distantes directes.
 */
export function getApiBaseUrl(
  service: 'openalex' | 'arxiv' | 'hal' | 'crossref' | 'openlibrary' | 'unpaywall'
): string {
  if (import.meta.env.DEV) {
    return `/api/${service}`;
  }

  switch (service) {
    case 'openalex':
      return 'https://api.openalex.org';
    case 'arxiv':
      return 'https://export.arxiv.org';
    case 'hal':
      return 'https://api.archives-ouvertes.fr';
    case 'crossref':
      return 'https://api.crossref.org';
    case 'openlibrary':
      return 'https://openlibrary.org';
    case 'unpaywall':
      return 'https://api.unpaywall.org';
  }
}
