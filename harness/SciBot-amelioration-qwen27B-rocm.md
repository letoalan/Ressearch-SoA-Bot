# SciBot local – Plan d'amélioration (Qwen 3.8 27B · ROCm · LM Studio)

Date : 04/10/2026 · Basé sur le journal LM Studio du 04/10/2026 (17:02–17:19) et le plan d'implémentation SciBot.

## 1. Constats issus des logs

| Étape | Prompt (tok) | Sortie (tok) | Préremplissage (tok/s) | Génération (tok/s) | Durée |
|---|---:|---:|---:|---:|---:|
| Planification | 173 | 37 | 135,9 | 17,8 | 3,3 s |
| Quiz | 1 432 | 1 440 | 267,7 | 23,4 | 66,9 s |
| Affinage | 465 | 85 | 237,6 | 22,9 | 5,6 s |
| État de l'art (stream) | 4 691 | 3 007 | 279,6 | 16,4 | 200,1 s |

- Total LLM ≈ 276 s ; l'état de l'art = 72,5 %, le quiz = 24,2 %.
- Génération = ~92 % du temps de l'état de l'art : le levier est la longueur de sortie, pas le prompt.
- Aucune troncature (`truncated = 0`), aucun JSON invalide, débit stable.
- Décodage spéculatif (MTP) : acceptation ~80 % (JSON) contre ~50 % (texte académique long).
- Modèle réellement chargé : `Qwen3.8-27B-Q3_K_S.gguf` (Q3, pas FP4) ; contexte par slot 8 192 puis 24 064, 4 slots.
- Défaut qualité : le quiz cite des index de références (21, 22, 27, 29, 34) potentiellement hors corpus.

## 2. Objectifs chiffrés

| Indicateur | Actuel | Cible |
|---|---:|---:|
| Quiz : tokens de sortie | 1 440 | ≤ 600 |
| Quiz : durée | 67 s | ≤ 30 s |
| État de l'art : tokens de sortie | 3 007 | 1 500–2 000 (mode standard) |
| État de l'art : durée | 200 s | ≤ 120 s |
| Références hors plage | présentes | 0 après validation |
| JSON invalide non réparé | 0 observé | 0 |

## 3. Actions prioritaires

### P1 – Raccourcir le quiz (gain ≈ 35 s)
- Prompt `QUIZ` : exactement 3 questions, 3 options max, `hint` ≤ 8 mots, 1–2 `refs` par option.
- Ajouter `max_tokens: 700` à l'appel.
- Ne pas demander de question sur la période/le type (déjà déterministes).

### P2 – Valider les références (qualité)
Dans `buildQuiz`, après `parseJson` :

```ts
const n = corpus.length;
const clean = (qs: QuizQuestion[]) => qs.map(q => ({
  ...q,
  options: q.options?.map(o => ({ ...o, refs: (o.refs ?? []).filter(r => Number.isInteger(r) && r >= 0 && r < n) }))
         .filter(o => o.label)
})).filter(q => q.kind === 'text' || q.kind === 'range' || (q.options?.length ?? 0) >= 2);
```

- Même contrôle pour les citations `[n]` de l'état de l'art : supprimer ou signaler tout n hors de [1, taille du corpus].
- Journaliser le nombre de corrections.

### P3 – Plafonner la synthèse
- Passer `max_tokens` (1 800 par défaut) et ajouter dans `SYNTHCOMPLET`/`SYNTHOA` une contrainte de longueur (« 900 à 1 300 mots »).
- Ajouter un réglage UI : Court (~600 tok) / Standard (~1 500) / Long (~3 000).
- Température : 0,2–0,3 au lieu de 0,5 pour limiter les extrapolations et améliorer l'acceptation spéculative.

### P4 – Streaming du quiz et indicateurs de progression
- Passer le quiz en `stream: true` et afficher une barre « n/3 questions » ou un spinner avec le temps écoulé.
- Afficher le débit (tok/s) et la phase (préremplissage / génération) dans le journal d'interface.

### P5 – Profils de chargement
| Profil | Usage | Contexte | Sortie max |
|---|---|---:|---:|
| Rapide | planification, affinage | 8k | 300 |
| Interactif | quiz, annotations | 12k | 700 |
| Synthèse | état de l'art | 16–24k | 2 000–3 000 |

