import { useState } from 'react';
import type { Brief } from '../workflow/types';

const MODES = [
  {
    id: 'etat-art',
    title: "État de l'art",
    icon: '📝',
    desc: 'Synthèse académique approfondie, courants théoriques et bibliographie normée.',
  },
  {
    id: 'sitographie-commentee',
    title: 'Sitographie commentée',
    icon: '🔍',
    desc: 'Notice complète avec commentaire critique individuel (2 à 4 phrases) par référence.',
  },
  {
    id: 'sitographie-seche',
    title: 'Sitographie structurée',
    icon: '📋',
    desc: 'Inventaire documentaire exhaustif classé par type (livres, articles, thèses), sans rédaction LLM.',
  },
] as const;

export function StepBrief({
  initial,
  onSubmit,
}: {
  initial: Brief;
  onSubmit: (b: Brief) => void;
}) {
  const [b, setB] = useState(initial);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (b.text.trim()) {
      onSubmit(b);
    }
  };

  return (
    <form className="step-container" onSubmit={handleSubmit}>
      <div className="step-intro">
        <h2>Quelle est votre problématique de recherche ?</h2>
        <p className="subtitle">
          Formulez votre question scientifique ou votre sujet d'étude. Le bot va explorer les bases
          internationales pour dresser une cartographie initiale.
        </p>
      </div>

      <div className="form-group">
        <textarea
          rows={4}
          value={b.text}
          onChange={e => setB({ ...b, text: e.target.value })}
          placeholder="Exemple : Impact du surtourisme sur les centres historiques et politiques de régulation en Europe depuis les années 2000"
          required
        />
      </div>

      <div className="section-title">
        <span>Format du livrable souhaité</span>
      </div>

      <div className="choice-grid">
        {MODES.map(m => {
          const isSelected = b.mode === m.id;
          return (
            <label key={m.id} className={`choice-card ${isSelected ? 'selected' : ''}`}>
              <input
                type="radio"
                name="outputMode"
                value={m.id}
                checked={isSelected}
                onChange={() => setB({ ...b, mode: m.id })}
              />
              <div className="choice-icon">{m.icon}</div>
              <strong className="choice-title">{m.title}</strong>
              <p className="choice-desc">{m.desc}</p>
            </label>
          );
        })}
      </div>

      <div className="section-title mt-md">
        <span>Périmètre d'accessibilité documentaire</span>
      </div>

      <div className="access-scope-selector">
        <label className={`scope-pill ${b.access === 'tout' ? 'active' : ''}`}>
          <input
            type="radio"
            name="accessScope"
            checked={b.access === 'tout'}
            onChange={() => setB({ ...b, access: 'tout' })}
          />
          <span>📚 Exhaustif (Articles, Ouvrages, Paywall commentés d'après notice)</span>
        </label>
        <label className={`scope-pill ${b.access === 'oa' ? 'active' : ''}`}>
          <input
            type="radio"
            name="accessScope"
            checked={b.access === 'oa'}
            onChange={() => setB({ ...b, access: 'oa' })}
          />
          <span>🔓 Libre Accès exclusivement (Open Access direct avec PDF)</span>
        </label>
      </div>

      <div className="form-actions mt-lg">
        <button
          type="submit"
          className="btn-primary-large"
          disabled={!b.text.trim()}
        >
          Lancer l'exploration scientifique →
        </button>
      </div>
    </form>
  );
}
