import { chatDetailed, chatStream } from '../llm/client';
import { searchAll } from '../sources';
import type { Paper } from '../sources/types';
import { SYNTH_LIMITS, type Settings } from '../config';
import type { Brief, CorpusStats, QuizQuestion, Session } from './types';
import { PLANNER, getSynthCompletPrompt, getSynthOaPrompt } from '../agent/prompts';
import { QUIZ, REFINE, ANNOTATE, BATCH_ANNOTATE } from './prompts';
import { bibliography, sitography, cite } from '../output/markdown';
import { logTelemetry } from '../telemetry';

const parseJson = <T>(t: string, fb: T): T => {
  const m = t.match(/[\[{][\s\S]*[\]}]/);
  try {
    return m ? JSON.parse(m[0]) : fb;
  } catch {
    return fb;
  }
};

/* ---------- Étape 1 : Exploration large ---------- */

export async function explore(
  brief: Brief,
  s: Settings,
  signal: AbortSignal,
  log: (m: string) => void
): Promise<{ queries: string[]; corpus: Paper[]; stats: CorpusStats }> {
  log(`Interrogation du planificateur (${s.model || 'modèle par défaut'})…`);

  const resPlan = await chatDetailed(
    s,
    s.model,
    [
      { role: 'system', content: PLANNER },
      { role: 'user', content: brief.text },
    ],
    0.1,
    true,
    signal,
    300
  );

  const plan = parseJson(resPlan.content, { queries: [brief.text] });
  log(`Requêtes identifiées : ${plan.queries.join(' · ')}`);

  await logTelemetry({
    phase: 'plan',
    model: s.model,
    total_ms: resPlan.durationMs,
    prompt_tokens: resPlan.usage?.prompt_tokens,
    completion_tokens: resPlan.usage?.completion_tokens,
    tps_gen:
      resPlan.usage?.completion_tokens && resPlan.durationMs > 0
        ? resPlan.usage.completion_tokens / (resPlan.durationMs / 1000)
        : undefined,
    json_ok: Array.isArray(plan.queries) && plan.queries.length > 0,
  });

  const { papers, errors } = await searchAll(
    plan.queries,
    { ...s, access: brief.access },
    { signal }
  );

  errors.forEach(e => log(`⚠ ${e}`));
  log(`${papers.length} références uniques identifiées`);

  const corpus = papers.slice(0, 60);
  return {
    queries: plan.queries,
    corpus,
    stats: computeStats(papers),
  };
}

export function computeStats(ps: Paper[]): CorpusStats {
  const count = (f: (p: Paper) => string | undefined) =>
    ps.reduce<Record<string, number>>((a, p) => {
      const k = f(p) ?? '?';
      a[k] = (a[k] ?? 0) + 1;
      return a;
    }, {});

  const years = ps.map(p => p.year).filter((y): y is number => typeof y === 'number' && y > 1800);

  return {
    total: ps.length,
    oa: ps.filter(p => p.isOA).length,
    byType: count(p => p.type),
    byLang: count(p => p.lang),
    byDecade: count(p => (p.year ? `${Math.floor(p.year / 10) * 10}s` : undefined)),
    topVenues: Object.entries(count(p => p.venue))
      .filter(([k]) => k !== '?')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8),
    yearMin: years.length ? Math.min(...years) : undefined,
    yearMax: years.length ? Math.max(...years) : undefined,
  };
}

/* ---------- Étape 2 : Quiz optimisé (P1 & P2) ---------- */

