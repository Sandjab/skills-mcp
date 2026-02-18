import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type {
  AssetMeta,
  Frontmatter,
  FrontmatterAsset,
  FrontmatterScript,
  MatchingConfig,
  ScriptMeta,
  SearchResult,
  Skill,
  SkillNode,
} from "../types/index.js";
import { KeywordMatcher } from "./keyword-matcher.js";
import { AssetResolver } from "./asset-resolver.js";

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

function parseFrontmatter(raw: Record<string, unknown>): Frontmatter | null {
  const keywords = raw.keywords;
  const description = raw.description;
  if (
    !Array.isArray(keywords) ||
    keywords.length === 0 ||
    typeof description !== "string" ||
    description.length === 0
  ) {
    return null;
  }

  const assets: FrontmatterAsset[] = [];
  if (Array.isArray(raw.assets)) {
    for (const a of raw.assets) {
      if (a && typeof a === "object" && typeof (a as any).file === "string") {
        assets.push({
          file: (a as any).file,
          description: (a as any).description ?? "",
          type: (a as any).type ?? "other",
        });
      }
    }
  }

  const scripts: FrontmatterScript[] = [];
  if (Array.isArray(raw.scripts)) {
    for (const s of raw.scripts) {
      if (s && typeof s === "object" && typeof (s as any).file === "string") {
        scripts.push({
          file: (s as any).file,
          description: (s as any).description ?? "",
          execution: (s as any).execution ?? "claude",
          args: Array.isArray((s as any).args) ? (s as any).args : [],
        });
      }
    }
  }

  return {
    keywords: keywords.map(String),
    description: String(description),
    inherit: raw.inherit !== false,
    priority: typeof raw.priority === "number" ? raw.priority : 0,
    assets,
    scripts,
  };
}

/** Derive skill path from file path relative to skills dir. */
function filePathToSkillPath(relPath: string): string {
  // relPath is like "ui/react/auth.md" or "_root.md" or "ui/_index.md"
  let p = normalizePath(relPath);
  // Remove .md extension
  p = p.replace(/\.md$/, "");
  // _root → _root
  // _index → directory name
  // For _index at top level: skills/_index.md → "_index" (shouldn't exist, but handle it)
  return p;
}

/** Derive parent skill path from a skill path. */
function deriveParentPath(skillPath: string): string | null {
  // _root has no parent
  if (skillPath === "_root") return null;

  const parts = skillPath.split("/");
  const last = parts[parts.length - 1];
  const dirParts = parts.slice(0, -1);

  if (last === "_index") {
    // _index's parent is _index of parent dir, or _root
    if (dirParts.length === 0) {
      return "_root";
    }
    return [...dirParts.slice(0, -1), "_index"].join("/") || "_root";
  }

  // Regular skill's parent is _index in the same directory
  if (dirParts.length === 0) {
    return "_root";
  }
  return [...dirParts, "_index"].join("/");
}

export class SkillIndex {
  private skills: Map<string, Skill> = new Map();
  private matcher: KeywordMatcher;
  private assetResolver: AssetResolver;

  constructor(
    private skillsDir: string,
    private matchingConfig: MatchingConfig,
  ) {
    this.matcher = new KeywordMatcher(matchingConfig);
    this.assetResolver = new AssetResolver(skillsDir);
  }

