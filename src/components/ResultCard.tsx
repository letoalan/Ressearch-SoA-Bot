import { useState } from 'react';
import type { Paper } from '../sources/types';
import { db, toBibTeX } from '../db/db';

export function ResultCard({ p, n }: { p: Paper; n: number }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleCopyBib = async () => {
    await navigator.clipboard.writeText(toBibTeX(p));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    await db.library.put({
      ...p,
      savedAt: Date.now(),
      tags: [],
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <article className="paper-card">
      <div className="card-header">
        <span className="card-index">[{n}]</span>
        <h4 className="card-title">
          <a href={p.url} target="_blank" rel="noreferrer">
            {p.title}
          </a>
        </h4>
      </div>

      <div className="card-meta">
        <span>
          {p.authors.slice(0, 3).join(', ')}
          {p.authors.length > 3 ? ' et al.' : ''}
        </span>
        <span>·</span>
        <span>{p.year ?? 's.d.'}</span>
        {p.venue && (
          <>
            <span>·</span>
            <span className="venue">{p.venue}</span>
          </>
        )}
        <span className={`source-badge ${p.source}`}>{p.source}</span>
        <span className={`oa-badge ${p.isOA ? 'oa' : 'paywall'}`}>
          {p.isOA ? 'Libre accès' : 'Restreint'}
        </span>
        {p.citations != null && <span className="citation-count">{p.citations} citations</span>}
      </div>

      {p.abstract && (
        <details className="card-abstract">
          <summary>Consulter le résumé</summary>
          <p>{p.abstract}</p>
        </details>
      )}

      <div className="card-actions">
        {p.pdfUrl && (
          <a
            href={p.pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-action btn-pdf"
          >
            📄 PDF Libre
          </a>
        )}
        <button
          type="button"
          onClick={handleSave}
          className={`btn-action ${saved ? 'btn-saved' : ''}`}
        >
          {saved ? '✓ Enregistré' : '⭐ Sauvegarder'}
        </button>
        <button
          type="button"
          onClick={handleCopyBib}
          className="btn-action"
        >
          {copied ? '✓ BibTeX copié' : 'BibTeX'}
        </button>
      </div>
    </article>
  );
}
