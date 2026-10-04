import { getApiBaseUrl } from './endpoints';

/**
 * Recherche d'un PDF en accès libre pour un DOI donné via l'API Unpaywall.
 * Compatible mode local et GitHub Pages.
 */
export async function findOaPdf(doi: string, email: string): Promise<string | undefined> {
  if (!email || !doi) return undefined;
  try {
    const base = getApiBaseUrl('unpaywall');
    const r = await fetch(
      `${base}/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`
    );
    if (!r.ok) return undefined;
    const j = await r.json();
    return j.best_oa_location?.url_for_pdf ?? j.best_oa_location?.url ?? undefined;
  } catch {
    return undefined;
  }
}
