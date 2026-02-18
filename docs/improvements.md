# Propositions d'amélioration de skills-mcp

## 1. Enrichir le matching sans sacrifier le déterminisme

**Problème adressé :** rigidité lexicale, pas de sémantique, "formulaire d'inscription" ne matche pas `[auth, login]`.

### a) Synonymes déclarés dans le frontmatter

Ajouter un champ optionnel `aliases` permettant de déclarer des équivalences explicites :

```yaml
keywords: [auth, authentication, login, jwt]
aliases:
  inscription: [auth, login]
  connexion: [auth, login]
  sign-in: [login]
  oauth: [auth, provider]
```

Lors du tokenizing, chaque token du contexte est expansé via la table d'aliases avant le scoring. Le mécanisme reste déterministe et débogable : les mappings sont visibles dans le fichier, versionnés, reviewables. Pas de magie.

### b) Fallback sur la description en cas de no_match

Quand le keyword matching ne produit aucun résultat au-dessus de `min_score`, effectuer un second pass en tokenisant les champs `description` de chaque skill et en scorant le contexte contre ces tokens. Même algorithme, même déterminisme, mais élargit le recall sans toucher à la précision du premier pass.

### c) Suggestions de keywords depuis les analytics

Quand des événements `no_match` s'accumulent avec des contextes similaires, les regrouper et proposer des keywords candidats pour les skills existants. Exemple de sortie :

```
Le contexte "formulaire inscription utilisateur" a produit 12 no_match ce mois.
Skills proches : ui/react/auth (score 0.15, manque: inscription, formulaire)
→ Suggestion : ajouter "inscription", "formulaire" aux keywords de ui/react/auth
```

---

## 2. Corriger le biais structurel du scoring

**Problème adressé :** un skill avec 3 keywords dont 2 matchent (0.67) bat un skill avec 8 keywords dont 5 matchent (0.63), alors que le second est objectivement plus pertinent.

### a) Pondération par nombre de matches absolu

Modifier la formule pour intégrer un bonus au nombre absolu de correspondances :

```
baseScore = matchedCount / totalKeywords
absoluteBonus = matchedCount * 0.02
finalScore = baseScore + absoluteBonus + (priority * 0.001)
```

Le skill avec 5/8 matches (0.63 + 0.10 = 0.73) bat désormais celui avec 2/3 (0.67 + 0.04 = 0.71). Le ratio reste dominant, mais les matches multiples sont récompensés.

### b) IDF-like weighting (optionnel, plus ambitieux)

Pondérer chaque keyword par sa rareté dans le corpus de skills. Un keyword présent dans un seul skill vaut plus qu'un keyword présent dans 15. Cela résout aussi partiellement le problème d'ambiguïté sur des termes génériques comme "auth" partagé entre `ui/react/auth` et `api/auth`.

---

## 3. Réduire la dépendance à l'invocation volontaire de l'IA

**Problème adressé :** skills-mcp est passif ; si l'IA ne pense pas à appeler `get_skill`, les conventions ne sont pas appliquées.

### a) Générer un `CLAUDE.md` minimal depuis l'arbre de skills

Ajouter une commande `npx skills-mcp generate-claude-md` qui produit un fichier léger listant les domaines couverts avec une instruction d'appel :

```markdown
## Skills disponibles (skills-mcp)

Ce projet utilise skills-mcp pour les conventions de code.
Avant de générer du code dans les domaines suivants, appelle `get_skill` :

- **ui/react** : composants React, hooks, testing (auth, forms, routing)
- **api** : endpoints REST, middleware, auth JWT
- **infra** : Docker, CI/CD, déploiement

→ Appelle toujours `get_skill("<domaine>")` avant de coder dans ces domaines.
```

Le `CLAUDE.md` (toujours chargé) sert de "déclencheur" fiable, skills-mcp sert le contenu détaillé à la demande. Les deux systèmes se complètent au lieu de se substituer.

### b) Description dynamique de l'outil MCP

Enrichir la description du tool `get_skill` enregistré auprès du MCP avec un résumé compact des domaines disponibles. L'IA voit dans sa liste d'outils non pas juste "Search skills by context" mais "Search skills by context. Available domains: ui/react, api, infra, testing, database". Cela augmente la probabilité d'invocation sans aucun coût en contexte permanent.

---

## 4. Baisser la barrière d'adoption

**Problème adressé :** le coût d'entrée est disproportionné pour commencer.

### a) Commande d'initialisation

`npx skills-mcp init` qui :
- Crée la structure `skills/` avec un `_root.md` pré-rempli et un skill exemple
- Génère un `config.yaml` avec les défauts commentés
- Produit un `.mcp.json` prêt à l'emploi
- Affiche les next steps

### b) Migration depuis CLAUDE.md

`npx skills-mcp migrate ./CLAUDE.md` qui analyse un fichier de règles existant, identifie les sections thématiques (par headings), et propose un découpage en skills avec des keywords suggérés. L'utilisateur valide/ajuste, la commande génère les fichiers.

