# Skills Tree MCP Server — Plan d'implémentation

## Contexte et objectifs

Ce document décrit l'implémentation d'un serveur MCP (Model Context Protocol) qui expose un arbre de skills Markdown à Claude Code. Le serveur s'exécute localement sur la machine de chaque développeur et synchronise son contenu depuis un repo GitHub privé.

### Objectifs

1. **Centralisation** — Un seul repo de skills partagé par toute l'équipe (5-15 devs), modifiable en un point
2. **Économie de contexte** — Un seul appel outil renvoie uniquement le contenu pertinent, pas l'arbre entier
3. **Évolutivité** — Ajouter un skill = ajouter un fichier Markdown + une ligne de keywords
4. **Observabilité** — Tracer quels skills sont consultés, lesquels sont utiles, lesquels sont morts
5. **Versioning** — Historique Git complet des décisions et évolutions
6. **Portabilité** — Les skills sont du Markdown pur, réutilisables hors MCP
7. **Qualité continue** — Le feedback de Claude permet d'améliorer les skills itérativement

### Décisions techniques

| Décision | Choix | Justification |
|----------|-------|---------------|
| Langage | TypeScript | SDK MCP officiel, distribution npx, écosystème Claude Code |
| Repo skills | GitHub privé | Contrôle d'accès, équipe de 5-15 |
| Routing | Keyword matching déterministe | Prédictible, debuggable, sans dépendance externe |
| Héritage | Configurable par skill (`inherit: true/false`) | Flexibilité selon le type de contenu |
| Distribution | npm privé (prod) + Git (dev) | npx pour l'onboarding, Git pour le dev du serveur |
| Refresh | Pull au démarrage + refresh périodique | Contenu toujours à jour sans redémarrage |

---

## Architecture globale

```
┌─────────────────────────────────────────────────────────────┐
│ Machine du développeur                                      │
│                                                             │
│  Claude Code ◄──── MCP Protocol ────► skills-mcp-server     │
│                                        │                    │
│                                        ├─ SkillIndex        │
│                                        │  (arbre en mémoire)│
│                                        │                    │
│                                        ├─ AssetResolver     │
│                                        │  (fichiers/scripts)│
│                                        │                    │
│                                        ├─ GitSync           │
│                                        │  (clone/pull)      │
│                                        │                    │
│                                        └─ Analytics         │
│                                           (push logs)       │
│                                                             │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼                         ▼
     GitHub (privé)            Endpoint analytics
     repo: skills/             (webhook/API)
     ├── skills/
     │   ├── _root.md
     │   ├── ui/
     │   │   ├── _index.md
     │   │   ├── react/
     │   │   │   ├── _index.md
     │   │   │   ├── auth.md
     │   │   │   ├── auth/          ← assets/ + scripts/
     │   │   │   └── testing.md
     │   │   └── vue/
     │   │       └── _index.md
     │   └── api/
     │       ├── _index.md
     │       └── auth.md
     └── config.yaml
```

---

## 1. Structure du repo de skills

### 1.1 Arborescence des fichiers

```
skills-content/                    ← repo GitHub privé
├── config.yaml                    ← configuration globale
├── skills/
│   ├── _root.md                   ← skill racine (règles universelles)
│   ├── ui/
│   │   ├── _index.md              ← skill intermédiaire pour le domaine UI
│   │   ├── react/
│   │   │   ├── _index.md          ← règles React générales
│   │   │   ├── auth.md            ← skill feuille : composants React + auth
│   │   │   ├── auth/              ← ressources associées au skill auth
│   │   │   │   ├── assets/
│   │   │   │   │   ├── AuthProvider.tsx.template    ← template de scaffolding
│   │   │   │   │   ├── auth-config.example.ts       ← exemple de référence
│   │   │   │   │   └── auth-flow.svg                ← diagramme
│   │   │   │   └── scripts/
│   │   │   │       ├── scaffold-auth.sh             ← génère la structure auth
│   │   │   │       └── validate-auth-config.ts      ← vérifie la config auth
│   │   │   └── testing.md
│   │   └── vue/
│   │       ├── _index.md
│   │       └── composition.md
│   ├── api/
│   │   ├── _index.md
│   │   ├── _index/                ← ressources partagées par tout le domaine API
│   │   │   ├── assets/
│   │   │   │   └── api-schema.openapi.yaml
│   │   │   └── scripts/
│   │   │       └── generate-endpoint.sh
│   │   ├── auth.md
│   │   └── database.md
│   └── deploy/
│       ├── _index.md
│       ├── docker.md
│       └── docker/
│           ├── assets/
│           │   ├── Dockerfile.template
│           │   └── docker-compose.example.yaml
│           └── scripts/
│               └── setup-docker.sh
└── README.md
```

**Conventions :**

- `_root.md` — le skill racine, ses règles s'appliquent à tout si héritage activé
- `_index.md` — skill intermédiaire d'un dossier (équivalent du `_index.md` de Hugo)
- `*.md` — skills feuilles
- Un dossier = un domaine/sous-domaine
- Profondeur illimitée côté contenu
- **`{skill-name}/assets/`** — dossier d'assets associés à un skill (templates, configs, exemples, images, schémas)
- **`{skill-name}/scripts/`** — dossier de scripts associés à un skill (scaffolding, validation, setup, migration)
- Le dossier de ressources porte le même nom que le fichier `.md` sans l'extension (ex : `auth.md` → `auth/`)
- Pour les `_index.md`, le dossier de ressources se nomme `_index/`
- Un skill peut n'avoir que des assets, que des scripts, les deux, ou aucun

### 1.2 Format d'un fichier skill

Chaque fichier Markdown commence par un frontmatter YAML :

