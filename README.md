# 🔬 SciBot local & Web — Assistant d'état de l'art scientifique (V2)

> Bot de recherche académique et de synthèse d'état de l'art **bivalent** : exécutable en **100 % local** (`npm run dev`) ou déployable directement sur **GitHub Pages**, respectueux de la vie privée, sans télémétrie externe et sans abonnement obligatoire.

SciBot explore en parallèle les principales bases documentaires mondiales (**OpenAlex, arXiv, HAL, Crossref, Open Library, Unpaywall**) et pilote un grand modèle de langage (LLM) exécuté **soit localement** (via **Ollama** ou **LM Studio** sous ROCm / CUDA / CPU), **soit via une URL personnalisée / tunnel HTTPS / fournisseur compatible OpenAI**.

---

## ⚡ Optimisations de Performance & Inférence Locale (Plan Qwen 27B · ROCm)

Le moteur intègre les optimisations chiffrées issues du plan [`SciBot-amelioration-qwen27B-rocm.md`](file:///harness/SciBot-amelioration-qwen27B-rocm.md) :

* **P1 – Quiz condensé ultra-rapide** : Passage de 67 s à ≤ 30 s grâce à un prompt restreint à 3 questions, 3 options max, `hint ≤ 8 mots` et un plafond matériel `max_tokens: 700`.
* **P2 – Contrôle qualité & assainissement d'index** : Élimination automatique de tout index de référence hors corpus (`refs` < 0 ou ≥ taille du corpus).
* **P3 – Plafonnement de la synthèse & Réglage UI** : Sélecteur de longueur dans les réglages :
  - *Court* : ~600 tokens (400–600 mots) pour une réponse concise.
  - *Standard* (défaut) : ~1 500 tokens (900–1 300 mots) avec gain de 60 à 90 s sur l'étape de rédaction.
  - *Approfondi* : ~3 000 tokens (1 800–2 500 mots).
  - Température ajustée à `0.25` pour maximiser le taux d'acceptation du décodage spéculatif (MTP) et réduire les hallucinations.
* **P6 – Mode économique & Annotations par lots** : Le mode *Sitographie commentée* traite désormais les références par paquets de 5 via `BATCH_ANNOTATE` en JSON structuré (divisant le nombre d'appels LLM par 5).
* **Traçabilité & Limites du corpus** : Chaque synthèse génère un en-tête de reproductibilité (requêtes, date, sources) et une section déterministe *« Limites du corpus »* (part en accès libre, notices seules, période couverte).
* **Télémétrie locale & Export CSV** : Enregistrement de chaque phase (durée en ms, tokens générés, débit en tok/s, TTFT) dans IndexedDB, exportable en 1 clic au format CSV.

---

## 🚀 Deux Modes d'Exécution Disponibles

| Mode | Contexte | Fonctionnement LLM | Sources Documentaires |
|---|---|---|---|
| **Mode Local (V1/V2)** | `npm run dev` sur `http://localhost:5173` | Connexion directe à Ollama (`:11434`) ou LM Studio (`:1234`) | Proxy Vite transparent sans contrainte CORS |
| **Mode Web (V2 - GitHub Pages)** | `https://votre-compte.github.io/Ressearch-SoA-Bot/` | Tunnel HTTPS local (Cloudflare/ngrok) ou API distante (Groq, OpenRouter, OpenAI-compatible) | Accès direct aux APIs + relais CORS transparent pour arXiv |

---

## 🛡️ Sécurité & Confidentialité des Données

* **Zéro fuite de données** : Le projet ne contient aucune clé secrète, aucun identifiant et aucun e-mail personnel en dur.
* **Stockage 100 % navigateur** : Vos sessions de recherche, historiques, métriques et réglages sont stockés exclusivement dans la base **IndexedDB** locale de votre navigateur. Rien n'est jamais transmis ni stocké sur un serveur centralisé.
* **Sauvegarde chiffrable et exportable** : Export et réimport de vos données sous forme de fichier JSON avec contrôle d'intégrité **SHA-256** et assainissement strict des URLs.
* **Sécurisation Git** : `.gitignore` bloque strictement les variables d'environnement (`.env*`), les sauvegardes locales (`*.json`) et les caches.

---

## 🌐 Déploiement sur GitHub Pages (Mode V2)

Le projet intègre un workflow GitHub Actions automatisé ([`.github/workflows/deploy.yml`](file:///.github/workflows/deploy.yml)).

### Activation en 3 clics sur GitHub :
1. Poussez votre dépôt sur GitHub.
2. Allez dans l'onglet **Settings** du dépôt ➔ menu **Pages** (dans la barre latérale gauche).
3. Sous **Build and deployment** ➔ **Source**, sélectionnez **GitHub Actions**.
4. Lors de chaque commit sur la branche `main`, le bot est automatiquement compilé et déployé sur `https://<votre-compte>.github.io/<nom-du-repo>/`.

### ⚠️ Note importante sur le *Mixed Content* en mode GitHub Pages :
Les navigateurs modernes (Chrome, Firefox, Safari) interdisent par sécurité à une page servie en **HTTPS** (comme GitHub Pages) d'appeler directement un serveur en `http://localhost` non chiffré.
Pour utiliser votre modèle local depuis votre page GitHub Pages, deux solutions très simples existent :
1. **Un tunnel HTTPS gratuit vers votre machine** :
   ```bash
   # Avec Cloudflare Tunnel (gratuit, sans compte) :
   cloudflared tunnel --url http://localhost:11434
   ```
   Renseignez l'URL fournie (ex. `https://xxxx.trycloudflare.com/v1`) dans le champ **URL Endpoint** de SciBot.
2. **Une clé d'API distante compatible OpenAI** :
   Sélectionnez *API distante / Tunnel HTTPS* dans les réglages et utilisez l'un des presets intégrés (**Groq** ou **OpenRouter**) avec votre clé personnelle (conservée localement dans votre navigateur).

---

## 📋 Utilisation en Mode 100 % Local

### 1. Prérequis
* **Node.js** (v18+)
* **Ollama** (`http://localhost:11434`) ou **LM Studio** (`http://localhost:1234`)

### 🧠 Modèles recommandés
```bash
ollama pull qwen2.5:7b       # Excellent en français et pour le JSON
ollama pull qwen2.5:14b      # Version avancée
# Ou sous LM Studio : Qwen 2.5 27B / Qwen 3.8 27B avec accélération ROCm / CUDA
```

### 2. Démarrage local
```bash
git clone https://github.com/votre-compte/Ressearch-SoA-Bot.git
cd Ressearch-SoA-Bot
npm install
npm run dev
```
Rendez-vous sur **`http://localhost:5173`**.

---

## 📖 Méthode d'utilisation : Le Workflow en 3 Étapes

```
┌─────────────────┐       Exploration large       ┌─────────────────┐        Affinage ciblé        ┌─────────────────┐
│   1. CONSIGNE   │ ────────────────────────────► │     2. QUIZ     │ ───────────────────────────► │  3. PRODUCTION  │
│ Question libre  │   (40 à 60 publications       │ Cadrage généré  │   (Requêtes affinées,        │ Livrable .md    │
│ + Format voulu  │    OpenAlex, arXiv, HAL...)   │ depuis corpus   │    graines, dates, types)    │ Citations [n]   │
└─────────────────┘                               └─────────────────┘                              └─────────────────┘
```

### Étape 1 — Consigne & Périmètre
1. **Formulez votre problématique** en langage naturel.
2. **Sélectionnez le livrable attendu** :
   - **État de l'art** : Synthèse problématisée avec bibliographie finale normée ISO 690.
   - **Sitographie commentée** : Notice complète de chaque référence assortie de 2 à 4 phrases d'analyse critique traitées par lots de 5.
   - **Sitographie structurée** : Inventaire documentaire complet classé par type sans hallucination ni rédaction LLM.
3. **Définissez le périmètre d'accès** :
   - *Exhaustif* : inclut les articles, livres et notices sous paywall.
   - *Libre Accès* : ne retient que les publications Open Access avec texte intégral libre.

### Étape 2 — Affinage interactif (Quiz & Visualisation)
* Panneau statistique complet : répartition par décennie, proportion d'Open Access, revues principales.
* Questionnaire d'affinage condensé (3 questions ciblées, options validées).

### Étape 3 — Production & Exportation
* Rédaction de la synthèse en **streaming direct** selon la longueur choisie (*Court*, *Standard*, *Approfondi*).
* Bascule vue formatée / Markdown brut.
* Copie presse-papier, téléchargement direct du livrable `.md` et export BibTeX.

---

## 🗄️ Gestion des données locales & Sauvegarde

Dans le panneau latéral, la section **Données locales** met à disposition :
- **Indicateur de persistance** : Informe sur le quota et le statut du stockage navigateur.
- **Exporter en JSON** : Sauvegarde complète horodatée avec signature **SHA-256**.
- **Importer un JSON** : Restauration avec contrôle d'intégrité et choix entre fusion intelligente ou écrasement.
- **📊 Exporter la télémétrie (CSV)** : Télécharge l'historique complet des temps de réponse, débits (tok/s), tokens consommés et phases.
- **Vider la base** : Effacement instantané pour les postes partagés.

---

## 📄 Licence

Ce projet est sous licence open source libre d'utilisation. Aucune donnée utilisateur n'est collectée.
