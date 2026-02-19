# Analyse des systèmes de mémoire MCP

## Contexte

L'écosystème MCP (Model Context Protocol) a vu émerger de nombreux serveurs dédiés à la « mémoire » des assistants IA. Ces systèmes répondent à un besoin fondamental : donner à l'IA une persistance au-delà de la conversation courante. skills-mcp répond à un sous-ensemble de ce besoin (transmettre des conventions de code), mais il est utile de comprendre comment il se positionne dans le paysage plus large des systèmes de mémoire pour IA.

Ce document cartographie les principales approches, les compare à skills-mcp, et en tire des conclusions sur le positionnement et les opportunités d'évolution.

---

## Panorama des systèmes de mémoire MCP

### 1. Knowledge Graph — `@modelcontextprotocol/server-memory` (Anthropic)

L'implémentation de référence officielle d'Anthropic. Un graphe de connaissances avec trois primitives :

- **Entités** — nœuds représentant des personnes, projets, concepts
- **Relations** — liens dirigés entre entités (« works_at », « depends_on »)
- **Observations** — faits atomiques attachés à une entité (« Préfère TypeScript », « Utilise Vim »)

**Stockage :** un fichier JSONL unique (`memory.json`). Zéro dépendance externe.

**Récupération :** recherche textuelle sur les noms, types et observations. Pas de recherche sémantique, pas d'embeddings.

**Forces :** simplicité radicale, inspectable par un humain, versionnable dans Git.
**Faiblesses :** ne scale pas sur des volumes importants, pas de compréhension conceptuelle (« inscription » ne retrouve pas l'entité « authentication »).

### 2. Markdown-first — Basic Memory

Approche « fichiers Markdown comme source de vérité ». Les notes sont des fichiers `.md` sur disque, indexés par un SQLite local pour le parcours de graphe et la recherche full-text.

**Récupération :** recherche textuelle + traversée de graphe via des liens entre documents (URIs `memory://`).

**Philosophie :** bidirectionnelle — l'humain et l'IA lisent et écrivent les mêmes fichiers. Compatible avec Obsidian.

**Forces :** lisible, éditable hors de tout outil IA, intégration naturelle avec des workflows de documentation existants.
**Faiblesses :** exige de la discipline dans la structuration des notes, pas de recherche vectorielle native.

### 3. Stockage vectoriel — Qdrant MCP, mcp-memory-service (ChromaDB), pgvector

Famille de serveurs qui transforment une base vectorielle en couche mémoire. Le texte est converti en embeddings via un modèle de type sentence-transformers, puis stocké dans une base dédiée.

**Implémentations notables :**
- **Qdrant MCP** (officiel Qdrant) — deux outils seulement : `qdrant-store` et `qdrant-find`. Minimaliste et performant.
- **mcp-memory-service** (ChromaDB) — le plus riche en fonctionnalités communautaires : rappel temporel en langage naturel, tags, consolidation « inspirée du rêve » (decay scoring, compression, archivage).
- **Memory PostgreSQL** (pgvector) — recherche sémantique avec scoring de confiance et filtrage par tags.

**Forces :** meilleure qualité de récupération pour les requêtes floues ou conceptuelles, scale bien.
**Faiblesses :** nécessite un modèle d'embedding (400-600 Mo), infrastructure plus lourde, mémoires opaques (non lisibles par un humain sans outil dédié).

### 4. Hybride — Mem0 / OpenMemory, Letta AI

L'approche la plus sophistiquée. Combine une base vectorielle (Qdrant/ChromaDB) avec une base relationnelle (PostgreSQL) et une couche d'intelligence LLM qui décide automatiquement si une nouvelle information doit créer, mettre à jour, ou ignorer une mémoire existante.

**Mem0 :**
- Pipeline ADD/UPDATE/DELETE/NOOP piloté par un LLM
- Partage cross-client (stocker dans Cursor, retrouver dans Claude Desktop)
- Dashboard web pour auditer les mémoires
- +26% de précision sur le benchmark LOCOMO vs OpenAI Memory

**Letta AI :**
- Architecture à deux niveaux : profil utilisateur structuré + base vectorielle épisodique
- Issu de la recherche académique (papier MemGPT)
- Cloud-dependent (nécessite une clé API)

**Forces :** déduplication automatique, mémoire qui s'améliore avec le temps, partage multi-outil.
**Faiblesses :** infrastructure la plus lourde (Docker + multiples bases), complexité opérationnelle significative.

---

## Taxonomie des approches

| Approche | Représentants | Stockage | Récupération | Infrastructure |
|----------|--------------|----------|-------------|----------------|
| **Graphe de connaissances** | server-memory (Anthropic) | JSONL fichier | Textuelle | Zéro |
| **Markdown-first** | Basic Memory | Fichiers .md + SQLite | Full-text + graphe | Minimale |
| **Vectorielle** | Qdrant MCP, ChromaDB, pgvector | Embeddings en base | Similarité sémantique | Moyenne |
| **Hybride** | Mem0, Letta AI | Vecteurs + relationnel + LLM | Sémantique + structurée | Élevée |
| **Skills (skills-mcp)** | skills-mcp | Fichiers .md + Git | Keywords déterministe | Minimale |

---

## Positionnement de skills-mcp

### Ce que skills-mcp n'est PAS

skills-mcp n'est pas un système de mémoire à usage général. Il ne mémorise pas les préférences d'un utilisateur, ne stocke pas de faits appris en conversation, et ne construit pas de profil cumulatif. La distinction est importante : **skills-mcp est un système de distribution de connaissances curatées, pas un système de mémoire émergente.**

### Les deux axes de la « mémoire IA »

On peut distinguer deux axes orthogonaux :

**Axe 1 — Curatée vs Émergente**
- **Curatée :** contenu rédigé, revu, versionné par des humains. skills-mcp, documentation, CLAUDE.md.
- **Émergente :** contenu généré et accumulé par l'IA au fil des interactions. server-memory, Mem0, Basic Memory.

**Axe 2 — Récupération lexicale vs Sémantique**
- **Lexicale :** correspondance de mots-clés, déterministe. skills-mcp, server-memory.
- **Sémantique :** embeddings vectoriels, compréhension conceptuelle. Qdrant, Mem0.

```
                    Curatée
                       │
          skills-mcp ──┤
                       │
        Lexicale ──────┼────── Sémantique
                       │
        server-memory ─┤── Basic Memory
                       │
          Mem0 ────────┤── Qdrant MCP
                       │
                    Émergente
```

skills-mcp occupe le quadrant **curatée + lexicale**. C'est un choix délibéré : le contenu est contrôlé, prévisible, et le routing est débogable. Mais c'est aussi le quadrant le plus éloigné des systèmes de mémoire modernes qui tendent vers le sémantique + émergent.

### Forces distinctives de skills-mcp dans ce paysage

**1. Gouvernance par design.** Aucun système de mémoire MCP ne propose de workflow de revue. skills-mcp hérite naturellement des pratiques Git (branches, PR, review) parce que le contenu est du code. C'est un différenciateur fort pour les équipes qui veulent contrôler ce que l'IA « sait ».

**2. Héritage hiérarchique.** Aucun autre système n'organise les connaissances en arbre avec héritage automatique. Les systèmes de mémoire sont « plats » (liste d'entités, liste de vecteurs). L'héritage de skills-mcp est une forme de raisonnement structurel que les mémoires vectorielles ne reproduisent pas.

