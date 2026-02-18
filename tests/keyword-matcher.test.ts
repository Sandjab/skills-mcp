import { describe, it, expect } from "vitest";
import { tokenize, score, KeywordMatcher } from "../src/core/keyword-matcher.js";

describe("tokenize", () => {
  it("lowercases and splits on spaces", () => {
    const tokens = tokenize("React Auth Component");
    expect(tokens).toContain("react");
    expect(tokens).toContain("auth");
    expect(tokens).toContain("component");
  });

  it("removes stopwords", () => {
    const tokens = tokenize("create a React component for the authentication");
    expect(tokens).not.toContain("a");
    expect(tokens).not.toContain("for");
    expect(tokens).not.toContain("the");
    expect(tokens).toContain("create");
    expect(tokens).toContain("react");
    expect(tokens).toContain("component");
    expect(tokens).toContain("authentication");
  });

  it("removes punctuation but keeps hyphens", () => {
    const tokens = tokenize("react-testing-library, vitest!");
    expect(tokens).toContain("react-testing-library");
    expect(tokens).toContain("vitest");
  });

  it("deduplicates tokens", () => {
    const tokens = tokenize("react react React");
    expect(tokens.filter(t => t === "react").length).toBe(1);
  });

  it("returns empty for only stopwords", () => {
    const tokens = tokenize("the a an is");
    expect(tokens).toHaveLength(0);
  });
});

describe("score", () => {
  it("scores exact keyword matches", () => {
    const result = score("react component", ["react", "component", "hook"], 0);
    expect(result.score).toBeCloseTo(2 / 3);
    expect(result.matchedKeywords).toEqual(["react", "component"]);
  });

  it("scores substring matches (token contains keyword)", () => {
    const result = score("authentication", ["auth"], 0);
    expect(result.matchedKeywords).toContain("auth");
    expect(result.score).toBeGreaterThan(0);
  });

  it("scores substring matches (keyword contains token)", () => {
    const result = score("auth", ["authentication"], 0);
    expect(result.matchedKeywords).toContain("authentication");
    expect(result.score).toBeGreaterThan(0);
  });

  it("applies priority as tiebreaker", () => {
    const r1 = score("react component", ["react", "component"], 0);
    const r2 = score("react component", ["react", "component"], 10);
    expect(r2.score).toBeGreaterThan(r1.score);
    expect(r2.score - r1.score).toBeCloseTo(0.01);
  });

  it("returns zero score when no keywords match", () => {
    const result = score("kubernetes deploy", ["react", "component", "hook"], 0);
    expect(result.score).toBe(0);
    expect(result.matchedKeywords).toHaveLength(0);
  });

  it("returns zero for empty context", () => {
    const result = score("", ["react", "component"], 0);
    expect(result.score).toBe(0);
  });

  it("returns zero for empty keywords", () => {
    const result = score("react component", [], 0);
    expect(result.score).toBe(0);
  });

  it("avoids false positives for very short tokens (<3 chars)", () => {
    // "js" should not match "jsx" via bidirectional matching when both are short
    const result = score("go", ["jsx", "ts"], 0);
    expect(result.matchedKeywords).toHaveLength(0);
  });
});

describe("KeywordMatcher", () => {
  it("filters by min_score", () => {
    const matcher = new KeywordMatcher({
      min_score: 0.5,
      max_results: 3,
      ambiguity_threshold: 0.1,
    });

    const low = matcher.score("random stuff", {
      keywords: ["react", "component", "hook", "jsx"],
      description: "",
      inherit: true,
      priority: 0,
      assets: [],
      scripts: [],
    });
    expect(matcher.isAboveMinScore(low)).toBe(false);

    const high = matcher.score("react component hook", {
      keywords: ["react", "component", "hook"],
      description: "",
      inherit: true,
      priority: 0,
      assets: [],
      scripts: [],
    });
    expect(matcher.isAboveMinScore(high)).toBe(true);
  });
});
