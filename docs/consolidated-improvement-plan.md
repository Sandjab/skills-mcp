# Plan d'amelioration consolide — skills-mcp

> **Date** : 21 fevrier 2026 (v2)
> **Sources croisees** : `claude-code-memory-research.md`, analyse du code source, `docs/improvements.md`, analyse des patterns MCP, **documentation officielle Anthropic** (Claude Code skills, specification MCP, SDK `@modelcontextprotocol/sdk` v1.12.1)
> **Principe directeur** : chaque proposition est justifiee par un constat factuel sur le code ET un insight de la recherche. Pas d'ajout speculatif. Les ajouts v2 sont valides par croisement avec la documentation Anthropic.

---

## Vue d'ensemble

La recherche sur les systemes de memoire pour Claude Code identifie une conclusion centrale :

> *"Le probleme fondamental n'est pas le stockage mais la selection."* (S5)

skills-mcp est un systeme de stockage et de livraison de competences. Son contenu est versionne dans Git, structure en arbre avec heritage — c'est solide. Mais le **retrieval** (comment la bonne skill arrive au bon moment avec le bon volume de contenu) et l'**integration** (comment le MCP s'insere dans l'ecosysteme natif de Claude Code) sont les deux axes ou les gains sont les plus significatifs.

**Architecture en couches de Claude Code.** L'ecosysteme natif offre plusieurs mecanismes de memoire et de configuration, chacun avec son propre mode d'injection dans le contexte de l'agent. De la couche la plus permanente a la plus ephemere : `CLAUDE.md` (toujours charge), `.claude/rules/` (charge par paths), skills natifs `.claude/skills/` (description toujours visible, contenu a la demande), Auto Memory (`~/.claude/projects/*/memory/`), et enfin les MCP servers (outils a la demande). Comprendre cette architecture est essentiel pour positionner skills-mcp au bon niveau — ni en concurrence avec les mecanismes natifs, ni en doublon, mais en complement.

Les ameliorations sont organisees en **7 axes**, chacun adressant un gap documente. Chaque proposition inclut le fichier source impacte et une estimation d'effort calibree sur le code existant.

---

## Positionnement dans l'ecosysteme Claude Code

### Mecanismes natifs et interaction avec skills-mcp