- Réduire `n_slots` de 4 à 1–2 si un seul utilisateur : libère de la VRAM/KV cache.
- Tester `--no-reasoning-preserve` (A/B qualité et latence).

### P6 – Mode économique
- Sitographie sèche et bibliographie ISO 690 : 100 % déterministes (aucun appel LLM).
- Annotations : lot de 5 références par appel plutôt qu'une par appel, avec JSON `[{i, note}]`.
- Option : modèle 4B (`qwen3.8-4b-distill`) pour planification/affinage, 27B réservé à la synthèse.

## 4. Télémétrie à ajouter

Créer `src/telemetry.ts` et journaliser chaque appel LLM (IndexedDB, export CSV) :

| Champ | Description |
|---|---|
| ts, phase | horodatage, étape (plan/quiz/refine/synth/annot) |
| model, quant, n_ctx | modèle, quantification, contexte |
| prompt_tokens, completion_tokens | usage renvoyé par l'API |
| ttft_ms | délai avant le premier token (stream) |
| total_ms | durée totale |
| tps_gen | completion_tokens / durée de génération |
| json_ok, fallback_used | validité JSON, repli |
| refs_invalid | nombre de références hors plage |
| draft_acceptance | si disponible dans `stats` |

```ts
export async function timed<T>(phase: string, fn: () => Promise<T & { usage?: any }>) {
  const t0 = performance.now();
  const r = await fn();
  const total = performance.now() - t0;
  await db.telemetry.add({ ts: Date.now(), phase, total_ms: total, usage: r.usage });
  return r;
}
```

## 5. Protocole de benchmark (A/B)

Jeu fixe : même consigne, mêmes 20 références, température fixée, 3 répétitions par configuration.

| Test | Variable | Mesures |
|---|---|---|
| A | Q3_K_S vs quantification supérieure (Q4_K_M/Q5) | tok/s, qualité 1–5, VRAM |
| B | MTP activé vs désactivé | tok/s, acceptation |
| C | Température 0,5 vs 0,25 | acceptation, hallucinations |
| D | n_ctx 24k vs 12k, slots 4 vs 1 | VRAM, débit |
| E | Reasoning preserve on/off | tokens, latence |
| F | Quiz long vs court | durée, utilité perçue |

Grille qualité (1–5) : pertinence, structure, prudence (« d'après la notice »), traçabilité des citations, style. Contrôler manuellement 5 citations par texte.

## 6. Qualité des sorties

- Interdire dans le prompt toute affirmation non attribuée à une référence (ex. « polder model » sans source).
- Exiger la mention « (notice seule) » quand le texte intégral manque.
- Ajouter un contrôle post-génération : chaque paragraphe contient au moins une citation `[n]` valide.
- Ajouter une section « Limites du corpus » générée de façon déterministe (nombre de références, part en accès libre, part notice seule, période couverte).
- Journaliser dans l'export `.md` : requêtes, date, sources interrogées, filtres, nombre de résultats avant/après dédoublonnage (reproductibilité).

## 7. Feuille de route

| Étape | Contenu | Effort | Gain attendu |
|---|---|---|---|
| 1 | P1 + P2 (quiz court + validation refs) | 0,5 j | −35 s, 0 réf. invalide |
| 2 | P3 (plafond + réglage de longueur) | 0,5 j | −60 à −90 s |
| 3 | Télémétrie + export CSV | 0,5 j | Mesure continue |
| 4 | P4 (streaming quiz, progression) | 0,5 j | Meilleure UX |
| 5 | Benchmarks A–F | 1 j | Réglages optimaux documentés |
| 6 | P5/P6 (profils, annotations en lot, petit modèle) | 1 j | Réduction VRAM et latence |

## 8. Critères d'acceptation

- Quiz < 30 s et < 700 tokens sur le corpus de test.
- État de l'art standard < 120 s avec ≥ 90 % de citations valides.
- Aucun index hors plage affiché dans l'interface.
- Télémétrie exportable en CSV pour chaque session.
- Rapport de benchmark A–F archivé dans le dépôt.
