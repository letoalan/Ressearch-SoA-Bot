import type { Paper } from '../sources/types';
import type { CorpusStats } from '../workflow/types';

export function CorpusPreview({
  stats,
  corpus,
  queries,
}: {
  stats: CorpusStats;
  corpus: Paper[];
  queries: string[];
}) {
  const maxDec = Math.max(1, ...Object.values(stats.byDecade));

  return (
    <aside className="corpus-panel">
      <div className="corpus-header">
        <h3>📊 Corpus exploratoire</h3>
        <div className="corpus-summary-pills">
          <span className="pill">{stats.total} références</span>
          <span className="pill pill-oa">{stats.oa} Open Access</span>
          {stats.yearMin && stats.yearMax && (
            <span className="pill">
              {stats.yearMin} – {stats.yearMax}
            </span>
          )}
        </div>
      </div>

      <div className="corpus-meta-box">
        <span className="meta-label">Requêtes formulées :</span>
        <ul className="queries-list">
          {queries.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ul>
      </div>

      {Object.keys(stats.byDecade).length > 0 && (
        <div className="corpus-stat-section">
          <h4>Répartition chronologique</h4>
          <div className="bars-container">
            {Object.entries(stats.byDecade)
              .sort()
              .map(([d, n]) => (
                <div key={d} className="stat-bar-row">
                  <span className="bar-label">{d}</span>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${Math.round((n / maxDec) * 100)}%` }}
                    />
                  </div>
                  <span className="bar-val">{n}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {Object.keys(stats.byType).length > 0 && (
        <div className="corpus-stat-section">
          <h4>Typologie des publications</h4>
          <div className="tags-cloud">
            {Object.entries(stats.byType).map(([k, n]) => (
              <span key={k} className="type-tag">
                {k}: <strong>{n}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      {stats.topVenues.length > 0 && (
        <div className="corpus-stat-section">
          <h4>Revues et éditeurs clés</h4>
          <ul className="venues-list">
            {stats.topVenues.map(([v, n]) => (
              <li key={v}>
                <span className="venue-title">{v}</span>
                <span className="venue-count">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="corpus-preview-details">
        <summary>Afficher les {corpus.length} premières références</summary>
        <ol className="mini-paper-list">
          {corpus.map(p => (
            <li key={p.id}>
              <a href={p.url} target="_blank" rel="noreferrer">
                {p.title}
              </a>{' '}
              <small>
                ({p.year ?? 's.d.'} · {p.source}
                {p.isOA ? ' · OA' : ''})
              </small>
            </li>
          ))}
        </ol>
      </details>
    </aside>
  );
}
