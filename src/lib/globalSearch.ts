const SEARCH_ALIASES: Record<string, string[][]> = {
  ca: [['ca'], ['cash', 'advance']],
  cashadv: [['cashadv'], ['cash', 'advance']],
  liq: [['liq'], ['liquidation']],
  loa: [['loa'], ['letter', 'agreement']],
  mom: [['mom'], ['minutes', 'meeting']],
  reimb: [['reimb'], ['reimbursement']],
  reim: [['reim'], ['reimbursement']],
  req: [['req'], ['requestor']],
  supp: [['supp'], ['support']],
};

/** Normalize user-entered and indexed text so casing, accents and punctuation
 * never make an otherwise obvious record undiscoverable. */
export function normalizeSearchText(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function expandQueryGroups(query: string): string[][][] {
  const rawTokens = normalizeSearchText(query).split(' ').filter(Boolean);
  return rawTokens.map(token => SEARCH_ALIASES[token] || [[token]]);
}

/** Damerau-Levenshtein distance treats a common adjacent-letter swap as one
 * typo (for example `jnae` -> `jane`) instead of two. */
function editDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(columns).fill(0));

  for (let row = 0; row < rows; row += 1) matrix[row][0] = row;
  for (let column = 0; column < columns; column += 1) matrix[0][column] = column;

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + substitutionCost,
      );
      if (
        row > 1 && column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        matrix[row][column] = Math.min(matrix[row][column], matrix[row - 2][column - 2] + 1);
      }
    }
  }

  return matrix[left.length][right.length];
}

function typoAllowance(token: string): number {
  if (token.length >= 8) return 2;
  if (token.length >= 4) return 1;
  return 0;
}

function tokenMatchScore(queryToken: string, candidateToken: string): number {
  if (candidateToken === queryToken) return 30;
  if (candidateToken.startsWith(queryToken)) return 24;
  if (queryToken.length >= 3 && candidateToken.includes(queryToken)) return 20;

  const allowance = typoAllowance(queryToken);
  if (!allowance || Math.abs(candidateToken.length - queryToken.length) > allowance) return 0;
  const distance = editDistance(queryToken, candidateToken);
  return distance <= allowance ? 16 - (distance * 3) : 0;
}

/**
 * Rank a record against a query. Every query token must match somewhere, but
 * tokens may appear in any order and may contain a small, length-aware typo.
 * Title matches receive a boost so a reference/name beats a description-only
 * match without flooding results with weak guesses.
 */
export function rankSearchMatch(titleValue: unknown, searchableValue: unknown, queryValue: unknown): number {
  const query = normalizeSearchText(queryValue);
  const queryGroups = expandQueryGroups(query);
  if (!query || queryGroups.length === 0) return 0;

  const title = normalizeSearchText(titleValue);
  const searchable = normalizeSearchText(`${titleValue || ''} ${searchableValue || ''}`);
  if (title === query) return 120;
  if (title.startsWith(query)) return 100;
  if (title.includes(query)) return 85;

  const titleTokens = title.split(' ').filter(Boolean);
  const searchableTokens = searchable.split(' ').filter(Boolean);
  let score = 0;

  for (const alternatives of queryGroups) {
    let bestAlternativeScore = 0;
    for (const alternativeTokens of alternatives) {
      let alternativeScore = 0;
      let completeAlternative = true;
      for (const queryToken of alternativeTokens) {
        let bestTokenScore = 0;
        for (const candidateToken of searchableTokens) {
          bestTokenScore = Math.max(bestTokenScore, tokenMatchScore(queryToken, candidateToken));
        }
        if (bestTokenScore === 0) {
          completeAlternative = false;
          break;
        }
        const titleBoost = titleTokens.some(token => tokenMatchScore(queryToken, token) > 0) ? 8 : 0;
        alternativeScore += bestTokenScore + titleBoost;
      }
      if (completeAlternative) bestAlternativeScore = Math.max(bestAlternativeScore, alternativeScore);
    }
    if (bestAlternativeScore === 0) return 0;
    score += bestAlternativeScore;
  }

  return score;
}
