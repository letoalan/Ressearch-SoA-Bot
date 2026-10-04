import { useState } from 'react';
import type { Session, Answers, QuizQuestion } from '../workflow/types';
import { CorpusPreview } from './CorpusPreview';

export function StepQuiz({
  session,
  onSubmit,
  onBack,
}: {
  session: Session;
  onSubmit: (a: Answers) => void;
  onBack: () => void;
}) {
  const [ans, setAns] = useState<Answers>(session.answers);

  const setVal = (id: string, v: Answers[string]) => {
    setAns(a => ({ ...a, [id]: v }));
  };

  const toggleOption = (q: QuizQuestion, optId: string) => {
    const cur = (ans[q.id] as string[]) ?? [];
    if (q.kind === 'single') {
      setVal(q.id, cur.includes(optId) ? [] : [optId]);
    } else {
      setVal(
        q.id,
        cur.includes(optId) ? cur.filter(x => x !== optId) : [...cur, optId]
      );
    }
  };

  return (
    <div className="quiz-layout">
      <form
        className="quiz-form"
        onSubmit={e => {
          e.preventDefault();
          onSubmit(ans);
        }}
      >
        <div className="step-intro">
          <h2>Affinons votre cadrage</h2>
          <p className="subtitle">
            Ces questions ont été générées automatiquement à partir des{' '}
            <strong>{session.explore.stats.total}</strong> références trouvées. Elles permettent
            de cibler l'analyse sur vos priorités réelles.
          </p>
        </div>

        <div className="questions-container">
          {session.quiz.map((q, idx) => (
            <fieldset key={q.id} className="question-card">
              <legend>
                <span className="dimension-badge">{q.dimension}</span>
                <span className="question-title">
                  {idx + 1}. {q.question}
                </span>
              </legend>

              {q.kind === 'range' && (
                <RangePicker
                  q={q}
                  value={ans[q.id] as [number, number]}
                  onChange={v => setVal(q.id, v)}
                />
              )}

              {q.kind === 'text' && (
                <textarea
                  rows={2}
                  className="quiz-textarea"
                  value={(ans[q.id] as string) ?? ''}
                  onChange={e => setVal(q.id, e.target.value)}
                  placeholder="Ex : Exclure les articles antérieurs à la pandémie ; cibler l'espace méditerranéen..."
                />
              )}

              {(q.kind === 'single' || q.kind === 'multi') && q.options && (
                <div className="options-grid">
                  {q.options.map(opt => {
                    const isSelected = ((ans[q.id] as string[]) ?? []).includes(opt.id);
                    return (
                      <button
                        type="button"
                        key={opt.id}
                        className={`opt-chip ${isSelected ? 'selected' : ''}`}
                        onClick={() => toggleOption(q, opt.id)}
                        title={opt.hint}
                      >
                        <span className="opt-label">{opt.label}</span>
                        {opt.refs && opt.refs.length > 0 && (
                          <span className="opt-badge">{opt.refs.length} réf.</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </fieldset>
          ))}
        </div>

        <div className="form-actions mt-lg">
          <button type="button" className="btn-secondary" onClick={onBack}>
            ← Modifier la consigne
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => onSubmit({})}
            title="Conserver l'ensemble du corpus sans filtrage"
          >
            Passer le quiz
          </button>
          <button type="submit" className="btn-primary-large">
            Affiner et produire le livrable →
          </button>
        </div>
      </form>

      <CorpusPreview
        stats={session.explore.stats}
        corpus={session.explore.corpus}
        queries={session.explore.queries}
      />
    </div>
  );
}

function RangePicker({
  q,
  value,
  onChange,
}: {
  q: QuizQuestion;
  value?: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  const minLimit = q.min ?? 1990;
  const maxLimit = q.max ?? new Date().getFullYear();
  const [a, b] = value ?? [minLimit, maxLimit];

  return (
    <div className="range-picker">
      <label>
        De
        <input
          type="number"
          min={minLimit}
          max={b}
          value={a}
          onChange={e => onChange([+e.target.value, b])}
        />
      </label>
      <span className="range-sep">à</span>
      <label>
        À
        <input
          type="number"
          min={a}
          max={maxLimit}
          value={b}
          onChange={e => onChange([a, +e.target.value])}
        />
      </label>
    </div>
  );
}
