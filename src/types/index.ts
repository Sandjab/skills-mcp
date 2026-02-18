// ── Frontmatter types ──

export type AssetType = "template" | "config" | "example" | "schema" | "image" | "other";
export type ExecutionMode = "claude" | "server";

export interface ScriptArg {
  name: string;
  description: string;
  required: boolean;
  default?: string;
}

export interface FrontmatterAsset {
  file: string;
  description: string;
  type?: AssetType;
}

export interface FrontmatterScript {
  file: string;
  description: string;
  execution?: ExecutionMode;
  args?: ScriptArg[];
}

export interface Frontmatter {
  keywords: string[];
  description: string;
  inherit: boolean;
  priority: number;
  assets: FrontmatterAsset[];
  scripts: FrontmatterScript[];
}

// ── Parsed skill ──

export interface AssetMeta {
  file: string;
  absolutePath: string;
  description: string;
  type: AssetType;
  isBinary: boolean;
}

export interface ScriptMeta {
  file: string;
  absolutePath: string;
  description: string;
  args: ScriptArg[];
  execution: ExecutionMode;
}

export interface Skill {
  path: string;             // e.g. "ui/react/auth"
  filePath: string;         // e.g. "skills/ui/react/auth.md"
  frontmatter: Frontmatter;
  content: string;          // Markdown body without frontmatter
  parent: Skill | null;
  assets: AssetMeta[];
  scripts: ScriptMeta[];
  resourceDir: string | null; // absolute path to resource dir, null if missing
}

// ── Search / matching ──

export interface MatchScore {
  score: number;
  matchedKeywords: string[];
  contextTokens: string[];
}

export interface SearchResult {
  skill: Skill;
  score: number;
  matchedKeywords: string[];
}

// ── Tree for list_skills ──

export interface SkillNode {
  name: string;
  path: string;
  description: string;
  keywords: string[];
  assetCount: number;
  scriptCount: number;
  children: SkillNode[];
}

// ── Configuration ──

export interface MatchingConfig {
  min_score: number;
  max_results: number;
  ambiguity_threshold: number;
}

export interface ScriptsConfig {
  enabled: boolean;
  timeout_seconds: number;
  max_output_bytes: number;
  allowed_extensions: string[];
  runners: Record<string, string>;
}

export interface AssetsConfig {
  max_size_bytes: number;
  inline_text_max_bytes: number;
}

export interface RefreshConfig {
  enabled: boolean;
  interval_minutes: number;
}

export interface AnalyticsConfig {
  enabled: boolean;
  endpoint?: string;
  file?: string;
}

export interface SkillsConfig {
  matching: MatchingConfig;
  scripts: ScriptsConfig;
  assets: AssetsConfig;
  refresh: RefreshConfig;
  analytics: AnalyticsConfig;
}

// ── Analytics ──

export interface AnalyticsEvent {
  type: string;
  timestamp: string;
  server_id: string;
  data: Record<string, unknown>;
}

// ── Git sync ──

export interface RefreshResult {
  success: boolean;
  commitHash: string;
  filesChanged: number;
  timestamp: Date;
}

// ── Default config ──

export const DEFAULT_CONFIG: SkillsConfig = {
  matching: {
    min_score: 0.2,
    max_results: 3,
    ambiguity_threshold: 0.1,
  },
  scripts: {
    enabled: true,
    timeout_seconds: 60,
    max_output_bytes: 1_048_576,
    allowed_extensions: [".sh", ".ts", ".js", ".py"],
    runners: {
      ".sh": "bash",
      ".ts": "npx tsx",
      ".js": "node",
      ".py": "python3",
    },
  },
  assets: {
    max_size_bytes: 1_048_576,
    inline_text_max_bytes: 10_240,
  },
  refresh: {
    enabled: true,
    interval_minutes: 15,
  },
  analytics: {
    enabled: false,
  },
};