export async function buildQuiz(
  brief: Brief,
  corpus: Paper[],
  stats: CorpusStats,
  s: Settings,
  log?: (m: string) => void
): Promise<QuizQuestion[]> {
  // Limiter le digest aux 30 premières références pour accélérer le préremplissage
  const digest = corpus
    .slice(0, 30)
    .map((p, i) => `${i}. ${p.title} (${p.year ?? 's.d.'}, ${p.type ?? 'article'})`)
    .join('\n');

  let llmQs: QuizQuestion[] = [];
  let invalidRefsCount = 0;
  let durationMs = 0;
  let usage: any;

  try {
    // P1: max_tokens = 700 et température = 0.2 pour un quiz ultra rapide (≤ 30s)
    const res = await chatDetailed(
      s,
      s.model,
      [
        { role: 'system', content: QUIZ },
        {
          role: 'user',
          content: `Consigne : ${brief.text}\n\nStatistiques : ${JSON.stringify(stats)}\n\nCorpus :\n${digest}`,
        },
      ],
      0.2,
      true,
      undefined,
      700
    );

    durationMs = res.durationMs;
    usage = res.usage;

    const parsed = parseJson<{ questions: QuizQuestion[] }>(res.content, { questions: [] });
    const rawQuestions = parsed.questions ?? [];

    // P2: Validation stricte des index de références (0 à corpus.length - 1)
    const corpusLength = corpus.length;
    llmQs = rawQuestions
      .map(q => ({
        ...q,
        options: (q.options ?? [])
          .map(o => {
            const validRefs = (o.refs ?? []).filter(r => {
              const isOk = Number.isInteger(r) && r >= 0 && r < corpusLength;
              if (!isOk) invalidRefsCount++;
              return isOk;
            });
            return { ...o, refs: validRefs };
          })
          .filter(o => Boolean(o.label)),
      }))
      .filter(
        q =>
          q.question &&
          (q.kind === 'text' || q.kind === 'range' || (q.options && q.options.length >= 2))
      )
      .slice(0, 3); // Exactement 3 questions dynamiques max (P1)
  } catch {
    // Repli déterministe en cas d'erreur
  }

  if (invalidRefsCount > 0 && log) {
    log(`ℹ ${invalidRefsCount} index de référence(s) hors corpus ont été assainis.`);
  }

  await logTelemetry({
    phase: 'quiz',
    model: s.model,
    total_ms: durationMs,
    prompt_tokens: usage?.prompt_tokens,
    completion_tokens: usage?.completion_tokens,
    tps_gen:
      usage?.completion_tokens && durationMs > 0
        ? usage.completion_tokens / (durationMs / 1000)
        : undefined,
    json_ok: llmQs.length > 0,
    refs_invalid: invalidRefsCount,
  });

  // Questions déterministes toujours garanties
  const currentYear = new Date().getFullYear();
  const fixed: QuizQuestion[] = [
    {
      id: 'periode',
      kind: 'range',
      dimension: 'periode',
      question: 'Quelle période de publication souhaitez-vous retenir ?',
      min: stats.yearMin ?? 1990,
      max: stats.yearMax ?? currentYear,
    },
    {
      id: 'types',
      kind: 'multi',
      dimension: 'type',
      question: 'Quels types de documents privilégier ?',
      options: Object.entries(stats.byType).map(([k, n]) => ({
        id: k,
        label: `${k.toUpperCase()} (${n})`,
      })),
    },
    {
      id: 'refs',
      kind: 'multi',
      dimension: 'references',
      question:
        'Parmi ces premières références, cochez celles qui correspondent le mieux à votre attente (graines) :',
      options: corpus.slice(0, 10).map((p, i) => ({
        id: String(i),
        label: `${p.title} (${p.year ?? 's.d.'})`,
        hint: p.authors?.slice(0, 2).join(', '),
      })),
    },
    {
      id: 'libre',
      kind: 'text',
      dimension: 'libre',
      question: 'Précisions supplémentaires (auteurs clés, zones géographiques, exclusions…) :',
    },
  ];

  return [...llmQs, ...fixed];
}

/* ---------- Transition 2 → 3 : Affinage ---------- */

