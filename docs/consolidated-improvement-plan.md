# Plan d'amélioration consolidé — skills-mcp

> **Date** : 20 février 2026
> **Sources croisées** : `claude-code-memory-research.md`, analyse du code source, `docs/improvements.md`, analyse des patterns MCP
> **Principe directeur** : chaque proposition est justifiée par un constat factuel sur le code ET un insight de la recherche. Pas d'ajout spéculatif.

---

## Vue d'ensemble

La recherche sur les systèmes de mémoire pour Claude Code identifie une conclusion centrale :

> *"Le problème fondamental n'est pas le stockage mais la sélection."* (§5)

skills-mcp est un système de stockage et de livraison de compétences. Son contenu est versionné dans Git, structuré en arbre avec héritage — c'est solide. Mais le **retrieval** (comment la bonne skill arrive au bon moment avec le bon volume de contenu) et l'**intégration** (comment le MCP s'insère dans l'écosystème natif de Claude Code) sont les deux axes où les gains sont les plus significatifs.

Les améliorations sont organisées en **6 axes**, chacun adressant un gap documenté. Chaque proposition inclut le fichier source impacté et une estimation d'effort calibrée sur le code existant.

---

## Axe 1 — Matching & Retrieval

**Constat** : le `KeywordMatcher` (72 lignes) fait du matching syntaxique pur. Le champ `description` n'est jamais utilisé pour le scoring. Pas de synonymes. Le scoring `matched/total` pénalise les skills avec beaucoup de keywords.

**Insight recherche** : *"ChatGPT illustre ce risque : la sélection de mémoire a injecté sa localisation dans une image sans rapport"* — la précision de sélection est critique.

### 1.1 Synonymes et aliases dans le frontmatter

**Fichiers** : `types/index.ts` (type `Frontmatter`), `skill-index.ts` (`parseFrontmatter`), `keyword-matcher.ts` (`score`)

Ajouter un champ optionnel `aliases` au frontmatter :

```yaml
keywords: [auth, authentication, login]
aliases:
  inscription: [auth, login]
  sign-in: [login]
  postgres: [database, db]
```

Au scoring, chaque token du contexte est expansé via les aliases de la skill avant le matching. Le mécanisme reste déterministe et versionné.

**Complément : synonymes globaux dans `config.yaml`** pour les mappings transversaux (ex: `test → [testing, spec, jest, vitest]`). Les deux niveaux coexistent, le frontmatter prenant priorité.

**Effort** : ~40 lignes. Parsing des aliases dans `parseFrontmatter` + expansion dans `score()`.

### 1.2 Scoring sur la description en fallback

**Fichier** : `keyword-matcher.ts`, `skill-index.ts` (`search`)

Quand le keyword matching ne produit aucun résultat au-dessus de `min_score`, effectuer un second pass sur les tokens des `description` de chaque skill. Pondérer à 0.3× le score keyword pour ne pas polluer la précision du premier pass.

Ce champ existe, est rempli pour chaque skill, mais n'est **jamais exploité pour le matching** — uniquement pour l'affichage en cas d'ambiguïté.

**Effort** : ~25 lignes. Un second appel à `score()` avec les tokens de la description.

### 1.3 Correction du biais structurel de scoring

**Fichier** : `keyword-matcher.ts` (`score`, ligne 52)

Le score actuel `matchedKeywords.length / lowerKeywords.length` favorise les skills pauvres en keywords. Ajouter un bonus au nombre absolu de matches :

```
baseScore = matchedCount / totalKeywords
absoluteBonus = matchedCount * 0.02
finalScore = baseScore + absoluteBonus + (priority * 0.001)
```

5/8 matches (0.63 + 0.10 = 0.73) bat 2/3 (0.67 + 0.04 = 0.71). Le ratio reste dominant mais les matches multiples sont récompensés.

**Effort** : 3 lignes modifiées dans `score()`.

### 1.4 Normalisation minimale des tokens

**Fichier** : `keyword-matcher.ts` (`tokenize`)

Table de suffixes courants à normaliser : `-ing` → `""`, `-tion` → `""`, `-ment` → `""`, pluriels en `-s`. Pas de NLP — juste une fonction de 15 lignes qui améliore le recall sur "testing" ↔ "test", "authentication" ↔ "authenticat" (qui matche "auth" par substring).

**Effort** : ~15 lignes. Fonction `normalize()` appliquée dans `tokenize()`.

