# skills-mcp Functional Specification

## Table of Contents

- [1. System Overview](#1-system-overview)
- [2. Architecture](#2-architecture)
  - [2.1 Component diagram](#21-component-diagram)
  - [2.2 Module responsibilities](#22-module-responsibilities)
- [3. Server Lifecycle](#3-server-lifecycle)
  - [3.1 Startup sequence](#31-startup-sequence)
  - [3.2 Runtime behavior](#32-runtime-behavior)
  - [3.3 Shutdown](#33-shutdown)
- [4. Skill Indexing](#4-skill-indexing)
  - [4.1 File discovery](#41-file-discovery)
  - [4.2 Frontmatter parsing](#42-frontmatter-parsing)
  - [4.3 Skill path derivation](#43-skill-path-derivation)
  - [4.4 Parent resolution](#44-parent-resolution)
  - [4.5 Resource directory resolution](#45-resource-directory-resolution)
  - [4.6 Index rebuild](#46-index-rebuild)
- [5. Keyword Matching Algorithm](#5-keyword-matching-algorithm)
  - [5.1 Tokenization](#51-tokenization)
  - [5.2 Scoring](#52-scoring)
  - [5.3 Ambiguity detection](#53-ambiguity-detection)
- [6. Content Resolution](#6-content-resolution)
  - [6.1 Inheritance chain](#61-inheritance-chain)
  - [6.2 Content aggregation format](#62-content-aggregation-format)
- [7. Asset and Script Resolution](#7-asset-and-script-resolution)
  - [7.1 Asset metadata resolution](#71-asset-metadata-resolution)
  - [7.2 Binary vs text detection](#72-binary-vs-text-detection)
  - [7.3 Inherited assets](#73-inherited-assets)
  - [7.4 Asset content reading](#74-asset-content-reading)
  - [7.5 Asset chain lookup](#75-asset-chain-lookup)
- [8. MCP Tools](#8-mcp-tools)
  - [8.1 get_skill](#81-get_skill)
  - [8.2 list_skills](#82-list_skills)
  - [8.3 get_asset](#83-get_asset)
  - [8.4 run_script](#84-run_script)
  - [8.5 report_usage](#85-report_usage)
  - [8.6 refresh_skills](#86-refresh_skills)
- [9. Git Synchronization](#9-git-synchronization)
  - [9.1 Initialization](#91-initialization)
  - [9.2 Authentication](#92-authentication)
  - [9.3 Periodic refresh](#93-periodic-refresh)
  - [9.4 Force refresh](#94-force-refresh)
  - [9.5 Concurrency control](#95-concurrency-control)
- [10. Analytics](#10-analytics)
  - [10.1 Event tracking](#101-event-tracking)
  - [10.2 Event types](#102-event-types)
  - [10.3 Publishing](#103-publishing)
  - [10.4 Local fallback](#104-local-fallback)
- [11. Configuration](#11-configuration)
  - [11.1 Environment variables](#111-environment-variables)
  - [11.2 config.yaml schema](#112-configyaml-schema)
  - [11.3 Config loading precedence](#113-config-loading-precedence)
- [12. Security](#12-security)
  - [12.1 Path traversal prevention](#121-path-traversal-prevention)
  - [12.2 Script execution sandboxing](#122-script-execution-sandboxing)
  - [12.3 Asset size limits](#123-asset-size-limits)
  - [12.4 Trust model](#124-trust-model)
- [13. Error Handling](#13-error-handling)

---

## 1. System Overview

skills-mcp is a Model Context Protocol (MCP) server that serves Markdown-based developer skills to Claude Code. It provides deterministic keyword-based routing, hierarchical content inheritance, and associated file management (assets and scripts).

```mermaid
graph TB
    subgraph "Developer Machine"
        CC[Claude Code] <-->|MCP Protocol<br/>stdio| S[skills-mcp server]
        S --> SI[SkillIndex]
        S --> SR[SkillResolver]
        S --> AR[AssetResolver]
        S --> GS[GitSync]
        S --> T[Tracker]
    end

    GS -->|clone / pull| GH[(GitHub<br/>skills-content repo)]
    T -->|HTTP POST| AE[Analytics Endpoint]
    T -->|fallback| LF[Local JSONL file]

    SI -.->|reads| FS[~/.skills-mcp/content/skills/]
    GS -->|writes| FS
```

**Key design decisions:**
- **Deterministic routing**: Keyword matching with no external dependencies (no LLM, no embedding).
- **Hierarchical inheritance**: Skills inherit content from parent categories, configurable per skill.
- **Stdio transport**: Communication via stdin/stdout. All logging uses stderr.
- **Atomic index rebuild**: The skill index is rebuilt entirely and swapped in one operation.

---

## 2. Architecture

### 2.1 Component diagram

```mermaid
graph LR
    subgraph "Entry Points"
        IDX[index.ts<br/>CLI bootstrap]
        SRV[server.ts<br/>Orchestrator]
    end

    subgraph "Core Modules"
        KM[KeywordMatcher<br/>Scoring algorithm]
        SKI[SkillIndex<br/>Parse + search]
        SKR[SkillResolver<br/>Inheritance]
        ASR[AssetResolver<br/>File resolution]
        GSY[GitSync<br/>Repo sync]
    end

    subgraph "MCP Tools"
        T1[get_skill]
        T2[list_skills]
        T3[get_asset]
        T4[run_script]
        T5[report_usage]
        T6[refresh_skills]
    end

    subgraph "Analytics"
        TRK[Tracker<br/>Event queue]
        PUB[Publisher<br/>HTTP + fallback]
    end

    IDX --> SRV
    SRV --> SKI
    SRV --> SKR
    SRV --> ASR
    SRV --> GSY
    SRV --> TRK

    SKI --> KM
    SKI --> ASR

    T1 --> SKI
    T1 --> SKR
    T1 --> ASR
    T2 --> SKI
    T3 --> SKI
    T3 --> ASR
    T4 --> SKI
    T6 --> GSY
    T6 --> SKI

    T1 --> TRK
    T3 --> TRK
    T4 --> TRK
    T5 --> TRK
    T6 --> TRK

    TRK --> PUB
```

### 2.2 Module responsibilities

| Module | File | Responsibility |
|--------|------|----------------|
| **KeywordMatcher** | `src/core/keyword-matcher.ts` | Tokenizes query strings, scores skills by keyword overlap, applies priority tiebreakers |
| **SkillIndex** | `src/core/skill-index.ts` | Discovers `.md` files, parses frontmatter, builds parent tree, exposes search and tree APIs |
| **SkillResolver** | `src/core/skill-resolver.ts` | Walks the parent chain and concatenates content with section headers |
| **AssetResolver** | `src/core/asset-resolver.ts` | Resolves asset/script metadata, detects binary files, reads content, manages inheritance |
| **GitSync** | `src/core/git-sync.ts` | Clones/pulls the content repo, emits events on updates, manages periodic refresh |
| **Tracker** | `src/analytics/tracker.ts` | In-memory event queue with type tagging and timestamps |
| **Publisher** | `src/analytics/publisher.ts` | Batches events to HTTP endpoint, falls back to local JSONL file |

---

## 3. Server Lifecycle

### 3.1 Startup sequence

```mermaid
sequenceDiagram
    participant CLI as index.ts
    participant ENV as Environment
    participant GS as GitSync
    participant SRV as server.ts
    participant SI as SkillIndex
    participant MCP as StdioTransport

    CLI->>ENV: Read SKILLS_DIR / SKILLS_REPO
    alt SKILLS_DIR is set
        CLI->>CLI: resolvedSkillsDir = SKILLS_DIR
    else SKILLS_REPO is set
        CLI->>GS: new GitSync(repo, branch, ~/.skills-mcp/content)
        CLI->>GS: initialize()
        GS-->>CLI: Clone or pull complete
        CLI->>CLI: resolvedSkillsDir = localPath + "/skills"
    else neither set
        CLI->>CLI: Exit with error
    end

    CLI->>CLI: loadConfig(skillsDir)
    CLI->>SRV: createServer(skillsDir, config, gitSync)
    SRV->>SI: buildIndex()
    SI-->>SRV: Index built (N skills)
    SRV->>SRV: Register 6 MCP tools
    SRV->>SRV: Wire gitSync "content-updated" → SI.rebuild()
    SRV-->>CLI: Server ready

    CLI->>GS: startPeriodicRefresh(interval)
    CLI->>MCP: server.connect(StdioTransport)
    MCP-->>CLI: Listening on stdio
```

### 3.2 Runtime behavior

During normal operation, the server:
1. Listens for MCP tool calls on stdin.
2. Dispatches to the appropriate tool handler.
3. Returns JSON results on stdout.
4. Periodically pulls from Git (if configured) and rebuilds the index on changes.
5. Flushes analytics events to the configured endpoint (or local file).

### 3.3 Shutdown

The server runs until the stdio transport is closed (Claude Code exits). No explicit cleanup is needed: `setInterval` handles are automatically freed by Node.js.

---

## 4. Skill Indexing

### 4.1 File discovery

The `SkillIndex.buildIndex()` method recursively traverses the `skillsDir` directory to find all `.md` files. Non-`.md` files and subdirectories that are resource directories (e.g., `auth/`) are ignored during file discovery.

### 4.2 Frontmatter parsing

Each `.md` file is parsed with `gray-matter` to extract the YAML frontmatter. The `parseFrontmatter()` function validates and normalizes the raw data:

**Validation rules:**
- `keywords` must be a non-empty array → coerced to `string[]`
- `description` must be a non-empty string
- Files failing validation are skipped with a warning on stderr

**Defaults applied during parsing:**

| Field | Default |
|-------|---------|
| `inherit` | `true` (unless explicitly `false`) |
| `priority` | `0` |
| `assets` | `[]` |
| `scripts` | `[]` |
| `execution` (per script) | `"claude"` |
| `args` (per script) | `[]` |
| `required` (per arg) | `true` |
| `type` (per asset) | `"other"` |

### 4.3 Skill path derivation

The skill path is derived from the file's relative path to `skillsDir`:

```
File path (relative)         → Skill path
─────────────────────────────────────────
_root.md                     → _root
ui/_index.md                 → ui/_index
ui/react/_index.md           → ui/react/_index
ui/react/auth.md             → ui/react/auth
no-inherit.md                → no-inherit
```

**Rules:**
1. Remove the `.md` extension.
2. Normalize path separators to `/` (Windows compatibility).

### 4.4 Parent resolution

Parent resolution is performed in a second pass after all files are parsed. The algorithm uses `deriveParentPath()`:

```mermaid
graph TD
    A["deriveParentPath(skillPath)"] --> B{skillPath == '_root'?}
    B -->|Yes| C[return null]
    B -->|No| D{last segment == '_index'?}
    D -->|Yes| E{has parent directory?}
    E -->|No| F["return '_root'"]
    E -->|Yes| G["return parentDir/_index"]
    D -->|No| H{has directory prefix?}
    H -->|No| I["return '_root'"]
    H -->|Yes| J["return dir/_index"]
```

**Examples:**

| Skill path | Derived parent | Resolved parent |
|------------|---------------|-----------------|
| `_root` | `null` | *(none)* |
| `ui/_index` | `_root` | `_root` |
| `ui/react/_index` | `ui/_index` | `ui/_index` |
| `ui/react/auth` | `ui/react/_index` | `ui/react/_index` |
| `no-inherit` | `_root` | `_root` |

**Missing intermediate parents:** If a derived parent path does not exist in the index, the algorithm walks further up (calls `deriveParentPath` on the missing parent) until it finds an existing skill or reaches `null`.

### 4.5 Resource directory resolution

For each skill, the index checks whether a resource directory exists:

| Skill file | Expected resource directory |
|------------|---------------------------|
| `ui/react/auth.md` | `ui/react/auth/` |
| `ui/_index.md` | `ui/_index/` |
| `_root.md` | `_root/` |

The check uses `fs.stat()`. If the directory does not exist, `resourceDir` is set to `null` and the skill is still valid (just has no local assets/scripts).

### 4.6 Index rebuild

`rebuild()` calls `buildIndex()`, which:
1. Creates a new `Map<string, Skill>`.
2. Parses all files and resolves parents.
3. Atomically replaces the existing map.

This ensures that searches always operate on a consistent snapshot. Since JavaScript is single-threaded, no locking is needed.

---

## 5. Keyword Matching Algorithm

### 5.1 Tokenization

The `tokenize(context)` function processes a free-text query string:

```mermaid
graph LR
    A[Input string] --> B[Lowercase]
    B --> C["Remove punctuation<br/>(keep hyphens)"]
    C --> D[Split on whitespace]
    D --> E["Filter stop words<br/>(EN + FR)"]
    E --> F[Deduplicate]
    F --> G[Token array]
```

**Stop words** include common English words (a, an, the, is, of, to, in, for, with, etc.) and French words (le, la, les, un, une, de, du, et, ou, en, etc.).

**Example:**
```
Input:  "Create a React component for the authentication"
Tokens: ["create", "react", "component", "authentication"]
```

### 5.2 Scoring

The `score(context, keywords, priority)` function computes a match score:

```
For each skill keyword kw (lowercased):
  For each context token:
    if both token and kw are < 3 chars:
      match only if token === kw         (exact match for short tokens)
    else:
      match if token === kw              (exact)
           OR token.includes(kw)         (token contains keyword)
           OR kw.includes(token)         (keyword contains token)

baseScore = matchedKeywords.length / totalKeywords.length
finalScore = baseScore + (priority * 0.001)
```

**Score range:** `0.0` to `1.0 + maxPriority * 0.001`

**Short token protection:** Tokens shorter than 3 characters (e.g., "go", "js") require exact match with equally short keywords. This prevents false positives like "go" matching "golang" or "js" matching "json".

**Bidirectional matching examples:**

| Context token | Keyword | Match? | Reason |
|--------------|---------|--------|--------|
| `react` | `react` | Yes | Exact |
| `authentication` | `auth` | Yes | Token contains keyword |
| `auth` | `authentication` | Yes | Keyword contains token |
| `react` | `reactjs` | Yes | Keyword contains token |
| `go` | `golang` | No | Both short → exact only; `go` !== `golang` and `go` is < 3 chars |
| `ts` | `ts` | Yes | Both short → exact match |

### 5.3 Ambiguity detection

After scoring all skills:

```mermaid
graph TD
    A[Score all skills] --> B[Filter by min_score]
    B --> C[Sort descending by score]
    C --> D{results.length >= 2?}
    D -->|No| E{results.length == 1?}
    E -->|Yes| F[Return single match]
    E -->|No| G[Return no_match]
    D -->|Yes| H{"score[0] - score[1]<br/>< ambiguity_threshold?"}
    H -->|Yes| I["Return ambiguous<br/>(up to max_results candidates)"]
    H -->|No| F
```

**Default thresholds:**
- `min_score`: 0.2 — Skills scoring below this are excluded.
- `ambiguity_threshold`: 0.1 — If the gap between the top two scores is less than this, ambiguity is reported.
- `max_results`: 3 — Maximum number of ambiguous candidates returned.

---

## 6. Content Resolution

### 6.1 Inheritance chain

When `inherit: true`, `SkillResolver.resolve()` walks the parent chain from the matched skill to `_root`, then concatenates content from most general to most specific:

```mermaid
graph BT
    D["ui/react/auth.md<br/><b>Auth rules</b>"] --> C["ui/react/_index.md<br/><b>React rules</b>"]
    C --> B["ui/_index.md<br/><b>UI rules</b>"]
    B --> A["_root.md<br/><b>Global rules</b>"]

    style A fill:#e8f5e9
    style B fill:#e3f2fd
    style C fill:#fff3e0
    style D fill:#fce4ec
```

**Chain collection:** Walk from skill to root, collecting all ancestors into an array, then reverse it (root first).

### 6.2 Content aggregation format

Each skill in the chain is rendered as a section with a header:

```
=== GLOBAL RULES (from _root.md) ===

[content of _root.md]

=== UI (from ui/_index.md) ===

[content of ui/_index.md]

=== UI > REACT (from ui/react/_index.md) ===

[content of ui/react/_index.md]

=== UI > REACT > AUTH (from ui/react/auth.md) ===

[content of ui/react/auth.md]
```

**Header formatting rules:**
- `_root` → `GLOBAL RULES`
- Other paths: uppercase, `/` replaced with ` > `, `_INDEX` segments removed, whitespace normalized.
- `(from ...)` includes the original `filePath` for traceability.

When `inherit: false`, only the skill's own `content` is returned (no headers, no parents).

---

## 7. Asset and Script Resolution

### 7.1 Asset metadata resolution

`AssetResolver.resolveAssets()` transforms frontmatter declarations into resolved `AssetMeta` objects:

```mermaid
graph LR
    A[Frontmatter asset declaration] --> B{resourceDir exists?}
    B -->|No| C[Return empty array]
    B -->|Yes| D{Path traversal?}
    D -->|Yes| E["Skip + log warning"]
    D -->|No| F["Create AssetMeta<br/>absolutePath = join(resourceDir, file)<br/>isBinary = check extension"]
```

The same process applies to `resolveScripts()`, which additionally resolves `args` and `execution` mode.

### 7.2 Binary vs text detection

Detection is based solely on file extension:

**Binary extensions:** `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.ico`, `.webp`, `.pdf`, `.zip`, `.woff`, `.woff2`

**Text:** All other extensions (`.ts`, `.tsx`, `.js`, `.sh`, `.yaml`, `.json`, `.template`, `.example`, `.md`, etc.)

**MIME type mapping** is used for binary assets served via `get_asset`:

| Extension | MIME type |
|-----------|-----------|
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.gif` | `image/gif` |
| `.svg` | `image/svg+xml` |
| `.pdf` | `application/pdf` |
| `.zip` | `application/zip` |
| `.woff` | `font/woff` |
| `.woff2` | `font/woff2` |
| *(other)* | `application/octet-stream` |

### 7.3 Inherited assets

When `inherit: true`, assets from the entire parent chain are available:

```mermaid
graph TD
    A["_root<br/>assets: [global.css]"] --> B["ui/_index<br/>assets: [design-tokens.json]"]
    B --> C["ui/react/_index<br/>assets: [component-base.tsx]"]
    C --> D["ui/react/auth<br/>assets: [AuthProvider.tsx, component-base.tsx]"]

    style D fill:#fce4ec
```

**Conflict resolution:** The chain is traversed root → leaf. Each asset is stored in a map keyed by filename. Later entries (more specific skills) overwrite earlier ones. In the example above, `ui/react/auth`'s `component-base.tsx` overrides the parent's version.

**The `from` field:** Inherited assets include a `from` field indicating the source skill path. Assets from the skill itself have `from: undefined`.

### 7.4 Asset content reading

| Type | Method | Returns | Size check |
|------|--------|---------|------------|
| Text | `readAssetContent(path, maxBytes)` | UTF-8 string | Throws if `file.size > maxBytes` |
| Binary | `readAssetBase64(path, maxBytes)` | Base64 string | Throws if `file.size > maxBytes` |

### 7.5 Asset chain lookup

`findAssetInChain(skill, file)` searches for an asset by its relative path:

1. Check the skill's own assets and scripts.
2. If `inherit: true` and not found, check the parent.
3. Continue up the chain until found or no more parents.
4. Returns the asset metadata and the `from` skill path (or `undefined` if found on the queried skill directly).

---

## 8. MCP Tools

All tools return responses in the MCP format: `{ content: [{ type: "text", text: JSON.stringify(result) }] }`.

### 8.1 get_skill

**Purpose:** Search skills by context string and return the best match.

**Input schema:**
```
context: string (required) — Free-text task description
```

**Processing flow:**

```mermaid
graph TD
    A[Receive context string] --> B["SkillIndex.search(context)"]
    B --> C{Results empty?}
    C -->|Yes| D["Return no_match"]
    C -->|No| E{"score[0] - score[1]<br/>< threshold?"}
    E -->|Yes| F["Return ambiguous<br/>with candidates"]
    E -->|No| G["SkillResolver.resolve(bestSkill)"]
    G --> H["Collect own assets/scripts"]
    H --> I["Collect inherited assets/scripts"]
    I --> J["Return match with<br/>content + metadata"]
```

**Response formats:**

*No match:*
```json
{
  "no_match": true,
  "message": "No skill matches the given context."
}
```

*Ambiguous (multiple candidates):*
```json
{
  "ambiguous": true,
  "candidates": [
    {
      "skill_path": "ui/react/auth",
      "score": 0.55,
      "description": "React authentication components and patterns",
      "matched_keywords": ["react", "auth"]
    },
    {
      "skill_path": "api/auth",
      "score": 0.5,
      "description": "API authentication with JWT middleware",
      "matched_keywords": ["auth", "api"]
    }
  ],
  "message": "Multiple skills match. Specify your need or pick a skill_path."
}
```

*Single match:*
```json
{
  "skill_path": "ui/react/auth",
  "score": 0.875,
  "matched_keywords": ["react", "auth", "component"],
  "content": "=== GLOBAL RULES ===\n...\n=== UI > REACT > AUTH ===\n...",
  "assets": [
    { "file": "assets/AuthProvider.tsx.template", "description": "...", "type": "template" }
  ],
  "scripts": [
    { "file": "scripts/scaffold-auth.sh", "description": "...", "execution": "claude", "args": [...] }
  ],
  "inherited_assets": [
    { "file": "assets/component-base.tsx.template", "description": "...", "type": "template", "from": "ui/react/_index" }
  ],
  "inherited_scripts": []
}
```

**Analytics events:** `no_match`, `ambiguous`, or `skill_served`.

### 8.2 list_skills

**Purpose:** Browse the skill tree.

**Input schema:**
```
path: string (optional) — Sub-tree filter (e.g., "ui" or "api/_index")
```

**Response:** A recursive tree of `SkillNode` objects, each containing `name`, `path`, `description`, `keywords`, `assetCount`, `scriptCount`, and `children`.

### 8.3 get_asset

**Purpose:** Retrieve asset or script file content.

**Input schema:**
```
skill_path: string (required) — Skill path
file: string (required)       — Relative file path within the resource directory
```

**Processing flow:**

```mermaid
graph TD
    A[Receive skill_path + file] --> B{Skill exists?}
    B -->|No| ERR1[Error: skill not found]
    B -->|Yes| C{Path traversal?}
    C -->|Yes| ERR2[Error: path traversal]
    C -->|No| D["findAssetInChain(skill, file)"]
    D --> E{Found?}
    E -->|No| ERR3[Error: asset not found]
    E -->|Yes| F{File exists on disk?}
    F -->|No| ERR4[Error: declared but missing]
    F -->|Yes| G{Binary?}
    G -->|Yes| H["readAssetBase64()<br/>Return content_base64 + mime_type"]
    G -->|No| I["readAssetContent()<br/>Return content"]
```

**Response (text asset):**
```json
{
  "skill_path": "ui/react/auth",
  "file": "assets/AuthProvider.tsx.template",
  "content": "import React...",
  "size_bytes": 2340,
  "type": "template"
}
```

**Response (binary asset):**
```json
{
  "skill_path": "ui/react/auth",
  "file": "assets/auth-flow.svg",
  "content_base64": "PHN2ZyB4bWxucz0i...",
  "size_bytes": 15200,
  "type": "image",
  "mime_type": "image/svg+xml"
}
```

**Response (inherited asset):** Includes `"resolved_from": "ui/react/_index"`.

**Analytics event:** `asset_served`.

### 8.4 run_script

**Purpose:** Execute a server-side script in a controlled environment.

**Input schema:**
```
skill_path: string              (required) — Skill path
file: string                    (required) — Script file path
args: Record<string, string>    (required) — Named arguments
cwd: string                     (optional) — Working directory
```

**Validation cascade:**

```mermaid
graph TD
    A[Receive request] --> B{scripts.enabled?}
    B -->|No| E1["Error: disabled globally"]
    B -->|Yes| C{Skill exists?}
    C -->|No| E2["Error: skill not found"]
    C -->|Yes| D{Path traversal?}
    D -->|Yes| E3["Error: path traversal"]
    D -->|No| F{Script in frontmatter?}
    F -->|No| E4["Error: script not declared"]
    F -->|Yes| G{"execution == 'server'?"}
    G -->|No| E5["Error: use get_asset + bash"]
    G -->|Yes| H{Required args present?}
    H -->|No| E6["Error: missing args"]
    H -->|Yes| I{Extension allowed?}
    I -->|No| E7["Error: extension not allowed"]
    I -->|Yes| J{File exists?}
    J -->|No| E8["Error: file missing"]
    J -->|Yes| K{Runner configured?}
    K -->|No| E9["Error: no runner"]
    K -->|Yes| L["Execute script"]
```

**Execution details:**
- **Process:** `child_process.spawn(runner, [...runnerArgs, scriptPath], { shell: false })`
- **Arguments:** Passed as environment variables `SKILL_ARG_{UPPERCASE_NAME}`
- **Runners:** Determined by extension (`.sh` → `bash`, `.ts` → `npx tsx`, `.js` → `node`, `.py` → `python3`)
- **Timeout:** Sends `SIGTERM`, waits 5s, then `SIGKILL`
- **Output cap:** Both stdout and stderr truncated at `max_output_bytes`
- **stdin:** Closed (`ignore`)

**Response (success):**
```json
{
  "success": true,
  "exit_code": 0,
  "stdout": "Auth config is valid\n",
  "stderr": "",
  "duration_ms": 340,
  "script": "scripts/validate-auth-config.ts"
}
```

**Response (script failure):**
```json
{
  "success": false,
  "exit_code": 1,
  "stdout": "",
  "stderr": "Error: Missing required field 'clientId'",
  "duration_ms": 120,
  "script": "scripts/validate-auth-config.ts"
}
```

**Response (timeout):**
```json
{
  "success": false,
  "exit_code": 137,
  "stdout": "[partial output]",
  "stderr": "[partial output]\n[skills-mcp] Script killed: timeout exceeded.",
  "duration_ms": 60000,
  "script": "scripts/long-running.sh"
}
```

**Analytics event:** `script_executed`.

### 8.5 report_usage

**Purpose:** Collect feedback on skill quality.

**Input schema:**
```
skill_path: string   (required)
useful: boolean      (required)
comment: string      (optional)
```

**Response:**
```json
{
  "recorded": true,
  "message": "Feedback recorded for ui/react/auth"
}
```

**Side effects:** Logs to stderr, tracks `skill_feedback` event.

### 8.6 refresh_skills

**Purpose:** Force a Git pull and reindex.

**Input schema:** *(none)*

**Processing:**
1. If `gitSync` is available: call `forceRefresh()`.
2. Always: call `skillIndex.rebuild()`.
3. Return stats.

**Response (git mode):**
```json
{
  "success": true,
  "commit_hash": "a1b2c3d...",
  "files_changed": 3,
  "skills_reindexed": 24,
  "last_sync": "2026-02-18T14:30:00.000Z"
}
```

**Response (local mode):**
```json
{
  "success": true,
  "mode": "local",
  "skills_reindexed": 24,
  "message": "Reindexed from local directory (no git sync configured)."
}
```

**Analytics event:** `refresh`.

---

## 9. Git Synchronization

### 9.1 Initialization

```mermaid
sequenceDiagram
    participant GS as GitSync
    participant FS as Filesystem
    participant Git as simple-git

    GS->>FS: Check ~/.skills-mcp/content/.git exists?
    alt Repository exists
        GS->>Git: fetch("origin", branch)
        GS->>Git: checkout(branch)
        GS->>Git: pull("origin", branch)
    else New clone
        GS->>FS: mkdir(~/.skills-mcp/content, recursive)
        GS->>Git: clone(authUrl, localPath, --branch, --single-branch)
    end
    GS->>GS: lastSyncTime = now
```

On failure: logs a warning and continues with the local cache (if any).

### 9.2 Authentication

If `GITHUB_TOKEN` is provided, it is injected into the HTTPS URL:

```
Input:  https://github.com/org/repo.git
Output: https://x-access-token:TOKEN@github.com/org/repo.git
```

If no token is provided, the system falls back to the machine's git credential helper.

### 9.3 Periodic refresh

`startPeriodicRefresh(intervalMs)` sets up a `setInterval` that calls `forceRefresh()` at the configured interval (default: 15 minutes).

`stopPeriodicRefresh()` clears the interval.

### 9.4 Force refresh

```mermaid
graph TD
    A[forceRefresh called] --> B{isRefreshing?}
    B -->|Yes| C["Return {success: false}<br/>Skip concurrent refresh"]
    B -->|No| D["isRefreshing = true"]
    D --> E[Get HEAD hash before]
    E --> F[fetch + pull]
    F --> G[Get HEAD hash after]
    G --> H{Hash changed?}
    H -->|Yes| I["Diff commits for filesChanged<br/>Emit 'content-updated'"]
    H -->|No| J[No changes]
    I --> K["Return RefreshResult"]
    J --> K
    K --> L["isRefreshing = false"]
```

The `content-updated` event triggers `SkillIndex.rebuild()` via the listener wired in `server.ts`.

### 9.5 Concurrency control

A boolean `isRefreshing` flag prevents concurrent refreshes. If `forceRefresh()` is called while one is already running, it immediately returns `{ success: false }` without blocking.

---

## 10. Analytics

### 10.1 Event tracking

The `Tracker` class maintains an in-memory queue of `AnalyticsEvent` objects. When `config.analytics.enabled` is `false`, all `track()` calls are no-ops.

Each event includes:
- `type` — Event name (e.g., `skill_served`)
- `timestamp` — ISO 8601 string
- `server_id` — Derived from `USER` / `USERNAME` env var (format: `dev-{username}`)
- `data` — Event-specific payload

### 10.2 Event types

| Event type | Trigger | Data fields |
|------------|---------|-------------|
| `no_match` | `get_skill` returns no results | `context` |
| `ambiguous` | `get_skill` detects ambiguity | `context`, `candidates` (paths) |
| `skill_served` | `get_skill` returns a match | `context`, `skill_path`, `score`, `matched_keywords`, `was_ambiguous` |
| `asset_served` | `get_asset` returns content | `skill_path`, `file`, `asset_type`, `is_inherited`, `size_bytes` |
| `script_executed` | `run_script` completes | `skill_path`, `file`, `execution_mode`, `success`, `exit_code`, `duration_ms`, `args_provided` |
| `skill_feedback` | `report_usage` called | `skill_path`, `useful`, `comment` |
| `refresh` | `refresh_skills` called | `mode`, `success`, `commit_hash`, `files_changed`, `skills_reindexed` |

### 10.3 Publishing

The `Publisher` operates on a 30-second interval:

```mermaid
sequenceDiagram
    participant PUB as Publisher
    participant TRK as Tracker
    participant EP as HTTP Endpoint
    participant BUF as Local Buffer

    loop Every 30 seconds
        PUB->>TRK: flush()
        TRK-->>PUB: events[]
        PUB->>BUF: readBuffer()
        BUF-->>PUB: buffered[]
        PUB->>EP: POST { events: [...buffered, ...events] }
        alt Success
            EP-->>PUB: 200 OK
            PUB->>BUF: clearBuffer()
        else Failure
            EP-->>PUB: Error / timeout
            PUB->>BUF: appendBuffer(events)
        end
    end
```

**HTTP request format:**
```
POST {analytics.endpoint}
Content-Type: application/json

{
  "events": [
    { "type": "skill_served", "timestamp": "...", "server_id": "...", "data": {...} },
    ...
  ]
}
```

### 10.4 Local fallback

When the HTTP endpoint is unreachable, events are appended to `~/.skills-mcp/analytics-buffer.jsonl` (one JSON object per line). On the next successful HTTP push, the buffer is included in the payload and then cleared.

---

## 11. Configuration

### 11.1 Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SKILLS_DIR` | One of these | — | Local skills directory path |
| `SKILLS_REPO` | must be set | — | Git URL of skills content repo |
| `SKILLS_BRANCH` | No | `main` | Git branch to track |
| `GITHUB_TOKEN` | No | — | Token for private repos |
| `ANALYTICS_ENDPOINT` | No | — | Webhook URL (enables analytics) |
| `REFRESH_INTERVAL_MINUTES` | No | `15` | Periodic refresh interval |

### 11.2 config.yaml schema

```yaml
matching:
  min_score: 0.2              # number (0.0-1.0)
  max_results: 3              # integer
  ambiguity_threshold: 0.1    # number (0.0-1.0)

refresh:
  enabled: true               # boolean
  interval_minutes: 15        # integer

scripts:
  enabled: true               # boolean
  timeout_seconds: 60         # integer
  max_output_bytes: 1048576   # integer (bytes)
  allowed_extensions:          # string[]
    - .sh
    - .ts
    - .js
    - .py
  runners:                     # Record<string, string>
    ".sh": "bash"
    ".ts": "npx tsx"
    ".js": "node"
    ".py": "python3"

assets:
  max_size_bytes: 1048576     # integer (bytes)
  inline_text_max_bytes: 10240 # integer (bytes)

analytics:
  enabled: false              # boolean
  endpoint: ""                # string (URL)
```

### 11.3 Config loading precedence

1. **Default config** — Hardcoded in `src/types/index.ts` (`DEFAULT_CONFIG`).
2. **config.yaml** — Loaded from the skills content root (merged over defaults).
3. **Environment variables** — Override specific settings:
   - `ANALYTICS_ENDPOINT` → `analytics.enabled = true` + `analytics.endpoint`
   - `REFRESH_INTERVAL_MINUTES` → `refresh.enabled = true` + `refresh.interval_minutes`

---

## 12. Security

### 12.1 Path traversal prevention

All file path inputs (assets, scripts) are checked for:
- `../` sequences
- Leading `/` (absolute paths)

Rejected paths produce an error response without accessing the filesystem.

### 12.2 Script execution sandboxing

| Measure | Implementation |
|---------|---------------|
| Declaration required | Script must be listed in frontmatter with `execution: "server"` |
| Extension whitelist | Only `.sh`, `.ts`, `.js`, `.py` (configurable) |
| No shell | `spawn(..., { shell: false })` — no shell interpretation |
| Env var args only | Arguments passed as `SKILL_ARG_*` environment variables, never interpolated in command |
| Timeout | Hard kill after configured seconds (SIGTERM then SIGKILL) |
| Output limits | stdout/stderr truncated at `max_output_bytes` |
| No stdin | stdin set to `ignore` |
| Global kill switch | `scripts.enabled: false` disables all script execution |
| Audit trail | Every execution tracked via analytics |

### 12.3 Asset size limits

- Maximum size per asset: `assets.max_size_bytes` (default 1 MB).
- Checked at read time via `fs.stat()` before reading content.
- Exceeding the limit produces an error response.

### 12.4 Trust model

The security model trusts the content of the Git repository. Scripts are:
- **Versioned** — Every change goes through Git history.
- **Opt-in** — Only scripts explicitly declared with `execution: "server"` are executable.
- **Reviewable** — Standard code review via pull requests is recommended.

---

## 13. Error Handling

| Scenario | Behavior |
|----------|----------|
| Network down at startup | GitSync logs warning, uses local cache |
| Network down at refresh | Logs warning, retries next interval |
| Invalid frontmatter | File skipped with warning, other skills unaffected |
| No skills match query | Returns `no_match` response |
| Asset declared but file missing | Error at read time, skill still functional |
| Asset exceeds size limit | Error response with size details |
| Script `execution: "claude"` via `run_script` | Error with guidance to use `get_asset` |
| Script timeout | Process killed, partial output returned |
| Script missing required args | Error listing all missing arguments |
| Path traversal attempt | Rejected immediately with error |
| Scripts globally disabled | Error response |
| Empty skills directory | Server starts, all queries return `no_match` |
| Concurrent refresh attempts | Second attempt returns `{ success: false }` immediately |