export async function refine(
  session: Session,
  s: Settings,
  signal: AbortSignal,
  log: (m: string) => void
): Promise<{
  refined: {
    queries: string[];
    yearFrom?: number;
    yearTo?: number;
    keepIds: string[];
    excludeIds: string[];
    focus: string;
  };
  corpus: Paper[];
}> {
  const { brief, quiz, answers, explore: ex } = session;

  const readable = quiz
    .map(q => {
      const a = answers[q.id];
      if (a == null || (Array.isArray(a) && !a.length)) return null;
      const val =
        q.kind === 'range'
          ? `${(a as number[])[0]}–${(a as number[])[1]}`
          : q.kind === 'text'
          ? a
          : (a as string[])
              .map(id => q.options?.find(o => o.id === id)?.label ?? id)
              .join(' ; ');
      return `- ${q.question} → ${val}`;
    })
    .filter(Boolean)
    .join('\n');

  log('Ajustement des requêtes de recherche…');
  const resRefine = await chatDetailed(
    s,
    s.model,
    [
      { role: 'system', content: REFINE },
      {
        role: 'user',
        content: `Consigne initiale : ${brief.text}\nRequêtes initiales : ${ex.queries.join(
          ' · '
        )}\n\nRéponses de l'utilisateur :\n${readable}`,
      },
    ],
    0.1,
    true,
    signal,
    300
  );

  const r = parseJson(resRefine.content, { queries: ex.queries, focus: brief.text });
  const [yFrom, yTo] = (answers.periode as [number, number]) ?? [];
  const seedIdx = ((answers.refs as string[]) ?? []).map(Number);
  const types = (answers.types as string[]) ?? [];

  await logTelemetry({
    phase: 'refine',
    model: s.model,
    total_ms: resRefine.durationMs,
    prompt_tokens: resRefine.usage?.prompt_tokens,
    completion_tokens: resRefine.usage?.completion_tokens,
    tps_gen:
      resRefine.usage?.completion_tokens && resRefine.durationMs > 0
        ? resRefine.usage.completion_tokens / (resRefine.durationMs / 1000)
        : undefined,
    json_ok: Array.isArray(r.queries),
  });

  log(`Nouvelles requêtes affinées : ${r.queries.join(' · ')}`);
  const { papers } = await searchAll(
    r.queries,
    { ...s, access: brief.access, maxPerSource: s.maxPerSource },
    { yearFrom: yFrom, signal }
  );

  const seeds = seedIdx.map(i => ex.corpus[i]).filter(Boolean);
  const merged = dedupe([...seeds, ...papers, ...ex.corpus])
    .filter(p => !yFrom || !p.year || (p.year >= yFrom && (!yTo || p.year <= yTo)))
    .filter(p => !types.length || types.includes(p.type ?? 'other'))
    .filter(p => brief.access === 'tout' || p.isOA);

  log(`${merged.length} références sélectionnées après affinage`);

  return {
    refined: {
      queries: r.queries,
      yearFrom: yFrom,
      yearTo: yTo,
      keepIds: seeds.map(p => p.id),
      excludeIds: [],
      focus: (r.focus as string) || brief.text,
    },
    corpus: merged,
  };
}

const dedupe = (ps: Paper[]): Paper[] => {
  const m = new Map<string, Paper>();
  for (const p of ps) {
    const k = (p.doi ?? p.title).toLowerCase().trim();
    if (k && !m.has(k)) m.set(k, p);
  }
  return [...m.values()];
};

const rankForOutput = (ps: Paper[], keep: string[]): Paper[] => {
  return [...ps].sort((a, b) => {
    const aKeep = keep.includes(a.id) ? 1 : 0;
    const bKeep = keep.includes(b.id) ? 1 : 0;
    return bKeep - aKeep || (b.citations ?? 0) - (a.citations ?? 0);
  });
};

/* ---------- Étape 3 : Production Markdown & Annotations en lot (P3, P6) ---------- */