### 1.5 Accès direct par skill_path

**Fichier** : `tools/get-skill.ts`

`skillIndex.getSkillByPath()` existe mais n'est **pas exposé** dans l'outil MCP. L'agent qui connaît déjà le path (après une ambiguïté résolue, ou depuis `list_skills`) doit repasser par le matching keyword.

Ajouter un paramètre optionnel `skill_path` à `get_skill`. Si fourni, bypass le matching et fetch directement. Score garanti = 1.0.

**Effort** : ~10 lignes. Un `if (skill_path)` avant le matching existant.

---

## Axe 2 — Proactivité & Intégration native Claude Code

**Constat** : le MCP ne déclare que des `tools`. Claude doit décider de les appeler. La description de `get_skill` est générique ("Search and return the most relevant skill"). Aucune utilisation des MCP Prompts ni des MCP Resources.

**Insight recherche** : *"Le pattern SessionStart et la tendance à l'injection proactive de contexte au démarrage de session sont omniprésents"* (§1.5, §2.8). *"Claude ne l'utilise pas proactivement — il faut dire 'check bd ready'"* (limite de Beads, §2.1).

### 2.1 MCP Prompts pour l'injection proactive

**Fichier** : `server.ts` (nouveau : `registerPrompts` à côté de `registerGetSkill`)

Le SDK `@modelcontextprotocol/sdk` supporte les prompts nativement. Déclarer :

- **`onboarding`** : prompt qui retourne un résumé des domaines couverts + instructions d'usage. Claude Code peut le tirer au démarrage de session.
- **`session_context`** : prompt qui retourne l'arbre de skills avec descriptions, optimisé pour l'injection au démarrage.
- **`skill_for_file`** : prompt paramétré par un chemin de fichier, retourne les skills pertinentes pour ce fichier.

C'est le pont entre le mode passif actuel et l'injection proactive identifiée comme critique par la recherche.

**Effort** : ~50 lignes. Le SDK fait le gros du travail.

### 2.2 Description dynamique de l'outil get_skill

**Fichier** : `tools/get-skill.ts` (ligne 122-124), `server.ts`

Enrichir la description du tool `get_skill` enregistré auprès du MCP avec un résumé compact des domaines disponibles, généré dynamiquement après `buildIndex()` :

```
"Search and return the most relevant skill. Available domains: ui/react (components, hooks, auth), api (REST, middleware, JWT), infra (Docker, CI/CD). Use before coding in these areas."
```

L'agent voit dans sa liste d'outils **ce qui est disponible** — pas juste un outil générique. Augmente la probabilité d'invocation sans coût en contexte permanent.

**Effort** : ~15 lignes. Lecture des top-level paths après `buildIndex`, concaténation dans la description.

### 2.3 Génération de fichiers `.claude/rules/` depuis les skills

**Fichier** : nouveau CLI command ou outil MCP `generate_claude_rules`

Le mécanisme `.claude/rules/` (§1.2 de la recherche) est le système de mémoire conditionnelle le plus efficace : chargé automatiquement, scopé aux fichiers touchés, zéro coût quand non pertinent.

Un outil/commande qui transforme les skills en fichiers `.claude/rules/*.md` avec le frontmatter `paths` approprié crée un **bridge vers la mémoire native** :

```yaml
# .claude/rules/ui-react-auth.md (généré par skills-mcp)
---
paths:
  - "src/components/auth/**"
---
# Authentication Components
[contenu condensé de la skill ui/react/auth]
```

Nécessite un champ optionnel `applies_to` dans le frontmatter des skills pour définir les paths cible.

**Effort** : Moyen (~80 lignes). Mapping skill → rules file + CLI ou outil MCP.

### 2.4 Génération d'un CLAUDE.md minimal de trigger

**Fichier** : nouveau CLI command `generate-claude-md`

Complémentaire à 2.3. Produit un fichier léger listant les domaines couverts avec une instruction impérative d'appel `get_skill`. Le `CLAUDE.md` (toujours chargé) sert de déclencheur, le MCP sert le contenu à la demande.

**Effort** : ~40 lignes. Lecture de l'arbre, formatage markdown.

---

## Axe 3 — Efficacité tokens

**Constat** : `SkillResolver.resolve()` concatène systématiquement tout le contenu hérité. `get_skill` retourne toujours assets + scripts + inherited. La config `inline_text_max_bytes` existe mais n'est utilisée nulle part.

