import { describe, expect, it } from 'vitest';
import { normalizeSearchText, rankSearchMatch } from './globalSearch';

describe('global search matching', () => {
  it('ignores casing, accents, punctuation, and leading zeroes in references', () => {
    expect(normalizeSearchText('  José—Dela Cruz  ')).toBe('jose dela cruz');
    expect(rankSearchMatch('REIM-2026-000124', 'Client visit', 'reim 124')).toBeGreaterThan(0);
  });

  it('matches multiple words in any order', () => {
    expect(rankSearchMatch('Jane Dela Cruz', 'Client contact', 'client jane')).toBeGreaterThan(0);
    expect(rankSearchMatch('Jane Dela Cruz', 'Client contact', 'jane finance')).toBe(0);
  });

  it('allows conservative typos and adjacent-letter swaps', () => {
    expect(rankSearchMatch('Jane Dela Cruz', '', 'jnae')).toBeGreaterThan(0);
    expect(rankSearchMatch('Reimbursement', '', 'reimbursmnt')).toBeGreaterThan(0);
    expect(rankSearchMatch('Reimbursement', '', 'restaurant')).toBe(0);
  });

  it('expands common workflow abbreviations', () => {
    expect(rankSearchMatch('Travel funding', 'Cash Advance request', 'CA travel')).toBeGreaterThan(0);
    expect(rankSearchMatch('Client discussion', 'Minutes of Meeting', 'MOM client')).toBeGreaterThan(0);
  });

  it('does not fuzzy-match very short arbitrary terms', () => {
    expect(rankSearchMatch('Cash Advance', '', 'cb')).toBe(0);
  });
});
