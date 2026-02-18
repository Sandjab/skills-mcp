import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GitSync } from "../core/git-sync.js";
import type { SkillIndex } from "../core/skill-index.js";
import type { Tracker } from "../analytics/tracker.js";

export interface RefreshSkillsDeps {
  gitSync: GitSync | null;
  skillIndex: SkillIndex;
  tracker?: Tracker;
}

export async function handleRefreshSkills(deps: RefreshSkillsDeps) {
  if (!deps.gitSync) {
    // No git sync — just rebuild the index from local files
    await deps.skillIndex.rebuild();
    const count = deps.skillIndex.getSkillCount();

    deps.tracker?.track("refresh", { mode: "local", skills_reindexed: count });

    return {
      success: true,
      mode: "local",
      skills_reindexed: count,
      message: "Reindexed from local directory (no git sync configured).",
    };
  }

  const result = await deps.gitSync.forceRefresh();
  // Rebuild is triggered by content-updated event, but also do it explicitly
  await deps.skillIndex.rebuild();
  const count = deps.skillIndex.getSkillCount();

  deps.tracker?.track("refresh", {
    mode: "git",
    success: result.success,
    commit_hash: result.commitHash,
    files_changed: result.filesChanged,
    skills_reindexed: count,
  });

  return {
    success: result.success,
    commit_hash: result.commitHash,
    files_changed: result.filesChanged,
    skills_reindexed: count,
    last_sync: result.timestamp.toISOString(),
  };
}

export function registerRefreshSkills(server: McpServer, deps: RefreshSkillsDeps): void {
  server.tool(
    "refresh_skills",
    "Force an immediate sync of skill content from the Git repo. " +
    "Useful after modifying a skill on GitHub.",
    {},
    async () => {
      const result = await handleRefreshSkills(deps);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