**Insight recherche** : *"L'efficacité en tokens prime sur la richesse des features"* (§5). *"Après 50 utilisations d'outils, le contexte explose à 500k+ tokens"* (§2.5). *"Context rot où la qualité se détériore même sans atteindre la limite technique"* (§3.1).

### 3.1 Champ `summary` dans le frontmatter

**Fichiers** : `types/index.ts`, `skill-index.ts`, `tools/get-skill.ts`

Ajouter un champ optionnel `summary` (1-2 lignes impératives) au frontmatter. Affiché **en premier** dans la réponse de `get_skill`, avant le contenu hérité.

Justification directe : la compaction (§1.4) est lossy. Les résumés brefs et impératifs survivent mieux à la paraphrase que le contenu long. Une règle *"Toujours utiliser useAuth() pour l'authentification dans les composants React"* a plus de chances de persister après compaction que 200 lignes de guide détaillé.

Retourné aussi dans `list_skills` pour que l'agent puisse décider s'il a besoin du contenu complet.

**Effort** : ~15 lignes. Champ optionnel dans le type, affiché en tête de réponse.

### 3.2 Paramètre `include_inherited` sur get_skill

**Fichier** : `tools/get-skill.ts`

Paramètre optionnel (default: `true` pour backward compat). Quand `false`, retourne uniquement le contenu de la skill elle-même. L'agent qui a déjà vu le contenu parent (dans une session longue) peut re-demander une skill sans recharger toute la chaîne.

**Effort** : ~15 lignes. Zod schema + condition dans `handleGetSkill`.

### 3.3 Inlining des petits assets texte

**Fichier** : `tools/get-skill.ts`

La config `inline_text_max_bytes` (10 KB par défaut, `types/index.ts:170`) existe mais **n'est pas implémentée**. Les petits templates/configs pourraient être inclus directement dans la réponse de `get_skill`, évitant un aller-retour `get_asset`.

Implémentation : pour chaque asset texte dont la taille est inférieure au seuil, lire le contenu et l'inclure dans la réponse sous une clé `inline_content`.

**Effort** : ~30 lignes. Lecture conditionnelle des fichiers + ajout au payload.

### 3.4 MCP Resources pour le browsing passif

**Fichier** : `server.ts` (nouveau : handlers `resources/list` et `resources/read`)

Exposer les skills comme URIs MCP (`skill://ui/react/auth`). Les resources sont listées passivement par l'agent sans coût en tokens pour le schema. Contrairement à `list_skills` (un tool call = des tokens), la liste de resources est disponible gratuitement dans le protocole MCP.

**Effort** : ~50 lignes. Le SDK supporte les resources nativement.

---

## Axe 4 — Feedback loop & Apprentissage

**Constat** : `report_usage` collecte `useful/not_useful` + `comment` mais ne les réutilise pas. Le tracker enregistre `no_match`, `ambiguous`, `skill_served` — signal d'or inexploité.

**Insight recherche** : *"La réflexion sur les trajectoires peut distiller non seulement des mémoires mais des procédures réutilisables"* (§5, Lance Martin). Le cycle diary/reflect (§2.3) montre que feedback → mise à jour des règles est le pattern le plus rentable.

### 4.1 Stats d'usage persistantes avec bonus/malus au scoring

**Fichiers** : nouveau `src/core/usage-stats.ts`, modification de `keyword-matcher.ts`

Fichier local (`~/.skills-mcp/usage-stats.json`) avec compteurs par skill path :

```json
{
  "ui/react/auth": { "served": 47, "useful": 38, "not_useful": 3 },
  "api/auth": { "served": 31, "useful": 25, "not_useful": 6 }
}
```

Chargé au démarrage du serveur. `report_usage` met à jour le fichier. Le scoring ajoute un bonus léger basé sur le taux de feedback positif :

```
usageBonus = (useful / served) * 0.05  // max +0.05 pour une skill toujours utile
```

Le MCP apprend de l'usage sans vector DB, sans NLP, sans complexité.

**Effort** : ~60 lignes (lecture/écriture JSON + intégration scoring).

### 4.2 Outil analyze_usage (ou commande CLI `report`)

**Fichier** : nouveau `src/tools/analyze-usage.ts` ou CLI command

Lit le `analytics-buffer.jsonl` et produit :

- **no_match récurrents** : quels termes échouent systématiquement → suggestions de keywords à ajouter
- **ambiguïtés récurrentes** : quelles paires de skills sont toujours en conflit → suggestions de différenciation (keywords plus spécifiques, priority)
- **skills jamais servies** : dead weight dans l'index
- **top skills** par fréquence et taux de feedback positif

