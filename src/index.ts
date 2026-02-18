#!/usr/bin/env node

import path from "node:path";
import os from "node:os";
import { readFile } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import YAML from "yaml";
import { createServer } from "./server.js";
import { GitSync } from "./core/git-sync.js";
import type { SkillsConfig } from "./types/index.js";
import { DEFAULT_CONFIG } from "./types/index.js";

async function main() {
  const skillsRepo = process.env.SKILLS_REPO;
  const skillsBranch = process.env.SKILLS_BRANCH ?? "main";
  const skillsDir = process.env.SKILLS_DIR; // For local dev/testing
  const githubToken = process.env.GITHUB_TOKEN;
  const analyticsEndpoint = process.env.ANALYTICS_ENDPOINT;
  const refreshInterval = process.env.REFRESH_INTERVAL_MINUTES
    ? parseInt(process.env.REFRESH_INTERVAL_MINUTES, 10)
    : undefined;

  let resolvedSkillsDir: string;
  let gitSync: GitSync | undefined;
  let config: Partial<SkillsConfig> = {};

  if (skillsDir) {
    // Local mode: use the provided directory directly
    resolvedSkillsDir = path.resolve(skillsDir);
    console.error(`[skills-mcp] Using local skills directory: ${resolvedSkillsDir}`);

    // Try to load config.yaml from the skills dir parent (content root)
    config = await loadConfig(resolvedSkillsDir);
  } else if (skillsRepo) {
    // Git mode: clone/pull the repo
    const localPath = path.join(os.homedir(), ".skills-mcp", "content");
    gitSync = new GitSync(skillsRepo, skillsBranch, localPath, githubToken ?? undefined);

    try {
      await gitSync.initialize();
      console.error("[skills-mcp] Git sync initialized");
    } catch (err) {
      console.error("[skills-mcp] Git sync failed, using local cache:", err);
    }

    resolvedSkillsDir = path.join(localPath, "skills");

    // Load config from repo root
    config = await loadConfig(resolvedSkillsDir);
  } else {
    console.error("[skills-mcp] Neither SKILLS_DIR nor SKILLS_REPO provided.");
    console.error("[skills-mcp] Set SKILLS_DIR for local dev or SKILLS_REPO for git sync.");
    process.exit(1);
  }

  // Override config with env vars
  if (analyticsEndpoint) {
    config.analytics = { ...config.analytics, enabled: true, endpoint: analyticsEndpoint };
  }
  if (refreshInterval !== undefined) {
    config.refresh = { ...config.refresh, enabled: true, interval_minutes: refreshInterval };
  }

  const { server, tracker } = await createServer({
    skillsDir: resolvedSkillsDir,
    config,
    gitSync,
  });

  // Start periodic refresh
  if (gitSync && (config.refresh?.enabled ?? DEFAULT_CONFIG.refresh.enabled)) {
    const interval = (config.refresh?.interval_minutes ?? DEFAULT_CONFIG.refresh.interval_minutes) * 60_000;
    gitSync.startPeriodicRefresh(interval);
    console.error(`[skills-mcp] Periodic refresh every ${interval / 60_000} minutes`);
  }

  // Connect MCP transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[skills-mcp] Server started on stdio transport");
}

async function loadConfig(skillsDir: string): Promise<Partial<SkillsConfig>> {
  // config.yaml is at the content root, skillsDir points to the skills/ subfolder
  // Try both: parent of skillsDir (content root) and skillsDir itself
  const candidates = [
    path.join(skillsDir, "..", "config.yaml"),
    path.join(skillsDir, "config.yaml"),
  ];

  for (const configPath of candidates) {
    try {
      const raw = await readFile(configPath, "utf-8");
      const parsed = YAML.parse(raw);
      if (parsed && typeof parsed === "object") {
        console.error(`[skills-mcp] Loaded config from ${configPath}`);
        return parsed as Partial<SkillsConfig>;
      }
    } catch {
      // Not found, try next
    }
  }

  return {};
}

main().catch(err => {
  console.error("[skills-mcp] Fatal:", err);
  process.exit(1);
});