```markdown
---
keywords:
  - react
  - composant
  - hook
  - jsx
  - tsx
  - frontend
description: "Règles de création de composants React"
inherit: true          # true = inclure le contenu de tous les parents
                       # false = ce skill est autonome
                       # absent = true par défaut
priority: 10           # poids en cas d'égalité de score (plus haut = prioritaire)
                       # absent = 0 par défaut
assets:                # optionnel — liste des assets associés avec métadonnées
  - file: assets/AuthProvider.tsx.template
    description: "Template de base pour un AuthProvider React"
    type: template     # template | config | example | schema | image | other
  - file: assets/auth-config.example.ts
    description: "Exemple de configuration auth complète"
    type: example
  - file: assets/auth-flow.svg
    description: "Diagramme du flux d'authentification"
    type: image
scripts:               # optionnel — liste des scripts associés avec métadonnées
  - file: scripts/scaffold-auth.sh
    description: "Génère la structure complète auth (provider, hooks, guard)"
    args:              # paramètres acceptés par le script
      - name: project_dir
        description: "Répertoire racine du projet"
        required: true
      - name: provider
        description: "Type de provider (firebase|auth0|custom)"
        required: false
        default: "custom"
    execution: claude   # claude = Claude lit et exécute via bash
                        # server = le serveur MCP exécute via run_script
                        # absent = claude par défaut
  - file: scripts/validate-auth-config.ts
    description: "Vérifie que la config auth du projet est valide"
    args:
      - name: config_path
        description: "Chemin vers le fichier de config auth"
        required: true
    execution: server   # exécuté par le serveur car besoin de ts-node
---

# Composants React

## Règles

- Toujours utiliser des composants fonctionnels
- Hooks uniquement, pas de classes
- Un fichier = un composant exporté par défaut
...
```

**Champs du frontmatter :**

| Champ | Type | Requis | Défaut | Description |
|-------|------|--------|--------|-------------|
| `keywords` | `string[]` | oui | — | Mots-clés pour le matching. Minimum 3 recommandés |
| `description` | `string` | oui | — | Description courte, renvoyée en cas d'ambiguïté |
| `inherit` | `boolean` | non | `true` | Inclure le contenu des parents dans la réponse |
| `priority` | `number` | non | `0` | Poids de départage en cas de scores égaux |
| `assets` | `Asset[]` | non | `[]` | Assets associés au skill (templates, configs, exemples...) |
| `scripts` | `Script[]` | non | `[]` | Scripts associés au skill (scaffolding, validation...) |

**Champs d'un asset :**

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `file` | `string` | oui | Chemin relatif au dossier de ressources du skill |
| `description` | `string` | oui | Description pour que Claude sache quand l'utiliser |
| `type` | `string` | non | `template`, `config`, `example`, `schema`, `image`, `other` |

**Champs d'un script :**

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `file` | `string` | oui | Chemin relatif au dossier de ressources du skill |
| `description` | `string` | oui | Description pour que Claude sache quand l'utiliser |
| `args` | `Arg[]` | non | Paramètres acceptés par le script |
| `execution` | `string` | non | `claude` (défaut) ou `server` |

**Champs d'un argument de script :**

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `name` | `string` | oui | Nom du paramètre |
| `description` | `string` | oui | Description du paramètre |
| `required` | `boolean` | non | `true` par défaut |
| `default` | `string` | non | Valeur par défaut si non requis |

### 1.3 Configuration globale (`config.yaml`)

```yaml
# config.yaml — configuration du serveur skills-mcp

# Refresh automatique
refresh:
  enabled: true
  interval_minutes: 15          # fréquence du git pull en tâche de fond

# Analytics
analytics:
  enabled: true
  endpoint: "https://hooks.monorg.com/skills-usage"  # webhook pour recevoir les events
  # Alternative : un fichier local
  # file: "~/.skills-mcp/analytics.jsonl"

# Matching
matching:
  min_score: 0.2                # score minimum pour qu'un skill soit candidat
  max_results: 3                # nombre max de candidats renvoyés en cas d'ambiguïté
  ambiguity_threshold: 0.1      # si écart entre top 1 et top 2 < seuil → ambiguïté

# Git
git:
  branch: "main"                # branche à suivre
  sparse_checkout: false        # true si le repo contient autre chose que des skills

# Scripts
scripts:
  enabled: true                 # active/désactive l'outil run_script globalement
  timeout_seconds: 60           # timeout max par exécution de script
  max_output_bytes: 1048576     # 1 MB max de stdout/stderr capturé
  allowed_extensions:           # extensions autorisées pour l'exécution côté serveur
    - .sh
    - .ts
    - .js
    - .py
  runners:                      # mapping extension → commande d'exécution
    ".sh": "bash"
    ".ts": "npx tsx"
    ".js": "node"
    ".py": "python3"

# Assets
assets:
  max_size_bytes: 1048576       # 1 MB max par asset
  inline_text_max_bytes: 10240  # 10 KB — au-delà, le contenu texte n'est pas inliné dans get_skill
```

---

## 2. Architecture du serveur MCP

### 2.1 Structure du projet

```
skills-mcp-server/                 ← repo du serveur (séparé du repo de contenu)
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                   ← point d'entrée, setup MCP
│   ├── server.ts                  ← définition du serveur et des outils
│   ├── core/
│   │   ├── git-sync.ts            ← clone, pull, refresh périodique
│   │   ├── skill-index.ts         ← parsing, indexation, recherche
│   │   ├── skill-resolver.ts      ← résolution d'héritage, agrégation
│   │   ├── keyword-matcher.ts     ← algorithme de scoring
│   │   └── asset-resolver.ts      ← résolution des assets et scripts associés
│   ├── tools/
│   │   ├── get-skill.ts           ← outil get_skill
│   │   ├── get-asset.ts           ← outil get_asset (récupérer un asset)
│   │   ├── run-script.ts          ← outil run_script (exécuter un script côté serveur)
│   │   ├── list-skills.ts         ← outil list_skills
│   │   ├── report-usage.ts        ← outil report_usage
│   │   └── refresh-skills.ts      ← outil refresh_skills
│   ├── analytics/
│   │   ├── tracker.ts             ← collecte des events
│   │   └── publisher.ts           ← envoi vers l'endpoint
│   └── types/
│       └── index.ts               ← types partagés
├── tests/
│   ├── keyword-matcher.test.ts
│   ├── skill-resolver.test.ts
│   ├── asset-resolver.test.ts
│   ├── git-sync.test.ts
│   └── tools/
│       ├── get-skill.test.ts
│       ├── get-asset.test.ts
│       ├── run-script.test.ts
│       └── list-skills.test.ts
└── README.md
```

