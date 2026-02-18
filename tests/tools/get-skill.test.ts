import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import { SkillIndex } from "../../src/core/skill-index.js";
import { SkillResolver } from "../../src/core/skill-resolver.js";
import { AssetResolver } from "../../src/core/asset-resolver.js";
import { handleGetSkill } from "../../src/tools/get-skill.js";
import type { MatchingConfig } from "../../src/types/index.js";

const TEST_SKILLS_DIR = path.resolve("test-skills");

const matchingConfig: MatchingConfig = {
  min_score: 0.2,
  max_results: 3,
  ambiguity_threshold: 0.1,
};

describe("get_skill handler", () => {
  let skillIndex: SkillIndex;
  let skillResolver: SkillResolver;
  let assetResolver: AssetResolver;

  beforeAll(async () => {
    skillIndex = new SkillIndex(TEST_SKILLS_DIR, matchingConfig);
    skillResolver = new SkillResolver();
    assetResolver = new AssetResolver(TEST_SKILLS_DIR);
    await skillIndex.buildIndex();
  });

  const deps = () => ({
    skillIndex,
    skillResolver,
    assetResolver,
    matchingConfig,
  });

  it("returns a unique match for specific query", () => {
    const result = handleGetSkill("react auth component", deps());
    expect(result).toHaveProperty("skill_path", "ui/react/auth");
    expect(result).toHaveProperty("content");
    expect(result).toHaveProperty("assets");
    expect(result).toHaveProperty("scripts");
  });

  it("returns ambiguity for generic 'auth' query", () => {
    const result = handleGetSkill("auth", deps());
    // Should be ambiguous between ui/react/auth and api/auth
    expect(result).toHaveProperty("ambiguous", true);
    expect((result as any).candidates.length).toBeGreaterThanOrEqual(2);
    const paths = (result as any).candidates.map((c: any) => c.skill_path);
    expect(paths).toContain("ui/react/auth");
    expect(paths).toContain("api/auth");
  });

  it("returns no_match for unrelated query", () => {
    const result = handleGetSkill("kubernetes deployment helm", deps());
    expect(result).toHaveProperty("no_match", true);
  });

  it("includes inherited content when inherit is true", () => {
    const result = handleGetSkill("react auth component login", deps());
    if ("content" in result) {
      expect(result.content).toContain("Global Rules"); // from _root
      expect(result.content).toContain("React Auth Components"); // from auth.md
    }
  });

  it("lists assets and scripts for matched skill", () => {
    const result = handleGetSkill("react auth component login", deps());
    if ("assets" in result) {
      expect(result.assets!.length).toBeGreaterThan(0);
      expect(result.scripts!.length).toBeGreaterThan(0);
      const serverScript = result.scripts!.find(
        (s: any) => s.execution === "server",
      );
      expect(serverScript).toBeDefined();
    }
  });

  it("matches react testing skill", () => {
    const result = handleGetSkill("react testing vitest", deps());
    expect(result).toHaveProperty("skill_path", "ui/react/testing");
  });
});
