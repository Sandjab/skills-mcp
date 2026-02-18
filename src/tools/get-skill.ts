import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AssetResolver } from "../core/asset-resolver.js";
import type { SkillIndex } from "../core/skill-index.js";
import { SkillResolver } from "../core/skill-resolver.js";
import type { MatchingConfig, Skill } from "../types/index.js";
import type { Tracker } from "../analytics/tracker.js";

export interface GetSkillDeps {
  skillIndex: SkillIndex;
  skillResolver: SkillResolver;
  assetResolver: AssetResolver;
  matchingConfig: MatchingConfig;
  tracker?: Tracker;
}

function serializeSkill(skill: Skill) {
  return {
    path: skill.path,
    description: skill.frontmatter.description,
    keywords: skill.frontmatter.keywords,
  };
}

export function handleGetSkill(context: string, deps: GetSkillDeps) {
  const { skillIndex, skillResolver, assetResolver, matchingConfig } = deps;

  const results = skillIndex.search(context);

  if (results.length === 0) {
    const result = {
      no_match: true,
      message: "No skill matches the given context.",
    };
    deps.tracker?.track("no_match", { context });
    return result;
  }

  // Check for ambiguity
  if (
    results.length >= 2 &&
    results[0].score - results[1].score < matchingConfig.ambiguity_threshold
  ) {
    const candidates = results.slice(0, matchingConfig.max_results).map(r => ({
      skill_path: r.skill.path,
      score: Math.round(r.score * 1000) / 1000,
      description: r.skill.frontmatter.description,
      matched_keywords: r.matchedKeywords,
    }));

    deps.tracker?.track("ambiguous", { context, candidates: candidates.map(c => c.skill_path) });

    return {
      ambiguous: true,
      candidates,
      message: "Multiple skills match. Specify your need or pick a skill_path.",
    };
  }

  // Single best match
  const best = results[0];
  const resolvedContent = skillResolver.resolve(best.skill);

  // Get own assets/scripts
  const ownAssets = best.skill.assets.map(a => ({
    file: a.file,
    description: a.description,
    type: a.type,
  }));
  const ownScripts = best.skill.scripts.map(s => ({
    file: s.file,
    description: s.description,
    execution: s.execution,
    args: s.args,
  }));

  // Get inherited assets/scripts (excluding own)
  const allAssets = assetResolver.resolveInheritedAssets(best.skill);
  const inheritedAssets = allAssets
    .filter(a => a.from !== undefined)
    .map(a => ({
      file: a.file,
      description: a.description,
      type: a.type,
      from: a.from,
    }));

  const allScripts = assetResolver.resolveInheritedScripts(best.skill);
  const inheritedScripts = allScripts
    .filter(s => s.from !== undefined)
    .map(s => ({
      file: s.file,
      description: s.description,
      execution: s.execution,
      args: (s as any).args,
      from: s.from,
    }));

  deps.tracker?.track("skill_served", {
    context,
    skill_path: best.skill.path,
    score: best.score,
    matched_keywords: best.matchedKeywords,
    was_ambiguous: false,
  });

  return {
    skill_path: best.skill.path,
    score: Math.round(best.score * 1000) / 1000,
    matched_keywords: best.matchedKeywords,
    content: resolvedContent,
    assets: ownAssets,
    scripts: ownScripts,
    inherited_assets: inheritedAssets,
    inherited_scripts: inheritedScripts,
  };
}

export function registerGetSkill(server: McpServer, deps: GetSkillDeps): void {
  server.tool(
    "get_skill",
    "Search and return the most relevant skill for the given context. " +
    "Describe your task with a few keywords. If multiple skills match, " +
    "candidates are listed with descriptions so you can choose.",
    { context: z.string().describe("Description of the task (keywords)") },
    async ({ context }) => {
      const result = handleGetSkill(context, deps);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
