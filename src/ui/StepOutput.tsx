import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Session } from '../workflow/types';
import type { Paper } from '../sources/types';
import { downloadMd } from '../output/markdown';

export function StepOutput({
  session,
  corpus,
  streaming,
  onBackToQuiz,
  onNew,
}: {
  session: Session;
  corpus: Paper[];
  streaming: boolean;
  onBackToQuiz: () => void;
  onNew: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const md = session.output ?? '';
  const focus = session.refined?.focus ?? session.brief.text;
  const fileName = `${session.brief.mode}-${focus.slice(0, 35)}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="output-container">
      <header className="output-header">
        <div className="header-status">
          <div className="status-title-row">
            {streaming && <span className="pulsing-dot" />}
            <h2>{streaming ? 'Rédaction de la synthèse en cours…' : 'Livrable finalisé'}</h2>
          </div>
          <p className="subtitle">
            <strong>{corpus.length}</strong> références retenues · Problématique affinée :{' '}
            <em>{focus}</em>
          </p>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowRaw(r => !r)}
          >
            {showRaw ? '👁️ Vue formatée' : '📄 Markdown brut'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={streaming || !md}
            onClick={handleCopy}
          >
            {copied ? '✓ Copié !' : '📋 Copier'}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={streaming || !md}
            onClick={() => downloadMd(md, fileName)}
          >
            💾 Télécharger .md
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={streaming}
            onClick={onBackToQuiz}
          >
            ← Réajuster le quiz
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={streaming}
            onClick={onNew}
          >
            + Nouvelle recherche
          </button>
        </div>
      </header>

      <article className="output-paper">
        {showRaw ? (
          <pre className="raw-markdown-view">{md}</pre>
        ) : (
          <div className="markdown-body">
            <ReactMarkdown>{md}</ReactMarkdown>
          </div>
        )}
      </article>
    </div>
  );
}
