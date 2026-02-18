import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type {
  AssetMeta,
  AssetType,
  AssetsConfig,
  FrontmatterAsset,
  FrontmatterScript,
  ScriptMeta,
  Skill,
} from "../types/index.js";

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp",
  ".pdf", ".zip", ".woff", ".woff2",
]);

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function isBinaryExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

function hasPathTraversal(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.includes("../") || normalized.startsWith("/");
}

export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

export class AssetResolver {
  constructor(private skillsDir: string) {}

  resolveAssets(
    frontmatterAssets: FrontmatterAsset[],
    resourceDir: string | null,
  ): AssetMeta[] {
    if (!resourceDir || !frontmatterAssets.length) return [];

    const results: AssetMeta[] = [];
    for (const a of frontmatterAssets) {
      if (hasPathTraversal(a.file)) {
        console.error(`[skills-mcp] Path traversal rejected: ${a.file}`);
        continue;
      }
      const absolutePath = path.join(resourceDir, a.file);
      results.push({
        file: a.file,
        absolutePath,
        description: a.description,
        type: (a.type ?? "other") as AssetType,
        isBinary: isBinaryExtension(a.file),
      });
    }
    return results;
  }

  resolveScripts(
    frontmatterScripts: FrontmatterScript[],
    resourceDir: string | null,
  ): ScriptMeta[] {
    if (!resourceDir || !frontmatterScripts.length) return [];

    const results: ScriptMeta[] = [];
    for (const s of frontmatterScripts) {
      if (hasPathTraversal(s.file)) {
        console.error(`[skills-mcp] Path traversal rejected: ${s.file}`);
        continue;
      }
      const absolutePath = path.join(resourceDir, s.file);
      results.push({
        file: s.file,
        absolutePath,
        description: s.description,
        args: (s.args ?? []).map(arg => ({
          name: arg.name,
          description: arg.description ?? "",
          required: arg.required !== false,
          default: arg.default,
        })),
        execution: s.execution ?? "claude",
      });
    }
    return results;
  }

  /** Get all assets for a skill including inherited ones. */
  resolveInheritedAssets(skill: Skill): Array<AssetMeta & { from?: string }> {
    if (!skill.frontmatter.inherit) {
      return skill.assets;
    }

    // Collect from root to leaf, leaf wins on name conflict
    const chain: Skill[] = [];
    let current: Skill | null = skill;
    while (current) {
      chain.unshift(current);
      current = current.parent;
    }

    const byName = new Map<string, AssetMeta & { from?: string }>();
    for (const s of chain) {
      for (const asset of s.assets) {
        const name = path.basename(asset.file);
        byName.set(name, {
          ...asset,
          from: s.path === skill.path ? undefined : s.path,
        });
      }
    }

    return [...byName.values()];
  }

  /** Get all scripts for a skill including inherited ones. */
  resolveInheritedScripts(skill: Skill): Array<ScriptMeta & { from?: string }> {
    if (!skill.frontmatter.inherit) {
      return skill.scripts;
    }

    const chain: Skill[] = [];
    let current: Skill | null = skill;
    while (current) {
      chain.unshift(current);
      current = current.parent;
    }

    const byName = new Map<string, ScriptMeta & { from?: string }>();
    for (const s of chain) {
      for (const script of s.scripts) {
        const name = path.basename(script.file);
        byName.set(name, {
          ...script,
          from: s.path === skill.path ? undefined : s.path,
        });
      }
    }

    return [...byName.values()];
  }

  /** Read a text asset's content. Throws on file > max size. */
  async readAssetContent(
    absolutePath: string,
    maxSizeBytes: number,
  ): Promise<string> {
    const s = await stat(absolutePath);
    if (s.size > maxSizeBytes) {
      throw new Error(`Asset exceeds size limit (${s.size} > ${maxSizeBytes} bytes)`);
    }
    return readFile(absolutePath, "utf-8");
  }

  /** Read a binary asset as base64. Throws on file > max size. */
  async readAssetBase64(
    absolutePath: string,
    maxSizeBytes: number,
  ): Promise<string> {
    const s = await stat(absolutePath);
    if (s.size > maxSizeBytes) {
      throw new Error(`Asset exceeds size limit (${s.size} > ${maxSizeBytes} bytes)`);
    }
    const buf = await readFile(absolutePath);
    return buf.toString("base64");
  }

  /** Find an asset or script by file path in a skill and its parents. */
  findAssetInChain(
    skill: Skill,
    file: string,
  ): { asset: AssetMeta | ScriptMeta; from: string | undefined } | null {
    // Check direct assets and scripts first
    let current: Skill | null = skill;
    while (current) {
      for (const asset of current.assets) {
        if (asset.file === file) {
          return {
            asset,
            from: current.path === skill.path ? undefined : current.path,
          };
        }
      }
      for (const script of current.scripts) {
        if (script.file === file) {
          return {
            asset: script,
            from: current.path === skill.path ? undefined : current.path,
          };
        }
      }
      current = skill.frontmatter.inherit ? current.parent : null;
    }
    return null;
  }
}
