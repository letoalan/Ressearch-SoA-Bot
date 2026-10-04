import type { Paper } from '../sources/types';

const authors = (p: Paper): string => {
  if (!p.authors || !p.authors.length) return 'Anonyme';
  if (p.authors.length > 3) return `${p.authors.slice(0, 3).join(', ')} et al.`;
  return p.authors.join(', ');
};

const access = (p: Paper): string => (p.isOA ? '🔓 Accès libre' : '🔒 Accès restreint');

const link = (p: Paper): string => p.pdfUrl ?? (p.doi ? `https://doi.org/${p.doi}` : p.url);

/** Notice bibliographique formatée (proche norme ISO 690) */
export const cite = (p: Paper): string => {
  const annee = p.year ?? 's.d.';
  if (p.type === 'book') {
    const pub = p.publisher ?? 's.l.';
    const isbn = p.isbn ? `, ISBN ${p.isbn}` : '';
    return `${authors(p)}, *${p.title}*, ${pub}, ${annee}${isbn}.`;
  }
  const journal = p.venue ? `*${p.venue}*, ` : '';
  const doi = p.doi ? `, DOI ${p.doi}` : '';
  return `${authors(p)}, « ${p.title} », ${journal}${annee}${doi}.`;
};

/** Bibliographie numérotée en fin d'état de l'art */
export function bibliography(ps: Paper[]): string {
  if (!ps.length) return '';
  return (
    `## Bibliographie\n\n` +
    ps.map((p, i) => `${i + 1}. ${cite(p)} [${access(p)}](${link(p)})`).join('\n')
  );
}

/** Sitographie groupée par type, sans rédaction LLM */
export function sitography(question: string, ps: Paper[]): string {
  const groups: Record<string, Paper[]> = {};
  for (const p of ps) {
    (groups[p.type ?? 'other'] ??= []).push(p);
  }

  const label: Record<string, string> = {
    book: 'Ouvrages',
    chapter: 'Chapitres',
    article: 'Articles',
    preprint: 'Prépublications',
    thesis: 'Thèses',
    other: 'Autres documents',
  };

  const date = new Date().toLocaleDateString('fr-FR');
  let md = `# Sitographie : ${question}\n\n> ${ps.length} références · générée le ${date} · sources : OpenAlex, arXiv, HAL, Crossref, Open Library\n\n`;

  for (const [k, list] of Object.entries(groups)) {
    md += `## ${label[k] ?? k}\n\n`;
    list
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
      .forEach(p => {
        md += `- ${cite(p)} — ${access(p)} — <${link(p)}> (consulté le ${date})\n`;
      });
    md += '\n';
  }
  return md;
}

/** Téléchargement direct d'un fichier Markdown dans le navigateur */
export function downloadMd(content: string, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  a.download = `${name.replace(/[^\p{L}\p{N}-]+/gu, '_')}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
