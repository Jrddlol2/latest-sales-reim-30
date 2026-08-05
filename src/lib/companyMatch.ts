import { Company } from '../types';

/**
 * Normalizes a company name for comparison: lowercases, strips punctuation,
 * and drops common legal-entity suffixes ("Inc", "Corp", "Ltd", ...) so
 * "Meralco", "Meralco, Inc.", and "MERALCO CORP" all reduce to the same key.
 * Used both for exact-after-normalization matching and as the input to the
 * similarity scorer below.
 */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|philippines|ph)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Standard edit-distance (Levenshtein) between two strings. */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previousRow = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const currentRow = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      currentRow.push(
        Math.min(
          previousRow[j + 1] + 1, // deletion
          currentRow[j] + 1, // insertion
          previousRow[j] + cost, // substitution
        ),
      );
    }
    previousRow = currentRow;
  }
  return previousRow[b.length];
}

/**
 * 0..1 similarity between two ALREADY-NORMALIZED strings (1 = identical).
 * Combines edit-distance ratio with a containment bonus, since typo-tolerant
 * matching alone underrates short-name-inside-long-name cases like "Meralco"
 * vs "Meralco Head Office".
 */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  const editRatio = 1 - levenshteinDistance(a, b) / maxLen;
  const containment = a.includes(b) || b.includes(a) ? 0.15 : 0;
  return Math.min(1, editRatio + containment);
}

export interface CompanyMatch {
  company: Company;
  score: number;
}

/**
 * A match this close is almost certainly the same company typed differently
 * (case, punctuation, a legal suffix) — safe to treat as "found it."
 */
const EXACT_THRESHOLD = 0.92;
/** Below this, matches are too weak to bother surfacing as "did you mean?". */
const SUGGEST_THRESHOLD = 0.55;

/** An existing company whose normalized name is effectively identical to `query`. */
export function findExactMatch(query: string, companies: Company[]): Company | undefined {
  const normQuery = normalizeCompanyName(query);
  if (!normQuery) return undefined;
  return companies.find(c => similarity(normQuery, normalizeCompanyName(c.name)) >= EXACT_THRESHOLD);
}

/**
 * Ranked "did you mean?" suggestions for a partially-typed or possibly-
 * misspelled company name — excludes anything already at exact-match
 * confidence (that's `findExactMatch`'s job, not a suggestion to click).
 */
export function findSimilarCompanies(query: string, companies: Company[], limit = 4): CompanyMatch[] {
  const normQuery = normalizeCompanyName(query);
  if (!normQuery || normQuery.length < 2) return [];
  return companies
    .map(company => ({ company, score: similarity(normQuery, normalizeCompanyName(company.name)) }))
    .filter(m => m.score >= SUGGEST_THRESHOLD && m.score < EXACT_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
