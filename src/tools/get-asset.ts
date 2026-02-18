import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { stat } from "node:fs/promises";
import type { SkillIndex } from "../core/skill-index.js";
import { AssetResolver, getMimeType } from "../core/asset-resolver.js";
import type { AssetsConfig } from "../types/index.js";
import type { Tracker } from "../analytics/tracker.js";

export interface GetAssetDeps {
  skillIndex: SkillIndex;
  assetResolver: AssetResolver;
  assetsConfig: AssetsConfig;
  tracker?: Tracker;
}

export async function handleGetAsset(
  skillPath: string,
  file: string,
  deps: GetAssetDeps,
) {
  const { skillIndex, assetResolver, assetsConfig } = deps;

  const skill = skillIndex.getSkillByPath(skillPath);
  if (!skill) {
    return { error: true, message: `Skill '${skillPath}' not found.` };
  }

  // Check for path traversal
  if (file.includes("../") || file.startsWith("/")) {
    return { error: true, message: `Path traversal is not allowed: '${file}'` };
  }

  // Find the asset in the skill chain
  const found = assetResolver.findAssetInChain(skill, file);
  if (!found) {
    return {
      error: true,
      message: `Asset '${file}' not found for skill '${skillPath}'.`,
    };
  }

  const { asset, from } = found;

  // Check if file exists
  try {
    await stat(asset.absolutePath);
  } catch {
    return {
      error: true,
      message: `Asset file '${file}' declared but not found on filesystem.`,
    };
  }

  const isBinary = "isBinary" in asset ? asset.isBinary : false;

  try {
    if (isBinary) {
      const content = await assetResolver.readAssetBase64(
        asset.absolutePath,
        assetsConfig.max_size_bytes,
      );
      const s = await stat(asset.absolutePath);

      deps.tracker?.track("asset_served", {
        skill_path: skillPath,
        file,
        asset_type: "type" in asset ? asset.type : "other",
        is_inherited: from !== undefined,
        size_bytes: s.size,
      });

      return {
        skill_path: skillPath,
        ...(from ? { resolved_from: from } : {}),
        file,
        content_base64: content,
        size_bytes: s.size,
        type: "type" in asset ? asset.type : "other",
        mime_type: getMimeType(asset.absolutePath),
      };
    } else {
      const content = await assetResolver.readAssetContent(
        asset.absolutePath,
        assetsConfig.max_size_bytes,
      );
      const s = await stat(asset.absolutePath);

      deps.tracker?.track("asset_served", {
        skill_path: skillPath,
        file,
        asset_type: "type" in asset ? asset.type : "other",
        is_inherited: from !== undefined,
        size_bytes: s.size,
      });

      return {
        skill_path: skillPath,
        ...(from ? { resolved_from: from } : {}),
        file,
        content,
        size_bytes: s.size,
        type: "type" in asset ? asset.type : "other",
      };
    }
  } catch (err: any) {
    return {
      error: true,
      message: err.message ?? `Failed to read asset '${file}'.`,
    };
  }
}

export function registerGetAsset(server: McpServer, deps: GetAssetDeps): void {
  server.tool(
    "get_asset",
    "Retrieve the content of an asset or script associated with a skill. " +
    "Use the paths returned by get_skill in the assets, scripts, " +
    "inherited_assets or inherited_scripts fields.",
    {
      skill_path: z.string().describe("Skill path (e.g. 'ui/react/auth')"),
      file: z.string().describe("Relative file path (e.g. 'assets/Template.tsx.template')"),
    },
    async ({ skill_path, file }) => {
      const result = await handleGetAsset(skill_path, file, deps);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