  async buildIndex(): Promise<void> {
    const newSkills = new Map<string, Skill>();

    // Pass 1: parse all .md files
    const mdFiles = await this.findMdFiles(this.skillsDir);
    for (const absPath of mdFiles) {
      const relPath = normalizePath(path.relative(this.skillsDir, absPath));
      try {
        const raw = await readFile(absPath, "utf-8");
        const { data, content } = matter(raw);
        const frontmatter = parseFrontmatter(data);
        if (!frontmatter) {
          console.error(`[skills-mcp] Skipping ${relPath}: invalid frontmatter (keywords + description required)`);
          continue;
        }

        const skillPath = filePathToSkillPath(relPath);
        const resourceDirName = skillPath.split("/").pop()!;
        const skillDir = path.dirname(absPath);
        const resourceDirAbs = path.join(skillDir, resourceDirName);
        let resourceDir: string | null = null;
        try {
          const s = await stat(resourceDirAbs);
          if (s.isDirectory()) {
            resourceDir = resourceDirAbs;
          }
        } catch {
          // No resource directory
        }

        const assets = this.assetResolver.resolveAssets(frontmatter.assets, resourceDir);
        const scripts = this.assetResolver.resolveScripts(frontmatter.scripts, resourceDir);

        const skill: Skill = {
          path: skillPath,
          filePath: relPath,
          frontmatter,
          content: content.trim(),
          parent: null, // resolved in pass 2
          assets,
          scripts,
          resourceDir,
        };

        newSkills.set(skillPath, skill);
      } catch (err) {
        console.error(`[skills-mcp] Error parsing ${relPath}:`, err);
      }
    }

    // Pass 2: resolve parents
    for (const [skillPath, skill] of newSkills) {
      let parentPath = deriveParentPath(skillPath);

      // Walk up until we find an existing parent or reach null
      while (parentPath !== null) {
        const parent = newSkills.get(parentPath);
        if (parent) {
          skill.parent = parent;
          break;
        }
        // Parent doesn't exist, try its parent
        parentPath = deriveParentPath(parentPath);
      }
    }

    // Atomic swap
    this.skills = newSkills;
  }

  async rebuild(): Promise<void> {
    await this.buildIndex();
  }

  search(context: string): SearchResult[] {
    const results: SearchResult[] = [];

    for (const skill of this.skills.values()) {
      const matchScore = this.matcher.score(context, skill.frontmatter);
      if (this.matcher.isAboveMinScore(matchScore)) {
        results.push({
          skill,
          score: matchScore.score,
          matchedKeywords: matchScore.matchedKeywords,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);

    return results.slice(0, this.matchingConfig.max_results * 2); // return more than needed for ambiguity detection
  }

  getSkillByPath(skillPath: string): Skill | null {
    return this.skills.get(skillPath) ?? null;
  }

  getTree(filterPath?: string): SkillNode {
    // Build a tree from all skills
    const root: SkillNode = {
      name: "root",
      path: "_root",
      description: "",
      keywords: [],
      assetCount: 0,
      scriptCount: 0,
      children: [],
    };

    const rootSkill = this.skills.get("_root");
    if (rootSkill) {
      root.description = rootSkill.frontmatter.description;
      root.keywords = rootSkill.frontmatter.keywords;
      root.assetCount = rootSkill.assets.length;
      root.scriptCount = rootSkill.scripts.length;
    }

    // Group skills by their directory path for tree building
    const nodeMap = new Map<string, SkillNode>();
    nodeMap.set("_root", root);

    // Sort skill paths so parents are processed before children
    const sortedPaths = [...this.skills.keys()]
      .filter(p => p !== "_root")
      .sort();

    for (const skillPath of sortedPaths) {
      const skill = this.skills.get(skillPath)!;
      const parts = skillPath.split("/");
      const name = parts[parts.length - 1] === "_index"
        ? parts[parts.length - 2] ?? "index"
        : parts[parts.length - 1];

      const node: SkillNode = {
        name,
        path: skillPath,
        description: skill.frontmatter.description,
        keywords: skill.frontmatter.keywords,
        assetCount: skill.assets.length,
        scriptCount: skill.scripts.length,
        children: [],
      };
      nodeMap.set(skillPath, node);

      // Find parent node
      const parentPath = deriveParentPath(skillPath);
      if (parentPath && nodeMap.has(parentPath)) {
        nodeMap.get(parentPath)!.children.push(node);
      } else {
        // Attach to root if parent not found
        root.children.push(node);
      }
    }

    // Filter if path provided
    if (filterPath) {
      const filterNode = nodeMap.get(filterPath) ??
        nodeMap.get(filterPath + "/_index");
      if (filterNode) {
        return filterNode;
      }
    }

    return root;
  }

  getSkillCount(): number {
    return this.skills.size;
  }

  private async findMdFiles(dir: string): Promise<string[]> {
    const results: string[] = [];
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const sub = await this.findMdFiles(fullPath);
          results.push(...sub);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          results.push(fullPath);
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
    return results;
  }
}
