export const QUIZ = `Tu aides un chercheur à préciser sa demande. À partir de la consigne et du corpus exploratoire fourni,
propose EXACTEMENT 3 questions de cadrage FONDÉES SUR LE CORPUS (angles théoriques, controverses, terrains, approches).
Chaque option doit obligatoirement refléter 1 à 2 références réelles du corpus (indiquer leurs index dans "refs").
Réponds UNIQUEMENT en JSON :
{
  "questions": [
    {
      "id": "q1",
      "kind": "single",
      "dimension": "axe",
      "question": "Quel aspect souhaitez-vous privilégier ?",
      "options": [
        { "id": "a", "label": "Libellé court", "hint": "Précision ≤ 8 mots", "refs": [0, 2] }
      ]
    }
  ]
}
Règles strictes de concision (P1) :
- EXACTEMENT 3 questions au total.
- 2 à 3 options MAX par question.
- "hint" très court (≤ 8 mots).
- "refs" contient 1 ou 2 index entiers issus STRICTEMENT du corpus numéroté fourni.
- Dimensions autorisées : "axe", "espace", "discipline", "niveau", "langue".
- INTERDIT : Ne pose aucune question sur les dates de publication ni sur les types de documents (elles sont générées séparément).`;

export const REFINE = `À partir de la consigne initiale et des réponses au quiz d'affinage, produis UNIQUEMENT un JSON :
{
  "queries": ["requête 1", "requête 2", "requête 3"],
  "focus": "problématique reformulée en une phrase précise"
}
Règles :
- 3 à 4 requêtes courtes (3 à 6 mots), dont au moins une en anglais, qui intègrent les choix de l'utilisateur.`;

export const ANNOTATE = `Rédige en français 2 à 4 phrases de commentaire critique sur cette référence au regard de la problématique de recherche :
- Apport principal, méthode ou corpus étudié, intérêt ou limites.
- Si seule la notice/résumé est disponible, commence par "D'après la notice :" et reste prudent.
- Aucun titre de section, pas de puce, n'invente rien.`;

export const BATCH_ANNOTATE = `Tu es un assistant de recherche scientifique. Rédige en français pour chaque référence fournie 2 à 4 phrases de commentaire critique par rapport à la problématique.
Format de réponse : UNIQUEMENT un JSON strict :
{
  "notes": [
    {
      "i": 1,
      "note": "2 à 4 phrases : apport, méthode/terrain, portée ou limites. Mentionner 'D\\'après la notice :' si notice seule."
    }
  ]
}
Règles :
- Traite chaque référence par son numéro "i".
- N'invente aucune information non présente dans le résumé/notice.`;
