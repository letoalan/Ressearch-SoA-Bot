import { useRef, useState } from 'react';
import type { Settings } from '../config';
import type { Paper } from '../sources/types';
import type { Session, Brief, Answers } from '../workflow/types';
import { explore, buildQuiz, refine, produce } from '../workflow/engine';
import { db } from '../db/db';
import { Stepper } from './Stepper';
import { StepBrief } from './StepBrief';
import { StepQuiz } from './StepQuiz';
import { StepOutput } from './StepOutput';

const createEmptySession = (s: Settings): Session => ({
  createdAt: Date.now(),
  phase: 'brief',
  brief: { text: '', mode: s.mode, access: s.access },
  explore: {
    queries: [],
    corpus: [],
    stats: {
      total: 0,
      oa: 0,
      byType: {},
      byDecade: {},
      byLang: {},
      topVenues: [],
    },
  },
  quiz: [],
  answers: {},
});

export function Wizard({ settings }: { settings: Settings }) {
  const [ses, setSes] = useState<Session>(() => createEmptySession(settings));
  const [logs, setLogs] = useState<string[]>([]);
  const [finalCorpus, setFinalCorpus] = useState<Paper[]>([]);
  const ctrl = useRef<AbortController | null>(null);

  const addLog = (m: string) => setLogs(l => [...l, m]);

  const save = async (s: Session) => {
    try {
      const id = await db.sessions.put(s);
      const updated = { ...s, id };
      setSes(updated);
      return updated;
    } catch {
      setSes(s);
      return s;
    }
  };

  const guard = async (fn: (sig: AbortSignal) => Promise<void>) => {
    ctrl.current = new AbortController();
    try {
      await fn(ctrl.current.signal);
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        addLog(`❌ Erreur : ${e.message}`);
      } else {
        addLog('⏹️ Opération interrompue par l’utilisateur.');
      }
    }
  };

  /* 1 → 2 : Exploration & Génération du quiz */
  const onBrief = (brief: Brief) =>
    guard(async sig => {
      setLogs([]);
      let s = await save({ ...ses, brief, phase: 'exploring' });

      addLog(`Démarrage de la recherche pour : "${brief.text}"`);
      const ex = await explore(brief, settings, sig, addLog);

      addLog('Génération du quiz d’affinage contextuel (3 questions ciblées)…');
      const quiz = await buildQuiz(brief, ex.corpus, ex.stats, settings, addLog);

      await save({ ...s, explore: ex, quiz, phase: 'quiz' });
    });

  /* 2 → 3 : Affinage & Rédaction streamée */
  const onAnswers = (answers: Answers) =>
    guard(async sig => {
      let s = await save({ ...ses, answers, phase: 'refining' });

      addLog('Filtrage et recoupement des publications…');
      const { refined, corpus } = await refine(s, settings, sig, addLog);
      setFinalCorpus(corpus);

      s = await save({ ...s, refined, phase: 'producing', output: '' });

      addLog('Rédaction du livrable scientifique en streaming…');
      let out = '';
      for await (const chunk of produce(s, corpus, settings, sig)) {
        out += chunk;
        setSes(x => ({ ...x, output: out }));
      }

      await save({ ...s, output: out, phase: 'done' });
      addLog('✓ Synthèse finalisée avec succès.');
    });

  const isBusy = ['exploring', 'refining', 'producing'].includes(ses.phase);

  return (
    <main className="main-content">
      <div className="content-container">
        <Stepper
          phase={ses.phase}
          onJump={p => {
            if (!isBusy) {
              setSes(x => ({ ...x, phase: p }));
            }
          }}
        />

        {isBusy && (
          <div className="progress-banner">
            <div className="progress-header">
              <span className="spinner" />
              <strong>Traitement scientifique en cours…</strong>
              <button
                type="button"
                className="btn-danger-sm"
                onClick={() => ctrl.current?.abort()}
              >
                Arrêter
              </button>
            </div>
            <ul className="progress-logs">
              {logs.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        )}

        {ses.phase === 'brief' && <StepBrief initial={ses.brief} onSubmit={onBrief} />}

        {ses.phase === 'exploring' && (
          <div className="state-placeholder">
            <div className="pulse-circle">🔍</div>
            <h3>Exploration des bases bibliographiques…</h3>
            <p>Interrogation d'OpenAlex, arXiv, HAL, Crossref et Open Library en parallèle.</p>
          </div>
        )}

        {ses.phase === 'quiz' && (
          <StepQuiz
            session={ses}
            onSubmit={onAnswers}
            onBack={() => setSes(x => ({ ...x, phase: 'brief' }))}
          />
        )}

        {(ses.phase === 'refining' || ses.phase === 'producing' || ses.phase === 'done') && (
          <StepOutput
            session={ses}
            corpus={finalCorpus.length > 0 ? finalCorpus : ses.explore.corpus}
            streaming={ses.phase !== 'done'}
            onBackToQuiz={() => setSes(x => ({ ...x, phase: 'quiz' }))}
            onNew={() => {
              setSes(createEmptySession(settings));
              setLogs([]);
              setFinalCorpus([]);
            }}
          />
        )}
      </div>
    </main>
  );
}