### 2.2 Composants principaux

#### `GitSync` — Synchronisation du contenu

```
Responsabilités :
- Au démarrage : clone le repo s'il n'existe pas localement, sinon git pull
- En tâche de fond : git pull à intervalle configurable
- Stockage local dans ~/.skills-mcp/content/
- Émet un event "content-updated" après chaque pull réussi
- Gère les erreurs réseau gracieusement (utilise le cache local)

Interface :
  class GitSync extends EventEmitter {
    constructor(repoUrl: string, branch: string, localPath: string)
    async initialize(): Promise<void>       // clone ou pull initial
    startPeriodicRefresh(intervalMs: number): void
    stopPeriodicRefresh(): void
    async forceRefresh(): Promise<RefreshResult>
    getLastSyncTime(): Date | null
    getLocalPath(): string
  }

  type RefreshResult = {
    success: boolean
    commitHash: string
    filesChanged: number
    timestamp: Date
  }
```

**Détails d'implémentation :**

- Utiliser `simple-git` (npm) pour les opérations Git
- Le repo est cloné dans `~/.skills-mcp/content/` (persist entre les sessions)
- Le token GitHub est lu depuis la variable d'environnement `GITHUB_TOKEN` ou depuis le credential helper Git de la machine
- Si le clone/pull échoue au démarrage, le serveur utilise le contenu local existant et logge un warning
- Le refresh périodique utilise `setInterval` et ne bloque pas le thread principal
- Après chaque pull, émettre `content-updated` pour que `SkillIndex` re-indexe

#### `SkillIndex` — Indexation et recherche

```
Responsabilités :
- Parse tous les fichiers .md du dossier skills/
- Extrait les frontmatters YAML
- Construit un arbre en mémoire avec les relations parent/enfant
- Expose une recherche par keywords

Interface :
  class SkillIndex {
    constructor(skillsDir: string)
    async buildIndex(): Promise<void>         // parse tous les fichiers
    search(context: string): SearchResult[]   // recherche par keywords
    getTree(): SkillNode                      // arbre complet pour list_skills
    getSkillByPath(path: string): Skill | null

    // Appelé par GitSync quand le contenu change
    async rebuild(): Promise<void>
  }

  type Skill = {
    path: string              // ex: "ui/react/auth"
    filePath: string          // ex: "skills/ui/react/auth.md"
    frontmatter: Frontmatter
    content: string           // contenu Markdown sans frontmatter
    parent: Skill | null      // skill parent (_index.md du dossier parent)
    assets: AssetMeta[]       // assets déclarés dans le frontmatter
    scripts: ScriptMeta[]     // scripts déclarés dans le frontmatter
    resourceDir: string | null // chemin du dossier de ressources (null si inexistant)
  }

  type AssetMeta = {
    file: string              // chemin relatif (ex: "assets/AuthProvider.tsx.template")
    absolutePath: string      // chemin absolu résolu sur le filesystem
    description: string
    type: "template" | "config" | "example" | "schema" | "image" | "other"
    isBinary: boolean         // true pour images, false pour texte
  }

  type ScriptMeta = {
    file: string              // chemin relatif (ex: "scripts/scaffold-auth.sh")
    absolutePath: string      // chemin absolu résolu sur le filesystem
    description: string
    args: ScriptArg[]
    execution: "claude" | "server"
  }

  type ScriptArg = {
    name: string
    description: string
    required: boolean
    default?: string
  }

  type SkillNode = {
    name: string
    description: string
    keywords: string[]
    children: SkillNode[]
  }

  type SearchResult = {
    skill: Skill
    score: number
    matchedKeywords: string[]
  }
```

**Détails d'implémentation :**

- Utiliser `gray-matter` (npm) pour parser le frontmatter YAML
- L'arbre est reconstruit à chaque `rebuild()` (déclenché par `content-updated`)
- L'index est une `Map<string, Skill>` où la clé est le chemin relatif
- Les parents sont résolus en remontant l'arborescence :
  - Le parent de `skills/ui/react/auth.md` est `skills/ui/react/_index.md`
  - Le parent de `skills/ui/react/_index.md` est `skills/ui/_index.md`
  - Le parent de `skills/ui/_index.md` est `skills/_root.md`
  - `_root.md` n'a pas de parent

#### `KeywordMatcher` — Algorithme de scoring

```
Interface :
  class KeywordMatcher {
    constructor(config: MatchingConfig)
    score(context: string, skill: Skill): MatchScore
  }

  type MatchScore = {
    score: number              // 0.0 à 1.0
    matchedKeywords: string[]  // keywords du skill qui ont matché
    contextTokens: string[]    // tokens extraits du contexte
  }
```

**Algorithme de scoring :**

```
Entrée : context (string libre envoyé par Claude)
         skill.keywords (string[] du frontmatter)

1. Tokenisation du contexte :
   - Convertir en minuscules
   - Supprimer la ponctuation
   - Splitter sur les espaces
   - Supprimer les stop words (le, la, les, de, du, un, une, the, a, an, of, to, in...)
   - Dédupliquer
   → contextTokens: string[]

2. Scoring :
   matchedKeywords = skill.keywords.filter(kw =>
     contextTokens.some(token =>
       token === kw.toLowerCase() ||
       token.includes(kw.toLowerCase()) ||
       kw.toLowerCase().includes(token)
     )
   )

   score = matchedKeywords.length / skill.keywords.length

3. Application de la priorité :
   finalScore = score + (skill.priority * 0.001)  // la priorité sert de tie-breaker

4. Filtrage :
   Si score < config.min_score → exclure
```

**Gestion de l'ambiguïté :**

