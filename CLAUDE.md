# skills-mcp

MCP server (Model Context Protocol) that exposes a tree of Markdown-based dev skills to Claude Code. Runs locally on each developer's machine, syncing skill content from a private GitHub repo.

## Commands

```bash
npm run build        # tsc — compile TypeScript to dist/
npm run dev          # tsx src/index.ts — run server in dev mode
npm run test         # vitest
npm run lint         # eslint src/
npm run typecheck    # tsc --noEmit
```

## Architecture

### Project structure

```
src/
├── index.ts                   # Entry point, MCP server bootstrap
├── server.ts                  # Server definition, tool registration
├── core/
│   ├── git-sync.ts            # Clone/pull repo, periodic refresh (simple-git)
│   ├── skill-index.ts         # Parse .md files, build in-memory tree, search
│   ├── skill-resolver.ts      # Inheritance resolution, content aggregation
│   ├── keyword-matcher.ts     # Deterministic keyword scoring algorithm
│   └── asset-resolver.ts      # Resolve asset/script paths, read content
├── tools/
│   ├── get-skill.ts           # get_skill — search and return best skill
│   ├── get-asset.ts           # get_asset — retrieve asset/script content
│   ├── run-script.ts          # run_script — execute server-side scripts
│   ├── list-skills.ts         # list_skills — browse skill tree
│   ├── report-usage.ts        # report_usage — feedback collection
│   └── refresh-skills.ts      # refresh_skills — force git pull + reindex
├── analytics/
│   ├── tracker.ts             # In-memory event queue
│   └── publisher.ts           # HTTP batch push + local file fallback
└── types/
    └── index.ts               # Shared types (Skill, AssetMeta, ScriptMeta, etc.)
tests/
├── keyword-matcher.test.ts
├── skill-resolver.test.ts
├── asset-resolver.test.ts
├── git-sync.test.ts
└── tools/
    ├── get-skill.test.ts
    ├── get-asset.test.ts
    ├── run-script.test.ts
    └── list-skills.test.ts
```

### Core modules

- **GitSync** — Clones/pulls the skills content repo into `~/.skills-mcp/content/`. Emits `content-updated` event after successful pulls. Periodic refresh via `setInterval`. Uses `GITHUB_TOKEN` env var or git credential helper.
- **SkillIndex** — Parses all `.md` files under `skills/`, extracts YAML frontmatter (via `gray-matter`), builds parent/child tree. Exposes `search(context)` and `getTree()`. Rebuilds on `content-updated`.
- **KeywordMatcher** — Tokenizes context string, matches against skill keywords (exact, substring, contains). Score = matchedKeywords / totalKeywords + priority tiebreaker. Ambiguity detected when top scores are within threshold.
- **SkillResolver** — When `inherit: true` (default), concatenates content from `_root.md` down to the matched skill with section headers. When `inherit: false`, returns skill content only.
- **AssetResolver** — Resolves `{skill-name}/assets/` and `{skill-name}/scripts/` directories. Detects binary vs text by extension. Supports inherited assets (parent assets available when `inherit: true`, local wins on name conflict).

### MCP tools

| Tool | Purpose |
|------|---------|
| `get_skill` | Search skills by context string, return best match with aggregated content + asset/script metadata |
| `list_skills` | Browse the full skill tree with descriptions and keywords |
| `get_asset` | Retrieve asset or script file content (text inline, binary as base64) |
| `run_script` | Execute server-side scripts (`execution: "server"` only). Args passed as `SKILL_ARG_*` env vars |
| `report_usage` | Submit feedback (useful/not useful + comment) for analytics |
| `refresh_skills` | Force git pull and reindex |

### Data flow

```
Claude Code  →  get_skill("react auth component")
                    ↓
             KeywordMatcher scores all skills
                    ↓
             Best match (or ambiguity list) returned
                    ↓
             SkillResolver aggregates content with inheritance
                    ↓
             Response includes content + asset/script metadata
                    ↓
Claude Code  →  get_asset("ui/react/auth", "assets/AuthProvider.tsx.template")
                    ↓
             AssetResolver reads file, returns content
```

