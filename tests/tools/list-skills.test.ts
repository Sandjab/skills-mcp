import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import { SkillIndex } from "../../src/core/skill-index.js";
import type { MatchingConfig } from "../../src/types/index.js";

const TEST_SKILLS_DIR = path.resolve("test-skills");

const matchingConfig: MatchingConfig = {
  min_score: 0.2,
  max_results: 3,
  ambiguity_threshold: 0.1,
};

describe("list_skills (via SkillIndex.getTree)", () => {
  let skillIndex: SkillIndex;

  beforeAll(async () => {
    skillIndex = new SkillIndex(TEST_SKILLS_DIR, matchingConfig);
    await skillIndex.buildIndex();
  });

  it("returns the full skill tree", () => {
    const tree = skillIndex.getTree();
    expect(tree.name).toBe("root");
    expect(tree.children.length).toBeGreaterThan(0);
  });

  it("contains expected skills", () => {
    const tree = skillIndex.getTree();
    const names = flattenNames(tree);
    expect(names).toContain("ui");
    expect(names).toContain("react");
    expect(names).toContain("auth");
    expect(names).toContain("api");
  });

  it("includes asset and script counts", () => {
    const tree = skillIndex.getTree();
    // Find the react auth node somewhere in the tree
    const authNode = findNode(tree, "ui/react/auth");
    expect(authNode).toBeDefined();
    if (authNode) {
      expect(authNode.assetCount).toBeGreaterThan(0);
      expect(authNode.scriptCount).toBeGreaterThan(0);
    }
  });

  it("filters by path", () => {
    const filtered = skillIndex.getTree("api/_index");
    expect(filtered.path).toBe("api/_index");
  });
});

function flattenNames(node: { name: string; children: any[] }): string[] {
  return [node.name, ...node.children.flatMap(c => flattenNames(c))];
}

function findNode(
  node: { path: string; children: any[] },
  targetPath: string,
): any | undefined {
  if (node.path === targetPath) return node;
  for (const child of node.children) {
    const found = findNode(child, targetPath);
    if (found) return found;
  }
  return undefined;
}
