import type { Phase } from '../workflow/types';

const steps: { label: string; desc: string; phases: Phase[]; target: Phase }[] = [
  {
    label: '1. Consigne',
    desc: 'Problématique & Livrable',
    phases: ['brief', 'exploring'],
    target: 'brief',
  },
  {
    label: '2. Affinage',
    desc: 'Quiz & Corpus ciblé',
    phases: ['quiz', 'refining'],
    target: 'quiz',
  },
  {
    label: '3. Production',
    desc: 'Synthèse & Exportation',
    phases: ['producing', 'done'],
    target: 'done',
  },
];

export function Stepper({
  phase,
  onJump,
}: {
  phase: Phase;
  onJump: (p: Phase) => void;
}) {
  const cur = steps.findIndex(s => s.phases.includes(phase));

  return (
    <nav className="stepper" aria-label="Étapes de la recherche">
      {steps.map((s, i) => {
        const isActive = i === cur;
        const isDone = i < cur;
        const isDisabled = i > cur;

        return (
          <button
            key={s.label}
            type="button"
            className={`step-btn ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}
            disabled={isDisabled}
            onClick={() => onJump(s.target)}
          >
            <span className="step-num">{isDone ? '✓' : i + 1}</span>
            <div className="step-text">
              <strong className="step-title">{s.label}</strong>
              <small className="step-desc">{s.desc}</small>
            </div>
          </button>
        );
      })}
    </nav>
  );
}
