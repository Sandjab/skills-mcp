import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import { SkillIndex } from "../../src/core/skill-index.js";
import { AssetResolver } from "../../src/core/asset-resolver.js";
import { handleRunScript } from "../../src/tools/run-script.js";
import type { MatchingConfig, ScriptsConfig } from "../../src/types/index.js";

const TEST_SKILLS_DIR = path.resolve("test-skills");

const matchingConfig: MatchingConfig = {
  min_score: 0.2,
  max_results: 3,
  ambiguity_threshold: 0.1,
};

const scriptsConfig: ScriptsConfig = {
  enabled: true,
  timeout_seconds: 10,
  max_output_bytes: 1_048_576,
  allowed_extensions: [".sh", ".ts", ".js", ".py"],
  runners: {
    ".sh": "bash",
    ".ts": "npx tsx",
    ".js": "node",
    ".py": "python3",
  },
};

describe("run_script handler", () => {
  let skillIndex: SkillIndex;
  let assetResolver: AssetResolver;

  beforeAll(async () => {
    skillIndex = new SkillIndex(TEST_SKILLS_DIR, matchingConfig);
    assetResolver = new AssetResolver(TEST_SKILLS_DIR);
    await skillIndex.buildIndex();
  });

  const deps = () => ({ skillIndex, assetResolver, scriptsConfig });

  it("refuses scripts with execution: claude", async () => {
    const result = await handleRunScript(
      "ui/react/auth",
      "scripts/scaffold-auth.sh",
      { project_dir: "/tmp" },
      undefined,
      deps(),
    );
    expect(result).toHaveProperty("error", true);
    expect((result as any).message).toContain("execution: 'claude'");
  });

  it("returns error for non-existent skill", async () => {
    const result = await handleRunScript(
      "nonexistent",
      "scripts/foo.sh",
      {},
      undefined,
      deps(),
    );
    expect(result).toHaveProperty("error", true);
    expect((result as any).message).toContain("not found");
  });

  it("returns error for undeclared script", async () => {
    const result = await handleRunScript(
      "ui/react/auth",
      "scripts/nonexistent.sh",
      {},
      undefined,
      deps(),
    );
    expect(result).toHaveProperty("error", true);
    expect((result as any).message).toContain("not found");
  });

  it("validates required args", async () => {
    const result = await handleRunScript(
      "ui/react/auth",
      "scripts/validate-auth-config.ts",
      {}, // missing config_path
      undefined,
      deps(),
    );
    expect(result).toHaveProperty("error", true);
    expect((result as any).message).toContain("Missing required");
    expect((result as any).message).toContain("config_path");
  });

  it("rejects path traversal", async () => {
    const result = await handleRunScript(
      "ui/react/auth",
      "../../../evil.sh",
      {},
      undefined,
      deps(),
    );
    expect(result).toHaveProperty("error", true);
    expect((result as any).message).toContain("traversal");
  });

  it("refuses when scripts are globally disabled", async () => {
    const disabledDeps = {
      ...deps(),
      scriptsConfig: { ...scriptsConfig, enabled: false },
    };
    const result = await handleRunScript(
      "ui/react/auth",
      "scripts/validate-auth-config.ts",
      { config_path: "/tmp/config.ts" },
      undefined,
      disabledDeps,
    );
    expect(result).toHaveProperty("error", true);
    expect((result as any).message).toContain("disabled");
  });
});