```
Après scoring de tous les skills :
1. Trier par finalScore décroissant
2. Si top1.score - top2.score < config.ambiguity_threshold :
   → Renvoyer les N premiers candidats (max_results) avec leur description
   → Claude choisit
3. Sinon :
   → Renvoyer uniquement le top 1
```

#### `SkillResolver` — Résolution d'héritage et agrégation

```
Interface :
  class SkillResolver {
    resolve(skill: Skill): string  // retourne le contenu final agrégé
  }
```

**Algorithme de résolution :**

```
1. Si skill.frontmatter.inherit === false :
   → Retourner skill.content tel quel

2. Si skill.frontmatter.inherit === true (ou absent) :
   a. Remonter la chaîne des parents jusqu'à _root.md
   b. Collecter le contenu de chaque niveau
   c. Concaténer du plus général au plus spécifique :

   === RÈGLES GLOBALES (depuis _root.md) ===
   [contenu de _root.md]

   === UI — RÈGLES COMMUNES (depuis ui/_index.md) ===
   [contenu de ui/_index.md]

   === REACT — RÈGLES GÉNÉRALES (depuis ui/react/_index.md) ===
   [contenu de ui/react/_index.md]

   === REACT AUTH (depuis ui/react/auth.md) ===
   [contenu de ui/react/auth.md]

3. Chaque section est séparée par un en-tête clair
   pour que Claude comprenne la hiérarchie
```

#### `AssetResolver` — Résolution des assets et scripts

```
Responsabilités :
- Résout les chemins des assets et scripts déclarés dans les frontmatters
- Détermine si un fichier est binaire ou texte
- Lit le contenu des assets texte pour inclusion inline
- Collecte les assets hérités (si inherit: true, les assets des parents sont aussi disponibles)

Interface :
  class AssetResolver {
    constructor(skillsDir: string)

    // Résout les métadonnées d'assets pour un skill
    resolveAssets(skill: Skill): AssetMeta[]

    // Résout les métadonnées de scripts pour un skill
    resolveScripts(skill: Skill): ScriptMeta[]

    // Lit le contenu d'un asset texte
    readAssetContent(asset: AssetMeta): string

    // Lit le contenu d'un asset binaire en base64
    readAssetBase64(asset: AssetMeta): string

    // Collecte tous les assets disponibles (incluant héritage)
    resolveInheritedAssets(skill: Skill): AssetMeta[]

    // Collecte tous les scripts disponibles (incluant héritage)
    resolveInheritedScripts(skill: Skill): ScriptMeta[]
  }
```

**Détails d'implémentation :**

- Le dossier de ressources est résolu ainsi :
  - Pour `skills/ui/react/auth.md` → `skills/ui/react/auth/`
  - Pour `skills/ui/react/_index.md` → `skills/ui/react/_index/`
  - Si le dossier n'existe pas sur le filesystem, `resourceDir = null`
- La détection binaire/texte se base sur l'extension :
  - Binaire : `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.ico`, `.webp`, `.pdf`, `.zip`, `.woff`, `.woff2`
  - Texte : tout le reste (`.ts`, `.tsx`, `.js`, `.sh`, `.yaml`, `.json`, `.template`, `.example`, `.md`, etc.)
- Si un fichier déclaré dans le frontmatter n'existe pas sur le filesystem, loguer un warning et l'exclure
- L'héritage des assets fonctionne par accumulation :
  - Si `inherit: true`, les assets de tous les parents sont disponibles
  - En cas de conflit de nom, l'asset le plus spécifique (le plus proche de la feuille) gagne
  - Les scripts hérités suivent la même logique

### 2.3 Définition des outils MCP

#### `get_skill`

```
Nom : get_skill
Description :
  "Recherche et retourne le skill le plus pertinent pour le contexte donné.
   Décris ta tâche en quelques mots-clés. Si plusieurs skills correspondent,
   les candidats sont listés avec leur description pour que tu choisisses."

Input Schema :
  {
    context: string    // requis — description libre de la tâche
                       // ex: "créer un composant React avec authentification"
  }

Output (cas normal — 1 match clair) :
  {
    skill_path: "ui/react/auth",
    score: 0.72,
    matched_keywords: ["react", "composant", "auth"],
    content: "=== RÈGLES GLOBALES ===\n...\n=== REACT AUTH ===\n...",
    assets: [
      { file: "assets/AuthProvider.tsx.template", description: "Template de base pour un AuthProvider React", type: "template" },
      { file: "assets/auth-config.example.ts", description: "Exemple de configuration auth complète", type: "example" },
      { file: "assets/auth-flow.svg", description: "Diagramme du flux d'authentification", type: "image" }
    ],
    scripts: [
      { file: "scripts/scaffold-auth.sh", description: "Génère la structure complète auth", execution: "claude",
        args: [{ name: "project_dir", required: true }, { name: "provider", required: false, default: "custom" }] },
      { file: "scripts/validate-auth-config.ts", description: "Vérifie que la config auth est valide", execution: "server",
        args: [{ name: "config_path", required: true }] }
    ],
    inherited_assets: [
      { file: "assets/component-base.tsx.template", description: "Template de base composant React", type: "template", from: "ui/react" }
    ],
    inherited_scripts: [
      { file: "scripts/lint-component.sh", description: "Lint un composant React", execution: "claude", from: "ui/react" }
    ]
  }

  Notes sur le comportement :
  - Les assets texte (templates, configs, examples) avec execution: "claude" sont à récupérer
    via `get_asset` si Claude en a besoin
  - Les scripts avec execution: "claude" : Claude récupère le contenu via `get_asset` puis l'exécute via bash
  - Les scripts avec execution: "server" : Claude les lance via `run_script`
  - Les assets/scripts hérités incluent un champ `from` indiquant le skill d'origine
  - Les assets binaires (images) ne sont PAS inclus inline — Claude peut les référencer ou les ignorer

Output (cas ambiguïté — plusieurs candidats) :
  {
    ambiguous: true,
    candidates: [
      { skill_path: "ui/react/auth", score: 0.55, description: "Composants React avec auth", matched_keywords: ["react", "auth"] },
      { skill_path: "api/auth", score: 0.50, description: "Authentification côté API", matched_keywords: ["auth", "api"] }
    ],
    message: "Plusieurs skills correspondent. Précise ton besoin ou choisis un skill_path."
  }

Output (aucun match) :
  {
    no_match: true,
    message: "Aucun skill ne correspond au contexte donné."
  }
```