### c) Linter de skills

`npx skills-mcp lint` exécutable en CI qui vérifie :
- Frontmatter valide sur tous les `.md`
- Pas de keywords dupliqués entre siblings directs (source d'ambiguïté)
- Assets déclarés mais fichiers manquants
- Skills sans keywords ou avec <3 keywords (warning)
- Détection de `_index.md` manquants dans la chaîne d'héritage

---

## 5. Durcir la résilience de la sync Git

**Problème adressé :** premier lancement sans cache = zéro skills si le réseau est indisponible.

### a) Snapshot embarqué dans le package npm

Permettre de bundler un snapshot des skills dans le package npm publié. Si le clone Git échoue et qu'aucun cache local n'existe, le serveur démarre avec le snapshot (potentiellement périmé mais fonctionnel). Un warning est émis sur stderr.

### b) Outil `health` / statut dans `list_skills`

Ajouter un champ `sync_status` dans la réponse de `list_skills` :

```json
{
  "sync_status": {
    "mode": "git",
    "last_sync": "2026-02-19T10:30:00Z",
    "cache_age_minutes": 45,
    "commit": "a1b2c3d",
    "healthy": true
  },
  "skills": [...]
}
```

L'IA et l'utilisateur savent immédiatement si les skills sont à jour ou dégradés.

---

## 6. Rendre les analytics actionnables sans effort

**Problème adressé :** les analytics ne valent que si quelqu'un les exploite.

### a) Rapport local intégré

`npx skills-mcp report` qui lit le fichier `analytics-buffer.jsonl` local et produit un résumé :

```
=== Rapport skills-mcp (30 derniers jours) ===

Skills les plus servis : ui/react/auth (47x), api/auth (31x), testing (28x)
Taux de feedback positif : 82%
No-match fréquents :
  - "docker compose production" (8x) → aucun skill infra/docker
  - "formulaire inscription" (5x) → ui/react/auth proche mais keywords manquants
Ambiguïtés récurrentes :
  - "auth middleware" → ui/react/auth vs api/auth (12x)
Skills jamais servis : infra/ci, database/migration
```

Pas de dashboard externe, pas de setup : juste une commande qui lit ce qui est déjà collecté.

### b) Intégration CI optionnelle

Le même rapport en format JSON/Markdown, utilisable dans un workflow GitHub Actions qui poste un commentaire hebdomadaire sur le repo de skills avec les métriques et suggestions.

---

## 7. Composition horizontale entre skills

**Problème adressé :** l'héritage est uniquement vertical (parent → enfant). Impossible de réutiliser du contenu entre branches sans le dupliquer.

Ajouter un champ `includes` dans le frontmatter :

```yaml
includes:
  - testing/_index    # Inclut les règles de testing dans ce skill
  - api/auth          # Inclut les patterns d'auth API
```

Le contenu des skills inclus est ajouté après le contenu hérité, dans une section distincte. Cela permet par exemple à un skill `ui/react/auth` d'inclure les règles de `api/auth` quand les deux sont pertinents ensemble, sans forcer l'IA à faire deux appels.

---

## 8. Skills conditionnels par détection de projet

**Problème adressé :** les skills sont tous disponibles tout le temps, même ceux non pertinents pour le projet courant.

Ajouter un champ optionnel `when` dans le frontmatter :

```yaml
when:
  files_exist:
    - package.json          # Projet Node.js
  dependencies:
    - react                 # React est une dépendance
```

Au `buildIndex`, le serveur vérifie les conditions dans le `cwd` transmis. Les skills dont les conditions ne sont pas remplies sont exclus de l'index. Cela réduit le bruit et les faux matches sans action de l'utilisateur.

---

## Résumé par impact

| Proposition | Effort | Impact sur les faiblesses | Risque |
|-------------|--------|--------------------------|--------|
| Aliases/synonymes | Faible | Recall du matching | Aucun |
| Fallback sur description | Faible | Couverture no_match | Aucun |
| Bonus matches absolus | Faible | Biais structurel | Régression scoring à valider |
| Génération CLAUDE.md | Moyen | Fiabilité d'invocation | Aucun |
| Description dynamique MCP | Faible | Fiabilité d'invocation | Aucun |
| `init` + `migrate` + `lint` | Moyen | Barrière d'adoption | Aucun |
| Snapshot embarqué | Moyen | Résilience Git | Complexité packaging |
| Rapport analytics local | Moyen | Analytics actionnables | Aucun |
| Suggestions keywords auto | Moyen | Maintenance keywords | Aucun |
| Composition horizontale | Moyen | Réutilisation cross-branche | Complexité résolution |
| IDF weighting | Élevé | Scoring + ambiguïté | Complexité algo |
| Skills conditionnels | Élevé | Pertinence / bruit | Complexité index |

Les 6 premières lignes offrent le meilleur ratio effort/impact et peuvent être implémentées incrémentalement sans casser l'existant.