**3. Assets et scripts associés.** Les systèmes de mémoire stockent du texte (ou des vecteurs de texte). skills-mcp associe du texte à des fichiers actionnables (templates, scripts). C'est une dimension « opérationnelle » absente de la mémoire pure.

**4. Économie de contexte ciblée.** Les mémoires vectorielles renvoient les N résultats les plus proches sémantiquement, sans notion de hiérarchie ni d'agrégation structurée. skills-mcp assemble un document cohérent (root → leaf) qui couvre le contexte nécessaire sans bruit.

### Faiblesses relatives de skills-mcp

**1. Pas de mémoire conversationnelle.** L'IA ne peut pas « apprendre » via skills-mcp. Si un développeur corrige Claude 5 fois sur la même convention, cette correction n'est pas capturée. Les systèmes comme Mem0 ou server-memory comblent exactement ce besoin.

**2. Recall limité par le lexique.** Le problème identifié dans l'[analyse critique](critical-analysis.md) (« inscription » ne matche pas `[auth, login]`) est structurel. Les systèmes vectoriels n'ont pas ce problème : l'embedding de « formulaire d'inscription » est proche de celui de « authentication form ».

**3. Pas de partage cross-session.** Chaque session Claude Code commence de zéro vis-à-vis des skills consultés. Mem0/OpenMemory persistent entre sessions et entre outils.

---

## Complémentarité plutôt que concurrence

La conclusion la plus importante est que **skills-mcp et les systèmes de mémoire ne sont pas en compétition**. Ils couvrent des besoins différents :