#### `list_skills`

```
Nom : list_skills
Description :
  "Liste l'arbre complet des skills disponibles avec leurs descriptions
   et mots-clés. Utile pour découvrir les skills existants."

Input Schema :
  {
    path?: string    // optionnel — sous-arbre à lister
                     // ex: "ui" pour ne voir que les skills UI
                     // absent = arbre complet
  }

Output :
  {
    tree: {
      name: "root",
      description: "Règles universelles du projet",
      children: [
        {
          name: "ui",
          description: "Développement frontend et composants",
          keywords: ["ui", "frontend", "composant"],
          children: [
            { name: "react", description: "...", keywords: [...], children: [...] },
            { name: "vue", description: "...", keywords: [...], children: [...] }
          ]
        },
        { name: "api", description: "...", keywords: [...], children: [...] }
      ]
    }
  }
```

#### `report_usage`

```
Nom : report_usage
Description :
  "Signale si un skill servi était utile ou non.
   Appelle cet outil après avoir utilisé un skill pour donner ton feedback."

Input Schema :
  {
    skill_path: string       // requis — chemin du skill évalué
    useful: boolean          // requis — le skill était-il pertinent ?
    comment?: string         // optionnel — détail sur ce qui manquait ou était superflu
  }

Output :
  {
    recorded: true,
    message: "Feedback enregistré pour ui/react/auth"
  }
```

**Comportement côté serveur :**

- L'event est envoyé au tracker analytics
- Les feedbacks négatifs répétés sur un skill déclenchent un signal dans les logs
- Le champ `comment` est stocké pour analyse ultérieure

#### `refresh_skills`

```
Nom : refresh_skills
Description :
  "Force une synchronisation immédiate du contenu des skills depuis le repo Git.
   Utile après avoir modifié un skill sur GitHub."

Input Schema : {} (aucun paramètre)

Output :
  {
    success: true,
    commit_hash: "a1b2c3d",
    files_changed: 3,
    skills_reindexed: 24,
    last_sync: "2025-02-18T14:30:00Z"
  }
```

#### `get_asset`

```
Nom : get_asset
Description :
  "Récupère le contenu d'un asset ou script associé à un skill.
   Utilise les chemins retournés par get_skill dans les champs assets, scripts,
   inherited_assets ou inherited_scripts."

Input Schema :
  {
    skill_path: string    // requis — chemin du skill (ex: "ui/react/auth")
    file: string          // requis — chemin relatif de l'asset (ex: "assets/AuthProvider.tsx.template")
  }

Output (asset texte) :
  {
    skill_path: "ui/react/auth",
    file: "assets/AuthProvider.tsx.template",
    content: "import React, { createContext, useContext... }",
    size_bytes: 2340,
    type: "template"
  }

Output (asset binaire) :
  {
    skill_path: "ui/react/auth",
    file: "assets/auth-flow.svg",
    content_base64: "PHN2ZyB4bWxucz0i...",
    size_bytes: 15200,
    type: "image",
    mime_type: "image/svg+xml"
  }

Output (asset hérité — le file vient d'un parent) :
  {
    skill_path: "ui/react/auth",
    resolved_from: "ui/react",
    file: "assets/component-base.tsx.template",
    content: "...",
    size_bytes: 1800,
    type: "template"
  }

Output (erreur) :
  {
    error: true,
    message: "Asset 'assets/unknown.ts' non trouvé pour le skill 'ui/react/auth'"
  }
```

**Comportement côté serveur :**

- Le serveur résout le chemin absolu de l'asset à partir du `skill_path` et du `file`
- Si `inherit: true` et que l'asset n'est pas trouvé dans le skill direct, remonter les parents
- Pour les assets texte : retourner le contenu brut dans `content`
- Pour les assets binaires : retourner en base64 dans `content_base64` avec le `mime_type`
- Limite de taille : refuser les assets > 1 MB avec un message d'erreur clair

#### `run_script`

```
Nom : run_script
Description :
  "Exécute un script associé à un skill côté serveur.
   Uniquement pour les scripts déclarés avec execution: 'server' dans le frontmatter.
   Les scripts avec execution: 'claude' doivent être récupérés via get_asset
   et exécutés directement par Claude via bash."

Input Schema :
  {
    skill_path: string              // requis — chemin du skill (ex: "ui/react/auth")
    file: string                    // requis — chemin du script (ex: "scripts/validate-auth-config.ts")
    args: Record<string, string>    // requis — arguments nommés du script
                                    // ex: { "config_path": "./src/auth/config.ts" }
    cwd?: string                    // optionnel — répertoire de travail pour l'exécution
                                    // absent = répertoire courant du serveur
  }

Output (succès) :
  {
    success: true,
    exit_code: 0,
    stdout: "✓ Auth config is valid\n✓ All required fields present\n",
    stderr: "",
    duration_ms: 340,
    script: "scripts/validate-auth-config.ts"
  }

Output (échec du script) :
  {
    success: false,
    exit_code: 1,
    stdout: "",
    stderr: "Error: Missing required field 'clientId' in auth config",
    duration_ms: 120,
    script: "scripts/validate-auth-config.ts"
  }

Output (script non autorisé) :
  {
    error: true,
    message: "Le script 'scripts/scaffold-auth.sh' est déclaré avec execution: 'claude',
              il ne peut pas être exécuté via run_script.
              Utilise get_asset pour récupérer son contenu et exécute-le via bash."
  }

Output (script inexistant) :
  {
    error: true,
    message: "Script 'scripts/unknown.sh' non trouvé pour le skill 'ui/react/auth'"
  }
```

