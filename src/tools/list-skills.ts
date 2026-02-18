import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SkillIndex } from "../core/skill-index.js";

export function registerListSkills(server: McpServer, skillIndex: SkillIndex): void {
  server.tool(
    "list_skills",
    "List the full tree of available skills with descriptions and keywords. " +
    "Useful for discovering existing skills.",
    { path: z.string().optional().describe("Optional sub-tree path to filter (e.g. 'ui')") },
    async ({ path: filterPath }) => {
      const tree = skillIndex.getTree(filterPath);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ tree }, null, 2) }],
      };
    },
  );
}