| Mecanisme | Mode d'injection | Role | Interaction avec skills-mcp |
|---|---|---|---|
| **CLAUDE.md** | Toujours charge, ~toute la fenetre | Regles projet imperatives, conventions globales | Declencheur leger ("appelle `get_skill` pour..."). Pas de contenu duplique. |
| **.claude/rules/** | Charge automatiquement quand les paths matchent | Regles conditionnelles par fichiers/repertoires | Cible de generation (axe 2.3). Le MCP genere des rules depuis les skills. |
| **Skills natifs** (`.claude/skills/`) | Description toujours en contexte (<2% fenetre, max 16000 chars). Contenu servi quand invoque. `user-invocable: false` = proactif. | Competences structurees, templates | **Pont proactif** (axe 2.0). Un skill natif genere par skills-mcp sert de catalogue permanent. |
| **Auto Memory** (`~/.claude/projects/*/memory/`) | MEMORY.md toujours charge (200 lignes). Fichiers annexes sur demande. | Preferences utilisateur, patterns confirmes | Hors perimetre MCP. Complementaire (preferences vs conventions). |
| **Hooks** (`settings.json`) | Executes sur evenements (PreToolUse, PostToolUse, etc.) | Automatisation, validation | Potentiel pour declencher des actions post-skill. Non prioritaire. |
| **MCP Servers** (skills-mcp) | Outils a la demande. L'agent decide d'appeler. | Contenu riche, versionne, herite | Position actuelle. L'enjeu est d'augmenter la proactivite. |

### Strategie de complementarite en 3 couches

1. **Couche "toujours la"** — Un skill natif `.claude/skills/conventions/SKILL.md` (genere par skills-mcp, `user-invocable: false`) dont la description liste les domaines couverts. Toujours visible dans le contexte de l'agent, cout negligeable (<2% fenetre). L'agent sait a tout moment ce qui est disponible.

2. **Couche "a la demande"** — skills-mcp via `get_skill`. Le contenu riche (heritage, assets, scripts) est servi uniquement quand l'agent en a besoin. Pas de gaspillage de tokens.

3. **Couche "locale"** — `.claude/rules/` generees depuis les skills (axe 2.3). Les regles critiques sont injectees automatiquement quand les fichiers concernes sont touches. Zero dependance a la decision de l'agent.

---

## Axe 1 — Matching & Retrieval

**Constat** : le `KeywordMatcher` (72 lignes) fait du matching syntaxique pur. Le champ `description` n'est jamais utilise pour le scoring. Pas de synonymes. Le scoring `matched/total` penalise les skills avec beaucoup de keywords.

**Insight recherche** : *"ChatGPT illustre ce risque : la selection de memoire a injecte sa localisation dans une image sans rapport"* — la precision de selection est critique.

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

Au scoring, chaque token du contexte est expanse via les aliases de la skill avant le matching. Le mecanisme reste deterministe et versionne.

**Complement : synonymes globaux dans `config.yaml`** pour les mappings transversaux (ex: `test -> [testing, spec, jest, vitest]`). Les deux niveaux coexistent, le frontmatter prenant priorite.

**Effort** : ~40 lignes. Parsing des aliases dans `parseFrontmatter` + expansion dans `score()`.

### 1.2 Scoring sur la description en fallback

**Fichier** : `keyword-matcher.ts`, `skill-index.ts` (`search`)

Quand le keyword matching ne produit aucun resultat au-dessus de `min_score`, effectuer un second pass sur les tokens des `description` de chaque skill. Ponderer a 0.3x le score keyword pour ne pas polluer la precision du premier pass.

Ce champ existe, est rempli pour chaque skill, mais n'est **jamais exploite pour le matching** — uniquement pour l'affichage en cas d'ambiguite.

**Effort** : ~25 lignes. Un second appel a `score()` avec les tokens de la description.

### 1.3 Correction du biais structurel de scoring

**Fichier** : `keyword-matcher.ts` (`score`, ligne 52)

Le score actuel `matchedKeywords.length / lowerKeywords.length` favorise les skills pauvres en keywords. Ajouter un bonus au nombre absolu de matches :

```
baseScore = matchedCount / totalKeywords
absoluteBonus = matchedCount * 0.02
finalScore = baseScore + absoluteBonus + (priority * 0.001)
```

5/8 matches (0.63 + 0.10 = 0.73) bat 2/3 (0.67 + 0.04 = 0.71). Le ratio reste dominant mais les matches multiples sont recompenses.

**Effort** : 3 lignes modifiees dans `score()`.

### 1.4 Normalisation minimale des tokens

**Fichier** : `keyword-matcher.ts` (`tokenize`)

Table de suffixes courants a normaliser : `-ing` -> `""`, `-tion` -> `""`, `-ment` -> `""`, pluriels en `-s`. Pas de NLP — juste une fonction de 15 lignes qui ameliore le recall sur "testing" <-> "test", "authentication" <-> "authenticat" (qui matche "auth" par substring).

**Effort** : ~15 lignes. Fonction `normalize()` appliquee dans `tokenize()`.

### 1.5 Acces direct par skill_path

**Fichier** : `tools/get-skill.ts`

`skillIndex.getSkillByPath()` existe mais n'est **pas expose** dans l'outil MCP. L'agent qui connait deja le path (apres une ambiguite resolue, ou depuis `list_skills`) doit repasser par le matching keyword.

Ajouter un parametre optionnel `skill_path` a `get_skill`. Si fourni, bypass le matching et fetch directement. Score garanti = 1.0.

**Effort** : ~10 lignes. Un `if (skill_path)` avant le matching existant.

---

## Axe 2 — Proactivite & Integration native Claude Code

**Constat** : le MCP ne declare que des `tools`. Claude doit decider de les appeler. La description de `get_skill` est generique ("Search and return the most relevant skill", `get-skill.ts:122`). Aucune utilisation des MCP Resources, et les MCP Prompts sont mal compris (cf. correction 2.1).

**Insight recherche** : *"Le pattern SessionStart et la tendance a l'injection proactive de contexte au demarrage de session sont omnipresents"* (S1.5, S2.8). *"Claude ne l'utilise pas proactivement — il faut dire 'check bd ready'"* (limite de Beads, S2.1).

### 2.0 Skill natif comme pont proactif (NOUVEAU v2)

**Impact** : CRITIQUE — mecanisme de proactivite le plus fiable de l'ecosysteme.

**Fichier** : nouvelle commande CLI `generate-skill` (ou outil MCP)

Genere un fichier `.claude/skills/conventions/SKILL.md` avec `user-invocable: false` dans le frontmatter. La description du skill liste les domaines couverts par skills-mcp et donne l'instruction d'appeler `get_skill`.

```yaml
---
description: "Conventions de code du projet. Domaines couverts : ui/react (composants, hooks, auth), api (REST, middleware, JWT), infra (Docker, CI/CD). Avant de coder dans ces domaines, appeler get_skill avec le domaine concerne."
user-invocable: false
---
```

**Pourquoi c'est critique** : les skills natifs avec `user-invocable: false` ont leur description **toujours visible** dans le contexte de l'agent (moins de 2% de la fenetre, max 16000 caracteres). L'agent sait en permanence que skills-mcp existe et ce qu'il couvre, sans avoir a deviner. C'est le mecanisme de proactivite le plus fiable car il ne depend pas d'une decision de l'agent — il est injecte automatiquement.

**Difference avec 2.4 (CLAUDE.md trigger)** : le CLAUDE.md est charge a chaque session et consomme de la fenetre en permanence. Le skill natif est plus leger (seule la description est chargee, pas le contenu) et s'integre dans le workflow natif de Claude Code.

**Effort** : ~60 lignes. Lecture de l'arbre de skills, generation du fichier avec frontmatter.

### 2.1 MCP Prompts pour l'onboarding (CORRIGE v2)

**Fichier** : `server.ts` (nouveau : `registerPrompts` a cote de `registerGetSkill`)

**Correction factuelle** : les MCP Prompts sont des **slash commands manuelles** (`/onboarding`, `/skill_for_file`), PAS de l'injection automatique au demarrage de session. La v1 les presentait comme un mecanisme d'injection proactive — c'est incorrect. Les Prompts MCP apparaissent dans la liste des slash commands de l'utilisateur et doivent etre invoques explicitement.

**Repositionnement** : outil d'onboarding et de decouverte, pas de proactivite.

Declarer :

- **`/onboarding`** : slash command qui retourne un resume des domaines couverts + instructions d'usage. Utile pour les nouveaux utilisateurs.
- **`/skill_for_file`** : slash command parametree par un chemin de fichier, retourne les skills pertinentes pour ce fichier. Utile pour la decouverte contextuelle.

**Effort** : ~50 lignes. Le SDK fait le gros du travail.

### 2.2 Description dynamique + notification `list_changed` (ENRICHI v2)

**Fichier** : `tools/get-skill.ts` (ligne 122-124), `server.ts`

Enrichir la description du tool `get_skill` enregistre aupres du MCP avec un resume compact des domaines disponibles, genere dynamiquement apres `buildIndex()` :

```
"Search and return the most relevant skill. Available domains: ui/react (components, hooks, auth), api (REST, middleware, JWT), infra (Docker, CI/CD). Use before coding in these areas."
```

L'agent voit dans sa liste d'outils **ce qui est disponible** — pas juste un outil generique. Augmente la probabilite d'invocation sans cout en contexte permanent.

**Enrichissement v2** : apres chaque git sync + reindex, mettre a jour la description via `RegisteredTool.update({ description })` et notifier le client via `server.sendToolListChanged()`. Le SDK MCP v1.12.1 confirme ces deux mecanismes (`mcp.d.ts` lignes 206 et 278). Ainsi la description reste a jour meme quand des skills sont ajoutees ou supprimees dans le repo.

**Effort** : ~20 lignes. Lecture des top-level paths apres `buildIndex`, concatenation dans la description, callback dans `content-updated`.

### 2.3 Generation de fichiers `.claude/rules/` depuis les skills

**Fichier** : nouveau CLI command ou outil MCP `generate_claude_rules`

Le mecanisme `.claude/rules/` (S1.2 de la recherche) est le systeme de memoire conditionnelle le plus efficace : charge automatiquement, scope aux fichiers touches, zero cout quand non pertinent.

Un outil/commande qui transforme les skills en fichiers `.claude/rules/*.md` avec le frontmatter `paths` approprie cree un **bridge vers la memoire native** :

```yaml
# .claude/rules/ui-react-auth.md (genere par skills-mcp)
---
paths:
  - "src/components/auth/**"
---
# Authentication Components
[contenu condense de la skill ui/react/auth]
```

Necessite un champ optionnel `applies_to` dans le frontmatter des skills pour definir les paths cible.

**Effort** : Moyen (~80 lignes). Mapping skill -> rules file + CLI ou outil MCP.

### 2.4 Generation d'un CLAUDE.md minimal de trigger (DEGRADE v2 -> Tier 3)

**Fichier** : nouveau CLI command `generate-claude-md`

Complementaire a 2.3. Produit un fichier leger listant les domaines couverts avec une instruction imperative d'appel `get_skill`. Le `CLAUDE.md` (toujours charge) sert de declencheur, le MCP sert le contenu a la demande.

**Degradation v2** : le skill natif (2.0) est un mecanisme plus fiable et plus leger que le CLAUDE.md pour le meme objectif. Le CLAUDE.md trigger passe en Tier 3 comme alternative pour les environnements qui ne supportent pas les skills natifs.

**Effort** : ~40 lignes. Lecture de l'arbre, formatage markdown.

### 2.5 Annotations d'outils (NOUVEAU v2)

**Fichier** : `tools/get-skill.ts`, `tools/list-skills.ts`, `tools/get-asset.ts`

Le SDK MCP v1.12.1 supporte les `ToolAnnotations` dans `server.tool()` et `registerTool()`. Declarer :

- `readOnlyHint: true` sur `get_skill`, `list_skills`, `get_asset` — ces outils ne modifient rien
- `openWorldHint: false` sur `get_skill`, `list_skills` — ces outils n'accedent pas a des ressources externes

Les annotations permettent au client MCP (Claude Code) de prendre des decisions plus intelligentes sur l'approbation automatique des outils et la gestion des permissions.

**Effort** : ~18 lignes. Ajout de l'objet `annotations` dans chaque appel `server.tool()`.

---

## Axe 3 — Efficacite tokens

**Constat** : `SkillResolver.resolve()` concatene systematiquement tout le contenu herite. `get_skill` retourne toujours assets + scripts + inherited. La config `inline_text_max_bytes` existe mais n'est utilisee nulle part.

**Insight recherche** : *"L'efficacite en tokens prime sur la richesse des features"* (S5). *"Apres 50 utilisations d'outils, le contexte explose a 500k+ tokens"* (S2.5). *"Context rot ou la qualite se deteriore meme sans atteindre la limite technique"* (S3.1).

### 3.1 Champ `summary` dans le frontmatter

**Fichiers** : `types/index.ts`, `skill-index.ts`, `tools/get-skill.ts`

Ajouter un champ optionnel `summary` (1-2 lignes imperatives) au frontmatter. Affiche **en premier** dans la reponse de `get_skill`, avant le contenu herite.

Justification directe : la compaction (S1.4) est lossy. Les resumes brefs et imperatifs survivent mieux a la paraphrase que le contenu long. Une regle *"Toujours utiliser useAuth() pour l'authentification dans les composants React"* a plus de chances de persister apres compaction que 200 lignes de guide detaille.

Retourne aussi dans `list_skills` pour que l'agent puisse decider s'il a besoin du contenu complet.

**Effort** : ~15 lignes. Champ optionnel dans le type, affiche en tete de reponse.

### 3.2 Parametre `include_inherited` sur get_skill

**Fichier** : `tools/get-skill.ts`

Parametre optionnel (default: `true` pour backward compat). Quand `false`, retourne uniquement le contenu de la skill elle-meme. L'agent qui a deja vu le contenu parent (dans une session longue) peut re-demander une skill sans recharger toute la chaine.

**Effort** : ~15 lignes. Zod schema + condition dans `handleGetSkill`.

### 3.3 Inlining des petits assets texte

**Fichier** : `tools/get-skill.ts`

La config `inline_text_max_bytes` (10 KB par defaut, `types/index.ts:170`) existe mais **n'est pas implementee**. Les petits templates/configs pourraient etre inclus directement dans la reponse de `get_skill`, evitant un aller-retour `get_asset`.

Implementation : pour chaque asset texte dont la taille est inferieure au seuil, lire le contenu et l'inclure dans la reponse sous une cle `inline_content`.

**Effort** : ~30 lignes. Lecture conditionnelle des fichiers + ajout au payload.

### 3.4 MCP Resources pour le browsing et les mentions @ (ENRICHI v2)

**Fichier** : `server.ts` (nouveau : handlers resources)

Exposer les skills comme URIs MCP via `ResourceTemplate` avec le pattern `skill://{path}`. Les resources MCP sont referencables dans Claude Code via la syntaxe `@skill://ui/react/auth`, ce qui permet a l'utilisateur de mentionner explicitement une skill dans son prompt.

Implementation :

- `ResourceTemplate` avec pattern `skill://{path}` et callback `list` pour l'enumeration des skills disponibles
- Handler `read` qui retourne le contenu resolu (avec heritage)
- Apres chaque git sync + reindex, appeler `server.sendResourceListChanged()` pour notifier le client que la liste a change

Contrairement a `list_skills` (un tool call = des tokens), la liste de resources est disponible passivement dans le protocole MCP. L'utilisateur peut taper `@skill://` et voir les completions.

**Effort** : ~60 lignes. ResourceTemplate + handlers + notification.

---

## Axe 4 — Feedback loop & Apprentissage

**Constat** : `report_usage` collecte `useful/not_useful` + `comment` mais ne les reutilise pas. Le tracker enregistre `no_match`, `ambiguous`, `skill_served` — signal d'or inexploite.

**Insight recherche** : *"La reflexion sur les trajectoires peut distiller non seulement des memoires mais des procedures reutilisables"* (S5, Lance Martin). Le cycle diary/reflect (S2.3) montre que feedback -> mise a jour des regles est le pattern le plus rentable.

### 4.1 Stats d'usage persistantes avec bonus/malus au scoring

**Fichiers** : nouveau `src/core/usage-stats.ts`, modification de `keyword-matcher.ts`

Fichier local (`~/.skills-mcp/usage-stats.json`) avec compteurs par skill path :

```json
{
  "ui/react/auth": { "served": 47, "useful": 38, "not_useful": 3 },
  "api/auth": { "served": 31, "useful": 25, "not_useful": 6 }
}
```

Charge au demarrage du serveur. `report_usage` met a jour le fichier. Le scoring ajoute un bonus leger base sur le taux de feedback positif :

```
usageBonus = (useful / served) * 0.05  // max +0.05 pour une skill toujours utile
```

Le MCP apprend de l'usage sans vector DB, sans NLP, sans complexite.

**Effort** : ~60 lignes (lecture/ecriture JSON + integration scoring).

### 4.2 Outil analyze_usage (ou commande CLI `report`)

**Fichier** : nouveau `src/tools/analyze-usage.ts` ou CLI command

Lit le `analytics-buffer.jsonl` et produit :

- **no_match recurrents** : quels termes echouent systematiquement -> suggestions de keywords a ajouter
- **ambiguites recurrentes** : quelles paires de skills sont toujours en conflit -> suggestions de differenciation (keywords plus specifiques, priority)
- **skills jamais servies** : dead weight dans l'index
- **top skills** par frequence et taux de feedback positif

Peut etre expose comme outil MCP (`analyze_usage`) ET comme commande CLI (`npx skills-mcp report`). Les donnees existent deja, il manque juste le consumer.

**Effort** : ~80 lignes pour le consumer + formatage.

---

## Axe 5 — Conscience de session

**Constat** : le MCP est stateless entre les appels d'outils. Chaque `get_skill` est independant. Pas de notion de "deja servi dans cette session".

**Insight recherche** : *"Episodic Memory et Claude-Mem montrent la valeur de la memoire intra-session"* (S2.2, S2.4). *"Probleme de drift comportemental apres compaction"* (S1.4) — lie au fait que le contexte n'est pas consolide.

### 5.1 Tracking de session in-memory

**Fichier** : `server.ts`, `tools/get-skill.ts`

Le transport stdio = une connexion = une session. Maintenir un `Set<string>` des skill paths servis dans la session en cours.

**Clarification v2 (transport)** : le tracking de session fonctionne naturellement en mode stdio (1 processus = 1 session). En mode HTTP (Streamable HTTP transport), le serveur est partage entre plusieurs sessions et il faudrait s'appuyer sur `meta.sessionId` disponible dans chaque requete MCP pour isoler les sessions. L'implementation initiale cible stdio uniquement.

Effets :
- Quand la meme skill est re-demandee, retourner le `summary` (si existant) + un flag `already_served: true` au lieu du contenu complet. L'agent sait qu'il l'a deja et peut decider s'il veut le full content (via `include_inherited: true` explicite).
- Le tracking alimente les co-occurrences (axe 5.2).

**Effort** : ~20 lignes. Un `Set` dans `createServer`, passe aux deps des tools.

### 5.2 Suggestions de skills connexes (related skills)

**Fichier** : `tools/get-skill.ts`, `usage-stats.ts`

Base sur les co-occurrences historiques : "les sessions qui ont demande `ui/react/auth` demandent souvent ensuite `api/auth`". Stocke dans les usage-stats :

```json
{
  "ui/react/auth": {
    "co_occurrences": { "api/auth": 23, "testing/_index": 15 }
  }
}
```

Retourne dans la reponse de `get_skill` sous une cle `related_skills`. L'agent decouvre des skills pertinentes sans avoir a deviner.

**Effort** : ~40 lignes (tracking des co-occurrences + inclusion dans la reponse).

---

## Axe 6 — Structuration du contenu

**Constat** : l'heritage est uniquement vertical (parent -> enfant). Pas de reutilisation cross-branche. Pas de scoping par fichiers projet.

**Insight recherche** : *"Le consensus emerge que les agents de codage ont deja acces au filesystem"* (S5). Le scoping par paths des `.claude/rules/` (S1.2) est le modele a suivre.

### 6.1 Composition horizontale via `includes`

**Fichiers** : `types/index.ts`, `skill-index.ts`, `skill-resolver.ts`

Champ `includes` dans le frontmatter :

```yaml
includes:
  - testing/_index
  - api/auth
```

Le contenu des skills incluses est ajoute apres le contenu herite, dans une section distincte. Permet a `ui/react/auth` d'inclure les patterns de `api/auth` sans forcer l'agent a faire deux appels.

**Effort** : ~40 lignes dans le resolver + parsing du champ.

### 6.2 Champ `applies_to` pour le scoping par paths projet

**Fichier** : `types/index.ts`, `tools/get-skill.ts`

Champ optionnel dans le frontmatter :

```yaml
applies_to:
  - "src/components/auth/**"
  - "src/hooks/useAuth*"
```

Quand le contexte de `get_skill` mentionne un chemin de fichier, les skills dont `applies_to` matche recoivent un boost au scoring. Pas d'exclusion — juste un signal de pertinence supplementaire.

Alimente aussi l'axe 2.3 (`generate_claude_rules`) qui utilise ce champ pour generer le frontmatter `paths` des rules natives.

**Effort** : ~35 lignes. Parsing + glob matching dans le scoring.

---

## Axe 7 — Distribution & DX (NOUVEAU v2)

**Constat** : le cout d'entree est disproportionne pour commencer. Les propositions DX etaient eparpillees dans `docs/improvements.md` (sections 4a, 4b, 4c) sans consolidation ni priorisation.

**Insight recherche** : la barriere d'adoption est un frein direct a l'impact. Un systeme de skills inutilise ne sert personne, quelle que soit la qualite du matching.

### 7.1 Commande `init`

**Fichier** : nouveau `src/cli/init.ts`

`npx skills-mcp init` qui :
- Cree la structure `skills/` avec un `_root.md` pre-rempli et un skill exemple
- Genere un `config.yaml` avec les defauts commentes
- Produit un `.mcp.json` pret a l'emploi pour Claude Code
- Genere le skill natif (2.0) si `.claude/skills/` existe
- Affiche les next steps

**Effort** : ~120 lignes.

### 7.2 Migration depuis CLAUDE.md

**Fichier** : nouveau `src/cli/migrate.ts`

`npx skills-mcp migrate ./CLAUDE.md` qui analyse un fichier de regles existant, identifie les sections thematiques (par headings), et propose un decoupage en skills avec des keywords suggeres. L'utilisateur valide/ajuste, la commande genere les fichiers `.md` avec frontmatter.

Cas d'usage principal : les equipes qui ont accumule des centaines de lignes dans CLAUDE.md et veulent migrer vers une structure arborescente maintenable.

**Effort** : ~150 lignes.

### 7.3 Linter de skills

**Fichier** : nouveau `src/cli/lint.ts`

`npx skills-mcp lint` executable en CI qui verifie :
- Frontmatter valide sur tous les `.md`
- Pas de keywords dupliques entre siblings directs (source d'ambiguite)
- Assets declares mais fichiers manquants
- Skills sans keywords ou avec <3 keywords (warning)
- Detection de `_index.md` manquants dans la chaine d'heritage
- Validation des scripts declares (extension autorisee, fichier existant)

**Effort** : ~100 lignes.

### 7.4 Documentation multi-IDE

**Fichier** : `docs/` ou README

Instructions de configuration pour les principaux clients MCP :
- **Claude Code** (natif, `.mcp.json`)
- **Cursor** (`.cursor/mcp.json`)
- **VS Code** (extension MCP, `settings.json`)
- **JetBrains** (plugin MCP)

Chaque IDE a ses specificites de configuration. Un guide par IDE reduit la friction d'adoption.

**Effort** : ~40 lignes par IDE, ~160 lignes au total. Principalement documentation.

### 7.5 Packaging plugin Claude Code (exploration)

**Fichier** : exploration, pas d'implementation immediate

L'API de plugins Claude Code est instable. A surveiller pour un packaging natif (`npm install -g skills-mcp` qui s'enregistre automatiquement). Pas d'investissement tant que l'API n'est pas stabilisee.

**Effort** : indetermine. Exploration uniquement.

---

## Matrice de priorisation consolidee

Les propositions sont classees par ratio impact/effort, en tenant compte des dependances entre elles.

### Tier 1 — Quick wins a fort ROI (a implementer en premier)

| # | Amelioration | Effort | Impact | Justification |
|---|---|---|---|---|
| **2.0** | **Skill natif comme pont proactif** | **~60 lignes** | **CRITIQUE** | **Mecanisme de proactivite le plus fiable. La description est toujours en contexte.** |
| 1.5 | Acces direct par `skill_path` | ~10 lignes | Fort | Elimine le matching quand l'agent sait deja quoi chercher |
| 1.3 | Correction biais scoring | ~3 lignes | Moyen | Corrige un bug de ranking documente |
| 3.1 | Champ `summary` | ~15 lignes | Moyen | Resistance a la compaction, zero risque |
| 2.2 | Description dynamique + `list_changed` | ~20 lignes | Fort | Augmente la probabilite d'invocation, reste a jour apres sync |
| 3.2 | Parametre `include_inherited` | ~15 lignes | Moyen | Controle granulaire du cout contextuel |
| **2.5** | **Annotations d'outils** | **~18 lignes** | **Moyen** | **Permissions automatiques pour les outils read-only** |

**Total Tier 1** : ~145 lignes, implementable en une session, aucune dependance externe.

### Tier 2 — Ameliorations structurantes (iteration suivante)

| # | Amelioration | Effort | Impact | Dependances |
|---|---|---|---|---|
| 1.1 | Synonymes/aliases | ~40 lignes | Fort | Aucune |
| 1.2 | Scoring sur description en fallback | ~25 lignes | Moyen | Aucune |
| 1.4 | Normalisation tokens | ~15 lignes | Moyen | Synergique avec 1.1 |
| 3.3 | Inlining petits assets | ~30 lignes | Moyen | Aucune |
| 2.1 | MCP Prompts (onboarding) | ~50 lignes | Moyen | Aucune |
| 5.1 | Tracking de session | ~20 lignes | Moyen | Aucune |
| **3.4** | **MCP Resources + mentions @** | **~60 lignes** | **Fort** | **Aucune** |

**Total Tier 2** : ~240 lignes. Le matching s'ameliore significativement. L'integration MCP passe de passive a proactive.

### Tier 3 — Feedback loop, integration avancee et DX

| # | Amelioration | Effort | Impact | Dependances |
|---|---|---|---|---|
| 4.1 | Stats d'usage + bonus scoring | ~60 lignes | Moyen | 1.3 (scoring) |
| 4.2 | Outil analyze_usage / report | ~80 lignes | Moyen | Analytics existantes |
| 2.3 | Generation `.claude/rules/` | ~80 lignes | Fort | 6.2 (applies_to) |
| **2.4** | **Generation CLAUDE.md de trigger** | **~40 lignes** | **Moyen** | **Arbre de skills. Alternative a 2.0 si skills natifs indisponibles.** |
| 5.2 | Related skills (co-occurrences) | ~40 lignes | Moyen | 5.1 (session tracking) |
| **7.1** | **Commande `init`** | **~120 lignes** | **Fort** | **Aucune** |
| **7.3** | **Linter de skills** | **~100 lignes** | **Moyen** | **Aucune** |

**Total Tier 3** : ~520 lignes. Le MCP devient un systeme qui apprend, s'integre dans l'ecosysteme natif, et offre un onboarding fluide.

### Tier 4 — Evolutions structurelles et explorations

| # | Amelioration | Effort | Impact | Risque |
|---|---|---|---|---|
| 6.1 | Composition horizontale (`includes`) | ~40 lignes | Moyen | Complexite de resolution |
| 6.2 | Scoping `applies_to` | ~35 lignes | Moyen | Necessite des donnees de paths dans les skills |
| **7.2** | **Migration depuis CLAUDE.md** | **~150 lignes** | **Moyen** | **Parsing heuristique** |
| **7.4** | **Documentation multi-IDE** | **~160 lignes** | **Moyen** | **Maintenance multi-cible** |
| **7.5** | **Packaging plugin Claude Code (veille)** | **indetermine** | **Fort** | **API instable, exploration uniquement** |

---

## Ce qui a ete explicitement ecarte

| Idee | Raison de l'exclusion |
|---|---|
| **Embeddings vectoriels** (S2.2, S2.5) | Sur-ingenierie pour un index de skills de taille modeste. Keyword matching + synonymes + description fallback couvrent 95% des cas. |
| **PreCompact hooks cote serveur** | Les hooks sont cote client (Claude Code), pas cote serveur MCP. Le champ `summary` est la reponse cote serveur. |
| **Memory Bank** (S2.6) | Le document de recherche lui-meme conclut au scepticisme. L'approche skills est meilleure. |
| **Auto Memory** (S1.3) | Natif a Claude Code, hors perimetre du MCP. |
| **Beads** (S2.1) | Resout le tracking de taches, orthogonal a la livraison de skills. |
| **Skills conditionnels `when`** (detection de projet) | Trop de complexite d'implementation (lire package.json, analyser les deps) pour un gain incertain. Le scoping par `applies_to` + la description dynamique couvrent le meme besoin plus simplement. |
| **IDF weighting** | Bon en theorie mais complexifie significativement le scoring pour un gain marginal quand les synonymes et le bonus absolu sont en place. A reconsiderer si les ambiguites persistent apres le Tier 2. |
| **Plugin Claude Code complet** (v2) | L'API de plugins est instable. Seule une veille exploratoire est retenue (7.5), pas d'implementation. |
| **Hook SessionStart comme mecanisme primaire** (v2) | Le skill natif (2.0) est plus fiable car toujours en contexte. Les hooks dependent de la configuration locale et ne sont pas portables. |
| **MCP Prompts comme injection proactive** (v2) | Les Prompts MCP sont des slash commands manuelles, PAS de l'injection automatique. La v1 les survaluait. Repositionnes comme outil d'onboarding (2.1). |

---

## Validation par la documentation officielle Anthropic

Chaque proposition cle est croisee avec sa source dans la documentation Anthropic et/ou le SDK MCP.

| Proposition | Source Anthropic | Verification SDK |
|---|---|---|
| **2.0** Skill natif `user-invocable: false` | Doc Claude Code : "skills with `user-invocable: false` have their description always loaded into context" | N/A (mecanisme Claude Code, pas SDK MCP) |
| **2.1** MCP Prompts = slash commands | Spec MCP : "Prompts are user-controlled templates" | `server.prompt()` dans `@modelcontextprotocol/sdk` |
| **2.2** `RegisteredTool.update()` | — | `mcp.d.ts` ligne 206 : `update(updates)` sur `RegisteredTool` |
| **2.2** `sendToolListChanged()` | Spec MCP : "servers that change tools SHOULD notify via notifications/tools/list_changed" | `mcp.d.ts` ligne 278 : `server.sendToolListChanged()` |
| **2.5** `ToolAnnotations` | Spec MCP : "Tool annotations provide hints about tool behavior" | `server.tool()` accepte `annotations: { readOnlyHint, openWorldHint }` |
| **3.4** `ResourceTemplate` | Spec MCP : "Resource templates use URI templates to expose parameterized resources" | `server.resource()` avec pattern URI |
| **3.4** `sendResourceListChanged()` | Spec MCP : "servers SHOULD notify via notifications/resources/list_changed" | `mcp.d.ts` : `server.sendResourceListChanged()` |
| **5.1** Session = stdio process | Spec MCP transport : "stdio: one connection per process lifetime" | Transport stdio dans `@modelcontextprotocol/sdk/server/stdio.js` |
| **5.1** `meta.sessionId` en HTTP | Spec MCP transport : "Streamable HTTP uses session IDs for connection continuity" | Header `Mcp-Session-Id` |

---

## Validation par le code source

Les constats sur le code existant qui motivent les propositions.

| Constat code | Fichier:ligne | Proposition associee |
|---|---|---|
| Score = `matchedKeywords.length / lowerKeywords.length` sans bonus absolu | `keyword-matcher.ts:52` | 1.3 Correction biais scoring |
| `inline_text_max_bytes: 10_240` declare mais jamais lu par `get-skill.ts` | `types/index.ts:170` | 3.3 Inlining petits assets |
| Description statique `"Search and return the most relevant skill..."` | `get-skill.ts:122` | 2.2 Description dynamique |
| `description` dans `Frontmatter` mais jamais utilise pour le scoring | `types/index.ts:28`, `keyword-matcher.ts:65` | 1.2 Scoring sur description |
| Pas de champ `aliases` dans `Frontmatter` | `types/index.ts:26-33` | 1.1 Synonymes/aliases |
| `content-updated` event ne met pas a jour les descriptions d'outils | `server.ts:47-54` | 2.2 `sendToolListChanged()` |
| Aucun handler `resources/*` dans `server.ts` | `server.ts:57-85` | 3.4 MCP Resources |
| Aucun handler `prompts/*` dans `server.ts` | `server.ts:57-85` | 2.1 MCP Prompts |
| Pas de `Set` de session dans `createServer` | `server.ts:22-88` | 5.1 Tracking de session |

---

## Validation par la recherche

Le positionnement de skills-mcp est directement valide par la conclusion la plus forte du document de recherche :

> *"La frontiere avance : au-dela de la memoire (ce que Claude sait), les systemes commencent a evoluer vers l'extraction de competences (ce que Claude sait faire)."* (S5)

skills-mcp **est** ce systeme de competences. Les ameliorations proposees ne changent pas son architecture — elles rendent le retrieval plus robuste (Axe 1), l'integration plus fluide (Axe 2), la livraison plus efficiente (Axe 3), introduisent une boucle d'apprentissage (Axe 4), et abaissent la barriere d'adoption (Axe 7) que la recherche identifie comme critique pour l'impact reel.
