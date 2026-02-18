import type { Frontmatter, MatchingConfig, MatchScore } from "../types/index.js";

const STOP_WORDS = new Set([
  // English
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall",
  "should", "may", "might", "must", "can", "could", "of", "to", "in",
  "for", "on", "with", "at", "by", "from", "as", "into", "about",
  "it", "its", "this", "that", "and", "or", "not", "no", "but",
  "if", "so", "my", "me", "i", "we", "you", "he", "she", "they",
  // French
  "le", "la", "les", "un", "une", "des", "du", "de", "et", "ou",
  "en", "dans", "sur", "par", "pour", "avec", "ce", "cette", "ces",
  "je", "tu", "il", "elle", "nous", "vous", "ils", "elles",
  "est", "sont", "ai", "as", "au", "aux",
]);

export function tokenize(context: string): string[] {
  const cleaned = context
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")  // remove punctuation, keep hyphens
    .split(/\s+/)
    .filter(t => t.length > 0)
    .filter(t => !STOP_WORDS.has(t));

  return [...new Set(cleaned)];
}

export function score(
  context: string,
  keywords: string[],
  priority: number,
): MatchScore {
  const contextTokens = tokenize(context);
  if (contextTokens.length === 0 || keywords.length === 0) {
    return { score: 0, matchedKeywords: [], contextTokens };
  }

  const lowerKeywords = keywords.map(kw => kw.toLowerCase());

  const matchedKeywords = lowerKeywords.filter(kw =>
    contextTokens.some(token => {
      // Skip bidirectional matching for very short tokens (< 3 chars)
      // to avoid false positives
      if (token.length < 3 && kw.length < 3) {
        return token === kw;
      }
      return token === kw || token.includes(kw) || kw.includes(token);
    }),
  );

  const baseScore = matchedKeywords.length / lowerKeywords.length;
  const finalScore = baseScore + priority * 0.001;

  return {
    score: finalScore,
    matchedKeywords,
    contextTokens,
  };
}

export class KeywordMatcher {
  constructor(private config: MatchingConfig) {}

  score(context: string, frontmatter: Frontmatter): MatchScore {
    return score(context, frontmatter.keywords, frontmatter.priority);
  }

  isAboveMinScore(matchScore: MatchScore): boolean {
    return matchScore.score >= this.config.min_score;
  }
}
