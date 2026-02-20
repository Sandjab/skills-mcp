# Plan : Document de recherche sur les systèmes de mémoire Claude Code

## Contexte

Le repo contient déjà `docs/memory-systems-analysis.md` qui compare skills-mcp aux **serveurs MCP de mémoire** (server-memory, Qdrant, Mem0, Basic Memory). Le nouveau document couvre un angle complémentaire : les **mécanismes natifs de Claude Code** et les **systèmes communautaires** (CLAUDE.md, Auto Memory, Hooks, Beads, Episodic Memory, Claude Diary, PreCompact Handover, etc.), avec des conclusions croisées sur ce qui est exploitable pour améliorer skills-mcp.

## Actions

### 1. Créer `docs/claude-code-memory-research.md`

**Structure du fichier :**

```
# Systèmes de mémoire pour Claude Code — Recherche & Analyse d'impact pour skills-mcp

## Partie 1 — État de l'art
   (le document de recherche fourni par l'utilisateur, intégralement)
   - §1 Mécanismes natifs (CLAUDE.md, Rules, Auto Memory, Compaction, Hooks, Imports @)
   - §2 Systèmes communautaires (Beads, Episodic Memory, Claude Diary, Claude-Mem, MCP Memory Service, Memory Bank, Simone, PreCompact Handover)
   - §3 Bonnes pratiques consensus
   - §4 Tableau comparatif
   - §5 Tendances et insights clés
   - §6 Références

## Partie 2 — Analyse d'impact pour skills-mcp
   (synthèse consolidée des deux analyses croisées)
   - §7 Convergences entre les deux analyses
   - §8 Idées complémentaires (divergences)
   - §9 Trois axes d'amélioration identifiés
     - Axe 1 : Améliorer le matching (synonymes, summary, pondération feedback)
     - Axe 2 : Compléter ce qui est commencé (inline_text_max_bytes, Publisher, scripts hérités)
     - Axe 3 : Exploiter le protocole MCP au-delà des tools (Prompts, Resources)
   - §10 Ce qu'il ne faut PAS importer
   - §11 Grille consolidée finale (tableau priorisé des 12 améliorations)
```

**Choix du nom :** `claude-code-memory-research.md` — distinct de l'existant `memory-systems-analysis.md`, explicite sur le périmètre (Claude Code, pas MCP servers).

### 2. Mettre à jour `README.md`

Ajouter une ligne dans le tableau Documentation (lignes 107-113) :

| Document | Contenu |
|----------|---------|
| ... (existant) ... |
| [Recherche : mémoire Claude Code](docs/claude-code-memory-research.md) | État de l'art des systèmes de mémoire, analyse d'impact et pistes d'amélioration pour skills-mcp |

Cette ligne s'insère après la ligne `memory-systems-analysis.md` pour grouper les documents liés à la mémoire.

### 3. Commit et push

- Commit avec message décrivant l'ajout du document de recherche
- Push sur la branche `claude/analyze-memory-systems-dI8oz`

## Ce qui NE change PAS

- Aucun fichier source modifié
- `docs/memory-systems-analysis.md` inchangé (complémentaire, pas remplacé)
- `docs/improvements.md` inchangé (certaines propositions se recoupent, c'est attendu — les deux docs servent de référence sous des angles différents)
- `CLAUDE.md` inchangé
