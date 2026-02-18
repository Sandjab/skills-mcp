import { describe, it, expect } from "vitest";
import path from "node:path";
import { AssetResolver, getMimeType } from "../src/core/asset-resolver.js";
import type { Skill, FrontmatterAsset, FrontmatterScript } from "../src/types/index.js";

const TEST_SKILLS_DIR = path.resolve("test-skills");

function makeSkill(overrides: Partial<Skill>): Skill {
  return {
    path: "test",
    filePath: "test.md",
    frontmatter: {
      keywords: [],
      description: "",
      inherit: true,
      priority: 0,
      assets: [],
      scripts: [],
    },
    content: "",
    parent: null,
    assets: [],
    scripts: [],
    resourceDir: null,
    ...overrides,
  };
}

describe("AssetResolver", () => {
  const resolver = new AssetResolver(TEST_SKILLS_DIR);

  describe("resolveAssets", () => {
    it("resolves asset paths from frontmatter", () => {
      const resourceDir = path.join(TEST_SKILLS_DIR, "ui", "react", "auth");
      const frontmatterAssets: FrontmatterAsset[] = [
        { file: "assets/AuthProvider.tsx.template", description: "Auth template", type: "template" },
      ];
      const assets = resolver.resolveAssets(frontmatterAssets, resourceDir);
      expect(assets).toHaveLength(1);
      expect(assets[0].file).toBe("assets/AuthProvider.tsx.template");
      expect(assets[0].isBinary).toBe(false);
      expect(assets[0].type).toBe("template");
    });

    it("returns empty for null resourceDir", () => {
      const assets = resolver.resolveAssets([{ file: "x", description: "x" }], null);
      expect(assets).toHaveLength(0);
    });

    it("rejects path traversal", () => {
      const resourceDir = path.join(TEST_SKILLS_DIR, "ui", "react", "auth");
      const assets = resolver.resolveAssets(
        [{ file: "../../../etc/passwd", description: "hack" }],
        resourceDir,
      );
      expect(assets).toHaveLength(0);
    });
  });

  describe("resolveScripts", () => {
    it("resolves script paths from frontmatter", () => {
      const resourceDir = path.join(TEST_SKILLS_DIR, "ui", "react", "auth");
      const frontmatterScripts: FrontmatterScript[] = [
        {
          file: "scripts/validate-auth-config.ts",
          description: "Validate config",
          execution: "server",
          args: [{ name: "config_path", description: "Config path", required: true }],
        },
      ];
      const scripts = resolver.resolveScripts(frontmatterScripts, resourceDir);
      expect(scripts).toHaveLength(1);
      expect(scripts[0].execution).toBe("server");
      expect(scripts[0].args).toHaveLength(1);
      expect(scripts[0].args[0].required).toBe(true);
    });
  });

  describe("binary detection", () => {
    it("detects binary extensions", () => {
      const resourceDir = "/fake";
      const assets = resolver.resolveAssets(
        [
          { file: "assets/image.png", description: "Image" },
          { file: "assets/doc.pdf", description: "PDF" },
          { file: "assets/font.woff2", description: "Font" },
        ],
        resourceDir,
      );
      expect(assets.every(a => a.isBinary)).toBe(true);
    });

    it("detects text extensions", () => {
      const resourceDir = "/fake";
      const assets = resolver.resolveAssets(
        [
          { file: "assets/template.tsx.template", description: "Template" },
          { file: "assets/config.json", description: "Config" },
          { file: "assets/script.sh", description: "Script" },
        ],
        resourceDir,
      );
      expect(assets.every(a => !a.isBinary)).toBe(true);
    });
  });

  describe("getMimeType", () => {
    it("returns correct mime types", () => {
      expect(getMimeType("file.png")).toBe("image/png");
      expect(getMimeType("file.svg")).toBe("image/svg+xml");
      expect(getMimeType("file.pdf")).toBe("application/pdf");
      expect(getMimeType("file.unknown")).toBe("application/octet-stream");
    });
  });

  describe("inheritance", () => {
    it("collects assets from parent chain", () => {
      const parentSkill = makeSkill({
        path: "ui/react/_index",
        assets: [
          {
            file: "assets/component-base.tsx.template",
            absolutePath: "/fake/component-base.tsx.template",
            description: "Base template",
            type: "template",
            isBinary: false,
          },
        ],
      });

      const childSkill = makeSkill({
        path: "ui/react/auth",
        parent: parentSkill,
        assets: [
          {
            file: "assets/AuthProvider.tsx.template",
            absolutePath: "/fake/AuthProvider.tsx.template",
            description: "Auth template",
            type: "template",
            isBinary: false,
          },
        ],
      });

      const all = resolver.resolveInheritedAssets(childSkill);
      expect(all).toHaveLength(2);
      const inherited = all.find(a => a.from !== undefined);
      expect(inherited).toBeDefined();
      expect(inherited!.from).toBe("ui/react/_index");
    });

    it("child asset wins on name conflict", () => {
      const parentSkill = makeSkill({
        path: "parent",
        assets: [
          {
            file: "assets/template.tsx",
            absolutePath: "/parent/template.tsx",
            description: "Parent version",
            type: "template",
            isBinary: false,
          },
        ],
      });

      const childSkill = makeSkill({
        path: "child",
        parent: parentSkill,
        assets: [
          {
            file: "assets/template.tsx",
            absolutePath: "/child/template.tsx",
            description: "Child version",
            type: "template",
            isBinary: false,
          },
        ],
      });

      const all = resolver.resolveInheritedAssets(childSkill);
      expect(all).toHaveLength(1);
      expect(all[0].description).toBe("Child version");
      expect(all[0].from).toBeUndefined(); // From child, not inherited
    });

    it("does not inherit when inherit is false", () => {
      const parentSkill = makeSkill({
        path: "parent",
        assets: [
          {
            file: "assets/template.tsx",
            absolutePath: "/parent/template.tsx",
            description: "Parent",
            type: "template",
            isBinary: false,
          },
        ],
      });

      const childSkill = makeSkill({
        path: "child",
        parent: parentSkill,
        frontmatter: {
          keywords: [],
          description: "",
          inherit: false,
          priority: 0,
          assets: [],
          scripts: [],
        },
        assets: [],
      });

      const all = resolver.resolveInheritedAssets(childSkill);
      expect(all).toHaveLength(0);
    });
  });

  describe("readAssetContent", () => {
    it("reads a text file", async () => {
      const absPath = path.join(
        TEST_SKILLS_DIR,
        "ui", "react", "auth", "assets", "auth-config.example.ts",
      );
      const content = await resolver.readAssetContent(absPath, 1_048_576);
      expect(content).toContain("authConfig");
    });

    it("throws on file exceeding max size", async () => {
      const absPath = path.join(
        TEST_SKILLS_DIR,
        "ui", "react", "auth", "assets", "auth-config.example.ts",
      );
      await expect(resolver.readAssetContent(absPath, 1)).rejects.toThrow("exceeds size limit");
    });
  });
});