**Comportement côté serveur :**

- **Vérification d'autorisation** : seuls les scripts déclarés avec `execution: "server"` dans le frontmatter peuvent être exécutés. C'est la première vérification avant toute exécution.
- **Validation des arguments** : vérifier que tous les `args` requis sont fournis, sinon retourner une erreur listant les arguments manquants.
- **Exécution** : `child_process.spawn` avec :
  - Timeout de 60 secondes (configurable dans `config.yaml`)
  - Les arguments sont passés comme variables d'environnement préfixées : `SKILL_ARG_CONFIG_PATH=./src/auth/config.ts`
  - Le `cwd` est transmis au process enfant s'il est fourni
  - Capture de stdout et stderr
- **Runners par extension** :
  - `.sh` → `bash`
  - `.ts` → `npx tsx`
  - `.js` → `node`
  - `.py` → `python3`
  - Autre → erreur "extension non supportée"
- **Sécurité** :
  - Aucune interpolation shell des arguments (passage par env vars uniquement)
  - Le script ne peut lire que le filesystem local (pas de sandbox supplémentaire)
  - Les scripts sont versionnés dans le repo Git = audités et revus par l'équipe
  - Le champ `execution: "server"` est un opt-in explicite de l'auteur du skill

---

## 3. Analytics et observabilité

### 3.1 Format des events

Chaque interaction génère un event JSON :

```json
{
  "type": "skill_served",
  "timestamp": "2025-02-18T14:30:00Z",
  "server_id": "dev-machine-alice",
  "data": {
    "context": "créer un composant React avec auth",
    "skill_path": "ui/react/auth",
    "score": 0.72,
    "matched_keywords": ["react", "composant", "auth"],
    "was_ambiguous": false,
    "inherited_from": ["_root", "ui/_index", "ui/react/_index"],
    "content_length_tokens": 850
  }
}
```

```json
{
  "type": "skill_feedback",
  "timestamp": "2025-02-18T14:35:00Z",
  "server_id": "dev-machine-alice",
  "data": {
    "skill_path": "ui/react/auth",
    "useful": false,
    "comment": "Ne couvre pas le cas SSO"
  }
}
```

```json
{
  "type": "no_match",
  "timestamp": "2025-02-18T15:00:00Z",
  "server_id": "dev-machine-alice",
  "data": {
    "context": "configurer nginx en reverse proxy",
    "closest_candidate": "deploy/docker",
    "closest_score": 0.12
  }
}
```

```json
{
  "type": "asset_served",
  "timestamp": "2025-02-18T14:32:00Z",
  "server_id": "dev-machine-alice",
  "data": {
    "skill_path": "ui/react/auth",
    "file": "assets/AuthProvider.tsx.template",
    "asset_type": "template",
    "is_inherited": false,
    "size_bytes": 2340
  }
}
```

```json
{
  "type": "script_executed",
  "timestamp": "2025-02-18T14:33:00Z",
  "server_id": "dev-machine-alice",
  "data": {
    "skill_path": "ui/react/auth",
    "file": "scripts/validate-auth-config.ts",
    "execution_mode": "server",
    "success": true,
    "exit_code": 0,
    "duration_ms": 340,
    "args_provided": ["config_path"]
  }
}
```

### 3.2 Publisher

Le publisher fonctionne en mode asynchrone non-bloquant :

- Les events sont bufferisés localement dans une queue en mémoire
- Envoi par batch toutes les 30 secondes vers l'endpoint configuré (HTTP POST)
- En cas d'échec réseau, les events sont écrits dans un fichier local de fallback (`~/.skills-mcp/analytics-buffer.jsonl`)
- Au prochain envoi réussi, le buffer local est vidé
- Si l'analytics est désactivée dans la config, les events sont simplement ignorés

### 3.3 Métriques dérivées

À partir des events collectés, on peut calculer :

| Métrique | Utilité |
|----------|---------|
| Skills les plus consultés | Identifier le contenu critique |
| Skills jamais consultés | Candidats à la suppression |
| Taux de `useful: false` par skill | Skills à améliorer |
| `no_match` fréquents | Manques dans l'arbre à combler |
| Score moyen par skill | Qualité des keywords |
| Patterns de contexte → skill | Optimiser les keywords |
| Assets les plus récupérés | Templates et exemples critiques |
| Assets jamais récupérés | Ressources mortes à nettoyer |
| Scripts les plus exécutés | Automatisations critiques |
| Taux d'échec par script | Scripts à corriger ou documenter |
| Ratio scripts server vs claude | Calibrer les modes d'exécution |

---

## 4. Distribution et configuration

### 4.1 Publication npm (production)

```json
// package.json
{
  "name": "@monorg/skills-mcp",
  "version": "1.0.0",
  "bin": {
    "skills-mcp": "./dist/index.js"
  },
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  }
}
```