| Besoin | Solution adaptée |
|--------|-----------------|
| Transmettre les conventions d'équipe à l'IA | skills-mcp |
| Mémoriser les préférences individuelles d'un dev | server-memory, Mem0 |
| Retrouver des connaissances par similarité conceptuelle | Qdrant, ChromaDB |
| Accumuler un historique de décisions de projet | Basic Memory |
| Distribuer des templates et scripts d'équipe | skills-mcp |
| Partager du contexte entre outils (Cursor, Claude, VS Code) | Mem0 / OpenMemory |

Un setup optimal pour une équipe serait **skills-mcp + un système de mémoire émergente** tournant en parallèle comme deux serveurs MCP distincts. skills-mcp fournit le « quoi faire » (conventions, templates), la mémoire fournit le « ce que je sais déjà » (préférences, historique, contexte accumulé).

---

## Leçons à tirer pour skills-mcp

### 1. Le recall sémantique est un gap réel, pas théorique

Tous les systèmes de mémoire sauf server-memory utilisent des embeddings. Le passage à une recherche hybride (keywords + embeddings) est la direction naturelle si skills-mcp veut améliorer son recall sans sacrifier le déterminisme. La proposition d'[aliases/synonymes](improvements.md#1-enrichir-le-matching-sans-sacrifier-le-déterminisme) dans les améliorations est un compromis pragmatique, mais un fallback sur embeddings légers (comme `all-MiniLM-L6-v2` utilisé par Qdrant MCP) irait plus loin pour un coût d'infrastructure faible.

### 2. La consolidation de mémoire est une idée transposable

Le mécanisme de « dream consolidation » de mcp-memory-service (decay scoring, compression, archivage) est intéressant pour les analytics de skills-mcp. Transposé : les skills rarement consultés pourraient être signalés pour revue, les patterns de `no_match` récurrents pourraient générer automatiquement des suggestions de nouveaux skills. C'est déjà esquissé dans les [propositions d'amélioration](improvements.md#6-rendre-les-analytics-actionnables-sans-effort), mais l'inspiration des systèmes de mémoire renforce l'urgence.

### 3. Le modèle de Basic Memory valide l'approche Markdown

Basic Memory prouve que le Markdown comme format de stockage de connaissances est viable et apprécié. skills-mcp est plus structuré (frontmatter YAML, héritage explicite), mais partage la même philosophie : contenu lisible, éditable, versionnable. C'est une validation externe de l'architecture.

### 4. Le partage cross-outil est un besoin émergent

Mem0/OpenMemory permettent de stocker une mémoire dans Cursor et de la retrouver dans Claude Desktop. skills-mcp est déjà cross-outil par nature (c'est un serveur MCP standard, utilisable par tout client MCP). Mais la découvrabilité des skills depuis d'autres IDE pourrait être améliorée en documentant les configurations pour Cursor, Windsurf, VS Code (Copilot), etc.

### 5. La description dynamique des outils est une pratique courante

Plusieurs serveurs de mémoire enrichissent la description de leurs outils MCP avec le contenu disponible (« You have 47 memories about React, 12 about auth... »). La proposition de [description dynamique MCP](improvements.md#3-réduire-la-dépendance-à-linvocation-volontaire-de-lia) est validée par cette pratique courante dans l'écosystème.

---

## Résumé

| Dimension | skills-mcp | Systèmes de mémoire |
|-----------|-----------|---------------------|
| **Nature du contenu** | Curatée, revue par PR | Émergente, accumulée par l'IA |
| **Récupération** | Keywords déterministe | Sémantique (embeddings) ou textuelle |
| **Structure** | Arbre hiérarchique avec héritage | Plat (graphe, liste de vecteurs) |
| **Gouvernance** | Git natif (branches, PR, review) | Aucune (ou dashboard ad-hoc) |
| **Opérationnel** | Assets + scripts associés | Texte uniquement |
| **Apprentissage** | Statique (édition humaine) | Dynamique (auto-accumulation) |
| **Cross-session** | Non (rechargé à chaque session) | Oui (persistance entre sessions) |

**Conclusion :** skills-mcp n'est pas en concurrence avec les systèmes de mémoire — il occupe une niche distincte et complémentaire. Son avantage est la gouvernance et la structure ; son manque est l'apprentissage dynamique et le recall sémantique. L'architecture la plus robuste pour une équipe combine les deux : skills-mcp pour les conventions curatées, un serveur de mémoire pour le contexte émergent.
