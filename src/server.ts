import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SkillIndex } from "./core/skill-index.js";
import { SkillResolver } from "./core/skill-resolver.js";
import { AssetResolver } from "./core/asset-resolver.js";
import { registerGetSkill } from "./tools/get-skill.js";
import { registerListSkills } from "./tools/list-skills.js";
import { registerGetAsset } from "./tools/get-asset.js";
import { registerRunScript } from "./tools/run-script.js";
import { registerReportUsage } from "./tools/report-usage.js";
import { registerRefreshSkills } from "./tools/refresh-skills.js";
import type { SkillsConfig } from "./types/index.js";
import { DEFAULT_CONFIG } from "./types/index.js";
import type { GitSync } from "./core/git-sync.js";
import { Tracker } from "./analytics/tracker.js";

export interface CreateServerOptions {
  skillsDir: string;
  config?: Partial<SkillsConfig>;
  gitSync?: GitSync;
}

export async function createServer(options: CreateServerOptions) {
  const config: SkillsConfig = {
    matching: { ...DEFAULT_CONFIG.matching, ...options.config?.matching },
    scripts: { ...DEFAULT_CONFIG.scripts, ...options.config?.scripts },
    assets: { ...DEFAULT_CONFIG.assets, ...options.config?.assets },
    refresh: { ...DEFAULT_CONFIG.refresh, ...options.config?.refresh },
    analytics: { ...DEFAULT_CONFIG.analytics, ...options.config?.analytics },
  };

  const server = new McpServer({
    name: "skills-mcp",
    version: "0.1.0",
  });

  const skillIndex = new SkillIndex(options.skillsDir, config.matching);
  const skillResolver = new SkillResolver();
  const assetResolver = new AssetResolver(options.skillsDir);
  const tracker = new Tracker(config.analytics);

  // Build the initial index
  await skillIndex.buildIndex();
  console.error(`[skills-mcp] Indexed ${skillIndex.getSkillCount()} skills from ${options.skillsDir}`);

  // Wire git sync if available
  if (options.gitSync) {
    options.gitSync.on("content-updated", async () => {
      try {
        await skillIndex.rebuild();
        console.error(`[skills-mcp] Reindexed ${skillIndex.getSkillCount()} skills after git update`);
      } catch (err) {
        console.error("[skills-mcp] Failed to rebuild index:", err);
      }
    });
  }

  // Register tools
  const skillDeps = {
    skillIndex,
    skillResolver,
    assetResolver,
    matchingConfig: config.matching,
    tracker,
  };

  registerGetSkill(server, skillDeps);
  registerListSkills(server, skillIndex);
  registerGetAsset(server, {
    skillIndex,
    assetResolver,
    assetsConfig: config.assets,
    tracker,
  });
  registerRunScript(server, {
    skillIndex,
    assetResolver,
    scriptsConfig: config.scripts,
    tracker,
  });
  registerReportUsage(server, { tracker });
  registerRefreshSkills(server, {
    gitSync: options.gitSync ?? null,
    skillIndex,
    tracker,
  });

  return { server, skillIndex, tracker };
}