Peut être exposé comme outil MCP (`analyze_usage`) ET comme commande CLI (`npx skills-mcp report`). Les données existent déjà, il manque juste le consumer.

**Effort** : ~80 lignes pour le consumer + formatage.

---

## Axe 5 — Conscience de session

**Constat** : le MCP est stateless entre les appels d'outils. Chaque `get_skill` est indépendant. Pas de notion de "déjà servi dans cette session".

**Insight recherche** : *"Episodic Memory et Claude-Mem montrent la valeur de la mémoire intra-session"* (§2.2, §2.4). *"Problème de drift comportemental après compaction"* (§1.4) — lié au fait que le contexte n'est pas consolidé.

### 5.1 Tracking de session in-memory

**Fichier** : `server.ts`, `tools/get-skill.ts`

Le transport stdio = une connexion = une session. Maintenir un `Set<string>` des skill paths servis dans la session en cours.

Effets :
- Quand la même skill est re-demandée, retourner le `summary` (si existant) + un flag `already_served: true` au lieu du contenu complet. L'agent sait qu'il l'a déjà et peut décider s'il veut le full content (via `include_inherited: true` explicite).
- Le tracking alimente les co-occurrences (axe 5.2).

**Effort** : ~20 lignes. Un `Set` dans `createServer`, passé aux deps des tools.

### 5.2 Suggestions de skills connexes (related skills)

**Fichier** : `tools/get-skill.ts`, `usage-stats.ts`

Basé sur les co-occurrences historiques : "les sessions qui ont demandé `ui/react/auth` demandent souvent ensuite `api/auth`". Stocké dans les usage-stats :

```json
{
  "ui/react/auth": {
    "co_occurrences": { "api/auth": 23, "testing/_index": 15 }
  }
}
```

Retourné dans la réponse de `get_skill` sous une clé `related_skills`. L'agent découvre des skills pertinentes sans avoir à deviner.

**Effort** : ~40 lignes (tracking des co-occurrences + inclusion dans la réponse).

---

## Axe 6 — Structuration du contenu

**Constat** : l'héritage est uniquement vertical (parent → enfant). Pas de réutilisation cross-branche. Pas de scoping par fichiers projet.

**Insight recherche** : *"Le consensus émerge que les agents de codage ont déjà accès au filesystem"* (§5). Le scoping par paths des `.claude/rules/` (§1.2) est le modèle à suivre.

### 6.1 Composition horizontale via `includes`

**Fichiers** : `types/index.ts`, `skill-index.ts`, `skill-resolver.ts`

Champ `includes` dans le frontmatter :

```yaml
includes:
  - testing/_index
  - api/auth
```

Le contenu des skills incluses est ajouté après le contenu hérité, dans une section distincte. Permet à `ui/react/auth` d'inclure les patterns de `api/auth` sans forcer l'agent à faire deux appels.

**Effort** : ~40 lignes dans le resolver + parsing du champ.

### 6.2 Champ `applies_to` pour le scoping par paths projet

**Fichier** : `types/index.ts`, `tools/get-skill.ts`

Champ optionnel dans le frontmatter :

```yaml
applies_to:
  - "src/components/auth/**"
  - "src/hooks/useAuth*"
```

Quand le contexte de `get_skill` mentionne un chemin de fichier, les skills dont `applies_to` matche reçoivent un boost au scoring. Pas d'exclusion — juste un signal de pertinence supplémentaire.

Alimente aussi l'axe 2.3 (`generate_claude_rules`) qui utilise ce champ pour générer le frontmatter `paths` des rules natives.

**Effort** : ~35 lignes. Parsing + glob matching dans le scoring.

---

## Matrice de priorisation consolidée

Les propositions sont classées par ratio impact/effort, en tenant compte des dépendances entre elles.

### Tier 1 — Quick wins à fort ROI (à implémenter en premier)

| # | Amélioration | Effort | Impact | Justification |
|---|---|---|---|---|
| 1.5 | Accès direct par `skill_path` | ~10 lignes | Fort | Élimine le matching quand l'agent sait déjà quoi chercher |
| 1.3 | Correction biais scoring | ~3 lignes | Moyen | Corrige un bug de ranking documenté |
| 3.1 | Champ `summary` | ~15 lignes | Moyen | Résistance à la compaction, zéro risque |
| 2.2 | Description dynamique de get_skill | ~15 lignes | Fort | Augmente la probabilité d'invocation |
| 3.2 | Paramètre `include_inherited` | ~15 lignes | Moyen | Contrôle granulaire du coût contextuel |

