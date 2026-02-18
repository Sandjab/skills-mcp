import { describe, it, expect } from "vitest";
import { SkillResolver } from "../src/core/skill-resolver.js";
import type { Skill, Frontmatter } from "../src/types/index.js";

function makeSkill(overrides: Partial<Skill> & { path: string; content: string }): Skill {
  return {
    filePath: overrides.path + ".md",
    frontmatter: {
      keywords: [],
      description: "",
      inherit: true,
      priority: 0,
      assets: [],
      scripts: [],
      ...overrides.frontmatter,
    } as Frontmatter,
    parent: null,
    assets: [],
    scripts: [],
    resourceDir: null,
    ...overrides,
  };
}

describe("SkillResolver", () => {
  const resolver = new SkillResolver();

  it("returns content only when inherit is false", () => {
    const skill = makeSkill({
      path: "standalone",
      content: "Standalone content",
      frontmatter: {
        keywords: [],
        description: "",
        inherit: false,
        priority: 0,
        assets: [],
        scripts: [],
      },
    });

    const result = resolver.resolve(skill);
    expect(result).toBe("Standalone content");
  });

  it("concatenates parent chain when inherit is true", () => {
    const root = makeSkill({
      path: "_root",
      content: "Root rules",
    });

    const uiIndex = makeSkill({
      path: "ui/_index",
      content: "UI rules",
      parent: root,
    });

    const reactAuth = makeSkill({
      path: "ui/react/auth",
      content: "Auth rules",
      parent: uiIndex,
    });

    const result = resolver.resolve(reactAuth);
    expect(result).toContain("Root rules");
    expect(result).toContain("UI rules");
    expect(result).toContain("Auth rules");
  });

  it("orders from most general to most specific", () => {
    const root = makeSkill({ path: "_root", content: "ROOT" });
    const parent = makeSkill({ path: "ui/_index", content: "PARENT", parent: root });
    const child = makeSkill({ path: "ui/react/auth", content: "CHILD", parent: parent });

    const result = resolver.resolve(child);
    const rootIdx = result.indexOf("ROOT");
    const parentIdx = result.indexOf("PARENT");
    const childIdx = result.indexOf("CHILD");
    expect(rootIdx).toBeLessThan(parentIdx);
    expect(parentIdx).toBeLessThan(childIdx);
  });

  it("includes section headers with skill paths", () => {
    const root = makeSkill({ path: "_root", content: "Root content" });
    const child = makeSkill({ path: "ui/auth", content: "Auth content", parent: root });

    const result = resolver.resolve(child);
    expect(result).toContain("=== GLOBAL RULES (from _root.md) ===");
    expect(result).toContain("=== UI > AUTH (from ui/auth.md) ===");
  });
});