## Skill format

Each `.md` file has a YAML frontmatter:

```yaml
---
keywords: [react, component, hook]   # Required. For keyword matching
description: "React component rules" # Required. Shown on ambiguity
inherit: true                        # Optional (default: true). Include parent content
priority: 10                         # Optional (default: 0). Tiebreaker
assets:                              # Optional. Associated files
  - file: assets/Template.tsx.template
    description: "Base template"
    type: template                   # template | config | example | schema | image | other
scripts:                             # Optional. Associated scripts
  - file: scripts/scaffold.sh
    description: "Generate project structure"
    execution: claude                # claude (default) = Claude reads+executes via bash
                                     # server = executed via run_script tool
    args:
      - name: project_dir
        required: true
      - name: variant
        required: false
        default: "default"
---

# Skill content here (Markdown)
```

## Conventions

### File naming

- `_root.md` — Root skill, universal rules (applied to all when inheriting)
- `_index.md` — Intermediate skill for a directory/domain
- `*.md` — Leaf skills
- `{skill-name}/assets/` — Assets directory (matches `.md` filename without extension)
- `{skill-name}/scripts/` — Scripts directory
- For `_index.md`, resource dir is `_index/`

### Parent resolution

```
skills/ui/react/auth.md     → parent: skills/ui/react/_index.md
skills/ui/react/_index.md   → parent: skills/ui/_index.md
skills/ui/_index.md         → parent: skills/_root.md
skills/_root.md             → no parent
```

### Script execution modes

- `execution: "claude"` — Claude retrieves content via `get_asset`, then runs it via bash. Script is visible and transparent.
- `execution: "server"` — Server runs it via `run_script` with `child_process.spawn(shell: false)`. Args passed as `SKILL_ARG_*` env vars. For scripts needing specific runtimes (ts-node, python).

### Binary vs text detection

- **Binary**: `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.ico`, `.webp`, `.pdf`, `.zip`, `.woff`, `.woff2`
- **Text**: everything else (`.ts`, `.tsx`, `.js`, `.sh`, `.yaml`, `.json`, `.template`, `.example`, `.md`, etc.)

## Configuration

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SKILLS_REPO` | Yes | Git URL of the skills content repo |
| `SKILLS_BRANCH` | No | Branch to track (default: `main`) |
| `GITHUB_TOKEN` | No | For private repos. Falls back to git credential helper |
| `ANALYTICS_ENDPOINT` | No | Webhook URL for analytics events |
| `REFRESH_INTERVAL_MINUTES` | No | Auto-refresh interval (default: `15`) |

### config.yaml (in skills content repo)

Located at root of the skills content repo. Controls matching thresholds, analytics, git sync, script execution limits, and asset size limits. Key settings:

- `matching.min_score` (default: 0.2) — Minimum score to consider a skill
- `matching.max_results` (default: 3) — Max candidates on ambiguity
- `matching.ambiguity_threshold` (default: 0.1) — Score gap triggering ambiguity
- `scripts.enabled` (default: true) — Global kill switch for `run_script`
- `scripts.timeout_seconds` (default: 60) — Per-script execution timeout
- `scripts.allowed_extensions` — Whitelist: `.sh`, `.ts`, `.js`, `.py`
- `assets.max_size_bytes` (default: 1MB) — Reject assets over this size
- `assets.inline_text_max_bytes` (default: 10KB) — Text assets below this are inlined in `get_skill`

## Dependencies

- `@modelcontextprotocol/sdk` — MCP server SDK
- `gray-matter` — YAML frontmatter parser
- `simple-git` — Git operations
- `yaml` — Config file parser
- `vitest` — Test framework
- `tsx` — TypeScript execution (dev)

## Security notes

- Scripts are versioned in Git and must be declared in frontmatter with `execution: "server"` to be runnable via `run_script`
- Arguments are passed as environment variables (no shell interpolation)
- `child_process.spawn` with `shell: false`
- Path traversal (`../`) in script paths is rejected
- All script executions are tracked in analytics