**Total Tier 1** : ~60 lignes, implémentable en une session, aucune dépendance externe.

### Tier 2 — Améliorations structurantes (itération suivante)

| # | Amélioration | Effort | Impact | Dépendances |
|---|---|---|---|---|
| 1.1 | Synonymes/aliases | ~40 lignes | Fort | Aucune |
| 1.2 | Scoring sur description en fallback | ~25 lignes | Moyen | Aucune |
| 1.4 | Normalisation tokens | ~15 lignes | Moyen | Synergique avec 1.1 |
| 3.3 | Inlining petits assets | ~30 lignes | Moyen | Aucune |
| 2.1 | MCP Prompts | ~50 lignes | Fort | Aucune |
| 5.1 | Tracking de session | ~20 lignes | Moyen | Aucune |

**Total Tier 2** : ~180 lignes. Le matching s'améliore significativement. L'intégration MCP passe de passive à proactive.

### Tier 3 — Feedback loop et intégration avancée

| # | Amélioration | Effort | Impact | Dépendances |
|---|---|---|---|---|
| 4.1 | Stats d'usage + bonus scoring | ~60 lignes | Moyen | 1.3 (scoring) |
| 4.2 | Outil analyze_usage / report | ~80 lignes | Moyen | Analytics existantes |
| 2.3 | Génération `.claude/rules/` | ~80 lignes | Fort | 6.2 (applies_to) |
| 2.4 | Génération CLAUDE.md de trigger | ~40 lignes | Moyen | Arbre de skills existant |
| 5.2 | Related skills (co-occurrences) | ~40 lignes | Moyen | 5.1 (session tracking) |
| 3.4 | MCP Resources | ~50 lignes | Moyen | Aucune |

**Total Tier 3** : ~350 lignes. Le MCP devient un système qui apprend et s'intègre dans l'écosystème natif.

### Tier 4 — Évolutions structurelles (quand les tiers 1-3 sont stables)

| # | Amélioration | Effort | Impact | Risque |
|---|---|---|---|---|
| 6.1 | Composition horizontale (`includes`) | ~40 lignes | Moyen | Complexité de résolution |
| 6.2 | Scoping `applies_to` | ~35 lignes | Moyen | Nécessite des données de paths dans les skills |

---

## Ce qui a été explicitement écarté

| Idée | Raison de l'exclusion |
|---|---|
| **Embeddings vectoriels** (§2.2, §2.5) | Sur-ingéniéré pour un index de skills de taille modeste. Keyword matching + synonymes + description fallback couvrent 95% des cas. |
| **PreCompact hooks côté serveur** | Les hooks sont côté client (Claude Code), pas côté serveur MCP. Le champ `summary` est la réponse côté serveur. |
| **Memory Bank** (§2.6) | Le document de recherche lui-même conclut au scepticisme. L'approche skills est meilleure. |
| **Auto Memory** (§1.3) | Natif à Claude Code, hors périmètre du MCP. |
| **Beads** (§2.1) | Résout le tracking de tâches, orthogonal à la livraison de skills. |
| **Skills conditionnels `when`** (détection de projet) | Trop de complexité d'implémentation (lire package.json, analyser les deps) pour un gain incertain. Le scoping par `applies_to` + la description dynamique couvrent le même besoin plus simplement. |
| **IDF weighting** | Bon en théorie mais complexifie significativement le scoring pour un gain marginal quand les synonymes et le bonus absolu sont en place. À reconsidérer si les ambiguïtés persistent après le Tier 2. |

---

## Validation par la recherche

Le positionnement de skills-mcp est directement validé par la conclusion la plus forte du document de recherche :

> *"La frontière avance : au-delà de la mémoire (ce que Claude sait), les systèmes commencent à évoluer vers l'extraction de compétences (ce que Claude sait faire)."* (§5)

skills-mcp **est** ce système de compétences. Les améliorations proposées ne changent pas son architecture — elles rendent le retrieval plus robuste (Axe 1), l'intégration plus fluide (Axe 2), la livraison plus efficiente (Axe 3), et introduisent une boucle d'apprentissage (Axe 4) que la recherche identifie comme le pattern le plus rentable.
