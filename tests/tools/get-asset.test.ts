import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import { SkillIndex } from "../../src/core/skill-index.js";
import { AssetResolver } from "../../src/core/asset-resolver.js";
import { handleGetAsset } from "../../src/tools/get-asset.js";
import type { MatchingConfig, AssetsConfig } from "../../src/types/index.js";

const TEST_SKILLS_DIR = path.resolve("test-skills");

const matchingConfig: MatchingConfig = {
  min_score: 0.2,
  max_results: 3,
  ambiguity_threshold: 0.1,
};

const assetsConfig: AssetsConfig = {
  max_size_bytes: 1_048_576,
  inline_text_max_bytes: 10_240,
};

describe("get_asset handler", () => {
  let skillIndex: SkillIndex;
  let assetResolver: AssetResolver;

  beforeAll(async () => {
    skillIndex = new SkillIndex(TEST_SKILLS_DIR, matchingConfig);
    assetResolver = new AssetResolver(TEST_SKILLS_DIR);
    await skillIndex.buildIndex();
  });

  const deps = () => ({ skillIndex, assetResolver, assetsConfig });

  it("returns text asset content", async () => {
    const result = await handleGetAsset(
      "ui/react/auth",
      "assets/AuthProvider.tsx.template",
      deps(),
    );
    expect(result).toHaveProperty("content");
    expect((result as any).content).toContain("AuthProvider");
    expect(result).not.toHaveProperty("error");
  });

  it("returns error for non-existent skill", async () => {
    const result = await handleGetAsset("nonexistent", "assets/foo.ts", deps());
    expect(result).toHaveProperty("error", true);
    expect((result as any).message).toContain("not found");
  });

  it("returns error for non-existent asset", async () => {
    const result = await handleGetAsset(
      "ui/react/auth",
      "assets/nonexistent.ts",
      deps(),
    );
    expect(result).toHaveProperty("error", true);
  });

  it("rejects path traversal", async () => {
    const result = await handleGetAsset(
      "ui/react/auth",
      "../../../etc/passwd",
      deps(),
    );
    expect(result).toHaveProperty("error", true);
    expect((result as any).message).toContain("traversal");
  });

  it("resolves inherited asset from parent", async () => {
    const result = await handleGetAsset(
      "ui/react/auth",
      "assets/component-base.tsx.template",
      deps(),
    );
    // This asset is on the parent _index, should resolve via inheritance
    if ("resolved_from" in result) {
      expect((result as any).resolved_from).toBe("ui/react/_index");
    }
  });
});