Distribution via GitHub Packages (npm privé lié à l'org GitHub). Chaque dev s'authentifie une fois avec `npm login --registry=https://npm.pkg.github.com`.

### 4.2 Configuration dans les projets (`.mcp.json`)

Fichier à la racine de chaque repo projet :

```json
{
  "mcpServers": {
    "skills": {
      "command": "npx",
      "args": ["@monorg/skills-mcp"],
      "env": {
        "SKILLS_REPO": "https://github.com/monorg/skills-content.git",
        "SKILLS_BRANCH": "main",
        "GITHUB_TOKEN": "",
        "ANALYTICS_ENDPOINT": "https://hooks.monorg.com/skills-usage",
        "REFRESH_INTERVAL_MINUTES": "15"
      }
    }
  }
}
```

**Note :** `GITHUB_TOKEN` est laissé vide dans le fichier commité. Chaque dev le définit dans son environnement shell (`.zshrc`, `.bashrc`) ou via un fichier `.env` local ignoré par Git.

### 4.3 Mode développement (Git direct)

Pour le développement du serveur MCP lui-même :

```json
{
  "mcpServers": {
    "skills": {
      "command": "npx",
      "args": ["tsx", "/chemin/local/skills-mcp-server/src/index.ts"],
      "env": {
        "SKILLS_REPO": "https://github.com/monorg/skills-content.git"
      }
    }
  }
}
```

---

## 5. Plan d'implémentation par phases

### Phase 1 — Fondations (3-4 jours)

**Objectif :** Un serveur MCP fonctionnel avec `get_skill` et du contenu local.

| Étape | Tâche | Fichier(s) |
|-------|-------|------------|
| 1.1 | Initialiser le projet TypeScript, installer les dépendances (`@modelcontextprotocol/sdk`, `gray-matter`, `simple-git`) | `package.json`, `tsconfig.json` |
| 1.2 | Implémenter le parser de frontmatter et le modèle `Skill` | `src/types/index.ts` |
| 1.3 | Implémenter `SkillIndex` : parsing, construction de l'arbre, `Map<path, Skill>` | `src/core/skill-index.ts` |
| 1.4 | Implémenter `KeywordMatcher` avec l'algo de scoring | `src/core/keyword-matcher.ts` |
| 1.5 | Implémenter `SkillResolver` (agrégation avec héritage) | `src/core/skill-resolver.ts` |
| 1.6 | Implémenter `AssetResolver` (résolution des chemins, détection binaire/texte) | `src/core/asset-resolver.ts` |
| 1.7 | Implémenter l'outil `get_skill` (avec listing des assets/scripts disponibles) | `src/tools/get-skill.ts` |
| 1.8 | Écrire le point d'entrée MCP (`index.ts` + `server.ts`) | `src/index.ts`, `src/server.ts` |
| 1.9 | Créer un dossier de skills de test (3-4 fichiers sur 2 niveaux, avec assets et scripts de test) | `test-skills/` |
| 1.10 | Tests unitaires pour `KeywordMatcher`, `SkillResolver` et `AssetResolver` | `tests/` |
| 1.11 | Tester manuellement avec Claude Code en local | — |

**Dépendances npm :**

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "latest",
    "gray-matter": "^4.0.3",
    "simple-git": "^3.22.0",
    "yaml": "^2.3.4"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "tsx": "^4.7.0",
    "vitest": "^1.2.0",
    "@types/node": "^20.0.0"
  }
}
```

### Phase 2 — Synchronisation Git (1-2 jours)

**Objectif :** Le contenu vient du repo distant, avec refresh automatique.

| Étape | Tâche | Fichier(s) |
|-------|-------|------------|
| 2.1 | Implémenter `GitSync` : clone, pull, gestion d'erreurs | `src/core/git-sync.ts` |
| 2.2 | Ajouter le refresh périodique avec `setInterval` | `src/core/git-sync.ts` |
| 2.3 | Connecter `GitSync.on('content-updated')` → `SkillIndex.rebuild()` | `src/server.ts` |
| 2.4 | Implémenter l'outil `refresh_skills` | `src/tools/refresh-skills.ts` |
| 2.5 | Parser `config.yaml` du repo de contenu pour la configuration | `src/core/git-sync.ts` |
| 2.6 | Tests pour `GitSync` (mock de `simple-git`) | `tests/git-sync.test.ts` |

### Phase 3 — Outils complémentaires (2-3 jours)

**Objectif :** Tous les outils MCP sont fonctionnels, y compris assets et scripts.

| Étape | Tâche | Fichier(s) |
|-------|-------|------------|
| 3.1 | Implémenter `list_skills` (sérialisation de l'arbre, incluant assets/scripts counts) | `src/tools/list-skills.ts` |
| 3.2 | Implémenter `report_usage` (collecte du feedback) | `src/tools/report-usage.ts` |
| 3.3 | Implémenter `get_asset` (lecture texte et binaire, résolution d'héritage) | `src/tools/get-asset.ts` |
| 3.4 | Implémenter `run_script` (vérification d'autorisation, spawn, capture stdout/stderr, timeout) | `src/tools/run-script.ts` |
| 3.5 | Tests pour tous les outils, y compris les cas d'erreur (script non autorisé, asset manquant, timeout) | `tests/tools/` |

### Phase 4 — Analytics (1-2 jours)

**Objectif :** Les events sont collectés et publiés.

| Étape | Tâche | Fichier(s) |
|-------|-------|------------|
| 4.1 | Implémenter le `Tracker` (queue en mémoire) | `src/analytics/tracker.ts` |
| 4.2 | Implémenter le `Publisher` (HTTP batch + fallback fichier) | `src/analytics/publisher.ts` |
| 4.3 | Instrumenter tous les outils pour émettre des events | `src/tools/*.ts` |
| 4.4 | Mettre en place l'endpoint de réception (webhook simple ou fonction serverless) | externe au repo |
| 4.5 | Tests du publisher (mock HTTP) | `tests/analytics/` |

### Phase 5 — Distribution et onboarding (1 jour)

**Objectif :** N'importe quel dev de l'équipe peut installer en une commande.

| Étape | Tâche | Fichier(s) |
|-------|-------|------------|
| 5.1 | Configurer le build TypeScript (`tsc`) et le shebang | `tsconfig.json`, `package.json` |
| 5.2 | Configurer la publication sur GitHub Packages | `.github/workflows/publish.yml` |
| 5.3 | Créer le `.mcp.json` template pour les projets | doc |
| 5.4 | Écrire le README d'onboarding | `README.md` |
| 5.5 | Créer le repo de contenu skills avec 5-10 skills initiaux | repo séparé |
| 5.6 | Test end-to-end : onboarding d'un nouveau dev | — |

### Phase 6 — Durcissement (continu)

| Tâche | Détail |
|-------|--------|
| Affiner les keywords | Basé sur les `no_match` et les feedbacks négatifs |
| Ajouter des skills | Basé sur les patterns d'usage observés |
| Tuner les seuils | `min_score`, `ambiguity_threshold` selon les analytics |
| CI sur le repo de contenu | Valider les frontmatters (keywords présents, format correct) |
| Dashboard analytics | Visualisation des métriques clés (optionnel) |

---

## 6. Gestion des cas limites

| Cas | Comportement |
|-----|-------------|
| Réseau indisponible au démarrage | Utiliser le cache local `~/.skills-mcp/content/`, loguer un warning |
| Réseau indisponible au refresh | Ignorer silencieusement, réessayer au prochain intervalle |
| Frontmatter invalide dans un skill | Ignorer ce skill à l'indexation, loguer un warning |
| Aucun skill ne matche | Retourner `no_match` avec le candidat le plus proche et son score |
| Token GitHub expiré | Erreur explicite avec message d'aide pour renouveler |
| Repo de contenu vide | Le serveur démarre mais `get_skill` retourne toujours `no_match` |
| Fichier `.md` sans frontmatter | Ignoré à l'indexation (le frontmatter est requis) |
| Cycle d'héritage | Impossible par construction (l'arbre est un DAG basé sur le filesystem) |
| Contenu trop volumineux après agrégation | Tronquer avec un avertissement si > 8000 tokens estimés |
| Asset déclaré dans le frontmatter mais absent du filesystem | Loguer un warning, exclure l'asset, le skill reste fonctionnel |
| Asset > 1 MB | Refuser avec un message d'erreur clair (via `get_asset`) |
| Script avec `execution: "claude"` appelé via `run_script` | Refuser avec un message explicite redirigeant vers `get_asset` + bash |
| Script avec `execution: "server"` mais extension non supportée | Refuser avec la liste des extensions supportées |
| Script qui dépasse le timeout (60s) | Tuer le process, retourner une erreur avec le stdout partiel capturé |
| Arguments requis manquants pour `run_script` | Retourner la liste des arguments manquants avec leurs descriptions |
| Dossier de ressources existant mais non déclaré dans le frontmatter | Ignoré — seuls les assets/scripts déclarés dans le frontmatter sont exposés |
| Asset hérité en conflit de nom avec un asset local | L'asset local gagne (plus spécifique) |

---

## 7. Sécurité

L'ajout de l'exécution de scripts côté serveur introduit une surface d'attaque qu'il faut adresser explicitement.

### 7.1 Modèle de confiance

Le modèle repose sur la confiance envers le repo Git de skills. Les scripts sont :

- **Versionnés** — chaque modification passe par Git (et idéalement par une pull request avec review)
- **Opt-in explicite** — seuls les scripts déclarés avec `execution: "server"` dans le frontmatter sont exécutables via `run_script`. Un fichier `.sh` dans le dossier scripts qui n'est pas déclaré dans le frontmatter n'est pas accessible
- **Pas d'injection shell** — les arguments sont passés via des variables d'environnement, jamais interpolés dans une commande shell

### 7.2 Mesures de défense en profondeur

| Mesure | Détail |
|--------|--------|
| Whitelist d'extensions | Seules les extensions déclarées dans `config.yaml` sont autorisées |
| Timeout | Tout script est tué après `timeout_seconds` (défaut : 60s) |
| Limite de sortie | stdout/stderr tronqués à `max_output_bytes` (défaut : 1 MB) |
| Pas de shell interpolation | `child_process.spawn` avec `shell: false`, arguments via env vars |
| Pas d'exécution arbitraire | Le chemin du script est validé : il doit être dans le dossier `scripts/` d'un skill déclaré. Toute tentative de path traversal (`../`) est rejetée |
| Kill switch global | `scripts.enabled: false` dans `config.yaml` désactive `run_script` entièrement |
| Audit trail | Chaque exécution génère un event analytics avec le script, les args, le résultat |

### 7.3 Recommandations pour l'équipe

- Exiger une **review de PR** pour tout ajout/modification de script dans le repo de skills
- Privilégier `execution: "claude"` quand le script est simple et transparent (Claude voit le code, l'utilisateur aussi)
- Réserver `execution: "server"` aux scripts qui nécessitent un runtime spécifique (ts-node, python avec dépendances) ou qui doivent être opaques pour Claude
- Ne **jamais** stocker de secrets dans les scripts — utiliser des variables d'environnement de la machine

---

## 8. Checklist de validation finale

Avant de considérer le serveur prêt pour l'équipe :

- [ ] `get_skill` retourne le bon contenu pour 10 requêtes de test variées
- [ ] `get_skill` inclut les assets et scripts dans sa réponse
- [ ] L'héritage fonctionne (`inherit: true` inclut les parents, `false` ne les inclut pas)
- [ ] L'héritage des assets fonctionne (assets des parents accessibles, conflits résolus)
- [ ] L'ambiguïté est correctement détectée et présentée
- [ ] `list_skills` retourne l'arbre complet et filtré par path
- [ ] `report_usage` enregistre les feedbacks
- [ ] `refresh_skills` déclenche un pull et re-indexe
- [ ] `get_asset` retourne le contenu texte d'un template
- [ ] `get_asset` retourne le contenu base64 d'une image
- [ ] `get_asset` résout un asset hérité d'un parent
- [ ] `get_asset` refuse un asset > 1 MB
- [ ] `run_script` exécute un script `execution: "server"` avec succès
- [ ] `run_script` refuse un script `execution: "claude"`
- [ ] `run_script` passe les arguments en env vars et capture stdout/stderr
- [ ] `run_script` respecte le timeout et retourne une erreur propre
- [ ] `run_script` valide les arguments requis avant exécution
- [ ] Le serveur démarre sans réseau (cache local)
- [ ] Le refresh périodique fonctionne (observer les logs)
- [ ] Les analytics arrivent à l'endpoint (ou dans le fichier local)
- [ ] Les events `asset_served` et `script_executed` sont émis
- [ ] `npx @monorg/skills-mcp` fonctionne après `npm login`
- [ ] Un nouveau dev peut être opérationnel en < 5 minutes avec le README
- [ ] Les frontmatters invalides sont ignorés sans crash
- [ ] Un asset déclaré mais absent du filesystem génère un warning sans crash