export async function* produce(
  session: Session,
  corpus: Paper[],
  s: Settings,
  signal: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const { brief, refined } = session;
  const focus = refined?.focus || brief.text;
  const top = rankForOutput(corpus, refined?.keepIds ?? []).slice(
    0,
    brief.mode === 'sitographie-seche' ? 50 : 20
  );

  const stats = session.explore.stats;
  const dateStr = new Date().toLocaleDateString('fr-FR');

  // En-tête de reproductibilité (Section 6)
  const metaHeader = `> **Reproductibilité** : Requêtes : *${(refined?.queries ?? session.explore.queries).join(
    ' · '
  )}* · Date : ${dateStr} · Sources : OpenAlex, arXiv, HAL, Crossref, Open Library · Sélection finale : ${
    top.length
  } références (sur ${corpus.length} analysées)\n\n`;

  // 1. Mode Sitographie Sèche (100% déterministe)
  if (brief.mode === 'sitographie-seche') {
    yield metaHeader;
    yield sitography(focus, top);
    return;
  }

  // 2. Mode Sitographie Commentée (P6 : Par lots de 5 références pour réduire la latence)
  if (brief.mode === 'sitographie-commentee') {
    yield `# Sitographie commentée : ${focus}\n\n`;
    yield metaHeader;

    const BATCH_SIZE = 5;
    for (let b = 0; b < top.length; b += BATCH_SIZE) {
      if (signal.aborted) return;
      const batch = top.slice(b, b + BATCH_SIZE);

      // Préparation du prompt groupé
      const batchInput = batch
        .map(
          (p, idx) =>
            `[${b + idx + 1}] ${cite(p)}\nRésumé : ${p.abstract?.slice(0, 800) ?? '(notice seule)'}`
        )
        .join('\n\n');

      let notesMap: Record<number, string> = {};
      try {
        const batchRes = await chatDetailed(
          s,
          s.model,
          [
            { role: 'system', content: BATCH_ANNOTATE },
            {
              role: 'user',
              content: `Problématique : ${focus}\n\nRéférences à annoter :\n${batchInput}`,
            },
          ],
          0.2,
          true,
          signal,
          1200
        );

        const parsed = parseJson<{ notes: { i: number; note: string }[] }>(batchRes.content, {
          notes: [],
        });
        parsed.notes.forEach(item => {
          notesMap[item.i] = item.note;
        });

        await logTelemetry({
          phase: 'annot',
          model: s.model,
          total_ms: batchRes.durationMs,
          prompt_tokens: batchRes.usage?.prompt_tokens,
          completion_tokens: batchRes.usage?.completion_tokens,
          tps_gen:
            batchRes.usage?.completion_tokens && batchRes.durationMs > 0
              ? batchRes.usage.completion_tokens / (batchRes.durationMs / 1000)
              : undefined,
          json_ok: parsed.notes.length > 0,
        });
      } catch {
        // Fallback si échec du lot
      }

      // Rendu des articles du lot
      for (const [idx, p] of batch.entries()) {
        const num = b + idx + 1;
        const lien = p.pdfUrl ?? (p.doi ? `https://doi.org/${p.doi}` : p.url);
        yield `### ${num}. ${cite(p)}\n\n${
          p.isOA ? '🔓 [Accès libre]' : '🔒 [Accès restreint]'
        } [Consulter la source](${lien})\n\n`;

        if (notesMap[num]) {
          yield `${notesMap[num]}\n\n---\n\n`;
        } else {
          // Repli individuel si le lot n'a pas inclus cette référence
          yield* chatStream(
            s,
            s.model,
            [
              { role: 'system', content: ANNOTATE },
              {
                role: 'user',
                content: `Problématique : ${focus}\n\nRéférence : ${cite(p)}\nRésumé : ${
                  p.abstract?.slice(0, 1000) ?? '(notice seule)'
                }`,
              },
            ],
            0.2,
            signal,
            300
          );
          yield '\n\n---\n\n';
        }
      }
    }
    return;
  }

  // 3. Mode État de l'art (P3 : Longueur paramétrable + Section Limites déterministe)
  const lengthConfig = SYNTH_LIMITS[s.synthLength || 'standard'];
  const maxTokens = lengthConfig.maxTokens;
  const wordsTarget = lengthConfig.wordsPrompt;

  const ctx = top
    .map(
      (p, i) =>
        `[${i + 1}] ${(p.type ?? 'article').toUpperCase()} · ${p.isOA ? 'OA' : 'PAYWALL'}\n${cite(p)}\n${
          p.abstract?.slice(0, 1000) ?? '(notice seule)'
        }`
    )
    .join('\n\n');

  yield `# État de l'art${brief.access === 'oa' ? ' (accès libre)' : ''} : ${focus}\n\n`;
  yield metaHeader;

  const systemPrompt =
    brief.access === 'oa'
      ? getSynthOaPrompt(wordsTarget)
      : getSynthCompletPrompt(wordsTarget);


  yield* chatStream(
    s,
    s.model,
    [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Problématique affinée : ${focus}\n\nRéférences scientifiques retenues (${top.length} références) :\n${ctx}`,
      },
    ],
    s.temperature ?? 0.25,
    signal,
    maxTokens,
    async metrics => {
      // Télémétrie sur la synthèse complète
      await logTelemetry({
        phase: 'synth',
        model: s.model,
        total_ms: metrics.durationMs,
        ttft_ms: metrics.ttftMs,
        completion_tokens: metrics.tokenCount,
        tps_gen: metrics.durationMs > 0 ? metrics.tokenCount / (metrics.durationMs / 1000) : 0,
      });
    }
  );

  const currentYear = new Date().getFullYear();

  // Section 6 : Limites du corpus déterministes (P6 / Section 6)
  const oaCount = top.filter(p => p.isOA).length;
  const paywallCount = top.length - oaCount;
  const oaPercent = Math.round((oaCount / top.length) * 100);

  yield `\n\n## Limites du corpus et couverture documentaire\n\n` +
    `- **Sélection analysée** : ${top.length} publications prioritaires (sur un total de ${corpus.length} identifiées).\n` +
    `- **Accessibilité du texte intégral** : ${oaCount} références en libre accès (${oaPercent} %), ${paywallCount} notices sous accès restreint (commentées à partir de leurs résumés d'éditeurs).\n` +
    `- **Couverture temporelle** : ${stats.yearMin ?? 's.d.'} à ${stats.yearMax ?? currentYear}.\n\n`;

  yield bibliography(top);
}
