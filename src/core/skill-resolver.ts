import type { Skill } from "../types/index.js";

export class SkillResolver {
  resolve(skill: Skill): string {
    if (!skill.frontmatter.inherit) {
      return skill.content;
    }

    // Collect the chain from root to this skill
    const chain: Skill[] = [];
    let current: Skill | null = skill;
    while (current) {
      chain.unshift(current);
      current = current.parent;
    }

    // Concatenate from most general to most specific
    const sections: string[] = [];
    for (const s of chain) {
      const label = s.path === "_root"
        ? "GLOBAL RULES"
        : s.path.toUpperCase().replace(/\//g, " > ").replace(/_INDEX/g, "").replace(/\s+/g, " ").trim();
      const fromPath = s.filePath;
      sections.push(`=== ${label} (from ${fromPath}) ===\n\n${s.content}`);
    }

    return sections.join("\n\n");
  }
}
