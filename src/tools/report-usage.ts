import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Tracker } from "../analytics/tracker.js";

export interface ReportUsageDeps {
  tracker?: Tracker;
}

export function handleReportUsage(
  skillPath: string,
  useful: boolean,
  comment: string | undefined,
  deps: ReportUsageDeps,
) {
  console.error(
    `[skills-mcp] Feedback for ${skillPath}: useful=${useful}${comment ? ` comment="${comment}"` : ""}`,
  );

  deps.tracker?.track("skill_feedback", {
    skill_path: skillPath,
    useful,
    comment,
  });

  return {
    recorded: true,
    message: `Feedback recorded for ${skillPath}`,
  };
}

export function registerReportUsage(server: McpServer, deps: ReportUsageDeps): void {
  server.tool(
    "report_usage",
    "Report whether a skill was useful or not. " +
    "Call this after using a skill to provide feedback.",
    {
      skill_path: z.string().describe("Skill path to evaluate"),
      useful: z.boolean().describe("Was the skill relevant?"),
      comment: z.string().optional().describe("Details about what was missing or superfluous"),
    },
    async ({ skill_path, useful, comment }) => {
      const result = handleReportUsage(skill_path, useful, comment, deps);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
