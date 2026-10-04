import { useEffect, useState, useCallback } from 'react';
import { listModels } from '../llm/client';
import { SYNTH_LIMITS, type Settings as S } from '../config';
import { DataManager } from './DataManager';

export function Settings({
  value,
  onChange,
  onReload,
}: {
  value: S;
  onChange: (s: S) => void;
  onReload?: () => void;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const isLocalHttpProvider = value.provider === 'ollama' || value.provider === 'lmstudio';
  const hasMixedContentRisk = isHttps && isLocalHttpProvider;

  const fetchModels = useCallback(() => {
    let active = true;
    setLoadingModels(true);
    setErr('');

    listModels(value)
      .then(m => {
        if (!active) return;
        setModels(m);
        setLoadingModels(false);
        if (m.length > 0 && (!value.model || !m.includes(value.model))) {
          onChange({ ...value, model: m[0] });
        }
      })
      .catch(() => {
        if (!active) return;
        setModels([]);
        setLoadingModels(false);
        if (hasMixedContentRisk) {
          setErr(
            'Navigateur HTTPS : le navigateur bloque http://localhost. Utilisez un tunnel HTTPS ou une API distante ci-dessous.'
          );
        } else if (value.provider === 'ollama') {
          setErr(
            'Ollama non détecté sur http://localhost:11434. Lancez "ollama serve" ou vérifiez vos réglages.'
          );
        } else if (value.provider === 'lmstudio') {
          setErr(
            'LM Studio non détecté sur http://localhost:1234. Activez "Start Server" dans LM Studio.'
          );
        } else {
          setErr('Impossible de joindre le endpoint spécifié. Vérifiez l’URL et la clé d’API.');
        }
      });

    return () => {
      active = false;
    };
  }, [value, hasMixedContentRisk, onChange]);

  useEffect(() => {
    const cancel = fetchModels();
    return cancel;
  }, [value.provider, value.customEndpoint, value.apiKey]);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo">🔬</div>
        <div className="brand-text">
          <h1>SciBot</h1>
          <span className="version-tag">V2 · Local & GitHub Pages</span>
        </div>
      </div>

      <div className="settings-scroll">
        <section className="settings-section">
          <div className="section-title">
            <span>🧠 Moteur d'Inférence LLM</span>
          </div>

          <label className="field-label">
            Fournisseur
            <select
              value={value.provider}
              onChange={e => {
                const nextProvider = e.target.value as S['provider'];
                onChange({
                  ...value,
                  provider: nextProvider,
                  model: '',
                });
              }}
            >
              <option value="ollama">Ollama local (:11434)</option>
              <option value="lmstudio">LM Studio local (:1234)</option>
              <option value="custom">API distante / Tunnel HTTPS</option>
            </select>
          </label>

          {hasMixedContentRisk && (
            <div className="notice-box warning">
              <strong>⚠️ Alerte Connexion HTTPS :</strong> Les navigateurs bloquent les appels directs
              vers <code>http://localhost</code> depuis un site HTTPS (GitHub Pages).
              <br />
              <small>
                Solutions : passez en mode <em>API distante / Tunnel HTTPS</em> (via Cloudflare Tunnel
                ou Groq/OpenRouter), ou lancez l'application en local avec <code>npm run dev</code>.
              </small>
            </div>
          )}

          {value.provider === 'custom' && (
            <>
              <label className="field-label">
                URL Endpoint (OpenAI-compatible)
                <input
                  type="text"
                  value={value.customEndpoint}
                  placeholder="https://api.groq.com/openai/v1"
                  onChange={e => onChange({ ...value, customEndpoint: e.target.value.trim() })}
                />
              </label>

              <div className="endpoint-presets">
                <button
                  type="button"
                  className="btn-preset"
                  onClick={() =>
                    onChange({
                      ...value,
                      customEndpoint: 'https://api.groq.com/openai/v1',
                      model: 'llama-3.3-70b-versatile',
                    })
                  }
                >
                  Preset Groq
                </button>
                <button
                  type="button"
                  className="btn-preset"
                  onClick={() =>
                    onChange({
                      ...value,
                      customEndpoint: 'https://openrouter.ai/api/v1',
                      model: 'meta-llama/llama-3.1-8b-instruct',
                    })
                  }
                >
                  Preset OpenRouter
                </button>
              </div>

              <label className="field-label">
                Clé d'API (stockée UNIQUEMENT dans ce navigateur)
                <div className="password-input-row">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={value.apiKey}
                    placeholder="sk-..."
                    onChange={e => onChange({ ...value, apiKey: e.target.value.trim() })}
                  />
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setShowApiKey(!showApiKey)}
                  >
                    {showApiKey ? 'Masquer' : 'Afficher'}
                  </button>
                </div>
              </label>
            </>
          )}

          <div className="field-label">
            <div className="row-between">
              <span>Modèle sélectionné</span>
              <button
                type="button"
                className="btn-link"
                disabled={loadingModels}
                onClick={fetchModels}
                title="Actualiser la liste des modèles"
              >
                🔄 Actualiser
              </button>
            </div>

            {loadingModels ? (
              <div className="loading-indicator">Recherche des modèles disponibles…</div>
            ) : models.length > 0 ? (
              <select
                value={value.model}
                onChange={e => onChange({ ...value, model: e.target.value })}
              >
                {models.map(m => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={value.model}
                placeholder="ex : qwen2.5:7b ou llama-3.3-70b-versatile"
                onChange={e => onChange({ ...value, model: e.target.value.trim() })}
              />
            )}
          </div>

          {err && <div className="notice-box error">{err}</div>}

          <label className="field-label">
            Température : {value.temperature}
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={value.temperature}
              onChange={e => onChange({ ...value, temperature: +e.target.value })}
            />
          </label>

          <label className="field-label">
            Longueur de synthèse (P3)
            <select
              value={value.synthLength ?? 'standard'}
              onChange={e => onChange({ ...value, synthLength: e.target.value as S['synthLength'] })}
            >
              {Object.entries(SYNTH_LIMITS).map(([k, cfg]) => (
                <option key={k} value={k}>
                  {cfg.label}
                </option>
              ))}
            </select>
            <span className="field-hint">
              Contrôle la durée de génération et l'effort mémoire (gain de 60 à 90 s en mode Standard/Court).
            </span>
          </label>
        </section>

        <section className="settings-section">
          <div className="section-title">
            <span>🌐 Sources scientifiques</span>
          </div>

          <div className="sources-checklist">
            {(['openalex', 'arxiv', 'hal', 'crossref', 'openlibrary'] as const).map(k => (
              <label key={k} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={value.sources[k]}
                  onChange={e =>
                    onChange({
                      ...value,
                      sources: { ...value.sources, [k]: e.target.checked },
                    })
                  }
                />
                <span className="source-name">{k}</span>
                <span className="source-desc">
                  {k === 'openalex'
                    ? 'Global'
                    : k === 'arxiv'
                    ? isHttps
                      ? 'Preprints (relais CORS)'
                      : 'Preprints'
                    : k === 'hal'
                    ? 'SHS / France'
                    : k === 'crossref'
                    ? 'Éditeurs'
                    : 'Livres'}
                </span>
              </label>
            ))}
          </div>

          <label className="field-label mt-sm">
            Résultats max / source : {value.maxPerSource}
            <input
              type="range"
              min={3}
              max={25}
              value={value.maxPerSource}
              onChange={e => onChange({ ...value, maxPerSource: +e.target.value })}
            />
          </label>
        </section>

        <section className="settings-section">
          <label className="field-label">
            E-mail de politesse (OpenAlex / Unpaywall)
            <input
              type="email"
              value={value.email}
              placeholder="ex: chercheur@universite.fr"
              onChange={e => onChange({ ...value, email: e.target.value.trim() })}
            />
          </label>
          <span className="field-hint">
            Optionnel mais recommandé pour le polite pool rapide. Sauvegardé uniquement dans ce
            navigateur.
          </span>
        </section>

        <DataManager onChanged={onReload} />
      </div>
    </aside>
  );
}
