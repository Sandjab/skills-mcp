# skills-mcp

MCP server that exposes a tree of Markdown-based dev skills to Claude Code. Runs locally, syncs content from a private GitHub repo.

## How it works

Skills are Markdown files with YAML frontmatter (keywords, description, inheritance rules). The server indexes them into a searchable tree. When Claude Code calls `get_skill`, the server matches keywords, resolves inheritance, and returns the aggregated content along with any associated assets and scripts.

## MCP tools

| Tool | Description |
|------|-------------|
| `get_skill` | Search skills by context, return best match with content |
| `list_skills` | Browse the skill tree |
| `get_asset` | Retrieve an asset or script file |
| `run_script` | Execute a server-side script |
| `report_usage` | Submit feedback on a skill |
| `refresh_skills` | Force git pull and reindex |

## Setup

```bash
npm install
npm run build
```

### Add to your project's `.mcp.json`

```json
{
  "mcpServers": {
    "skills": {
      "command": "npx",
      "args": ["@monorg/skills-mcp"],
      "env": {
        "SKILLS_REPO": "https://github.com/your-org/skills-content.git",
        "GITHUB_TOKEN": ""
      }
    }
  }
}
```

### Dev mode

```json
{
  "mcpServers": {
    "skills": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "env": {
        "SKILLS_REPO": "https://github.com/your-org/skills-content.git"
      }
    }
  }
}
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SKILLS_REPO` | Yes | Git URL of the skills content repo |
| `SKILLS_BRANCH` | No | Branch to track (default: `main`) |
| `GITHUB_TOKEN` | No | For private repos |
| `ANALYTICS_ENDPOINT` | No | Webhook URL for usage analytics |
| `REFRESH_INTERVAL_MINUTES` | No | Auto-refresh interval (default: `15`) |

## License

ISC
