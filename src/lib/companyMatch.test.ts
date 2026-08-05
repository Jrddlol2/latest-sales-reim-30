import { describe, it, expect } from 'vitest';
import { normalizeCompanyName, findExactMatch, findSimilarCompanies } from './companyMatch';
import { Company } from '../types';

function co(id: string, name: string): Company {
  return { id, name };
}

describe('normalizeCompanyName', () => {
  it('lowercases, strips punctuation, and drops legal suffixes', () => {
    expect(normalizeCompanyName('Meralco, Inc.')).toBe('meralco');
    expect(normalizeCompanyName('MERALCO CORP')).toBe('meralco');
    expect(normalizeCompanyName('Meralco Corporation')).toBe('meralco');
    expect(normalizeCompanyName('  Meralco   ')).toBe('meralco');
  });
});

describe('findExactMatch', () => {
  const companies = [co('1', 'Meralco'), co('2', 'PLDT Inc'), co('3', 'San Miguel Corporation')];

  it('matches a name that differs only by case/punctuation/legal suffix', () => {
    expect(findExactMatch('meralco', companies)?.id).toBe('1');
    expect(findExactMatch('Meralco, Inc.', companies)?.id).toBe('1');
    expect(findExactMatch('PLDT', companies)?.id).toBe('2');
    expect(findExactMatch('San Miguel Corp', companies)?.id).toBe('3');
  });

  it('does not match an unrelated or genuinely different company', () => {
    expect(findExactMatch('Globe Telecom', companies)).toBeUndefined();
    expect(findExactMatch('', companies)).toBeUndefined();
  });
});

describe('findSimilarCompanies', () => {
  const companies = [co('1', 'Meralco'), co('2', 'Metrobank'), co('3', 'Globe Telecom')];

  it('surfaces a close typo as a suggestion, not an exact match', () => {
    // A mid-word substitution (not a prefix/suffix of the real name) — close
    // enough to suggest, not close enough to auto-match.
    const matches = findSimilarCompanies('Meralca', companies);
    expect(matches[0]?.company.id).toBe('1');
    expect(matches[0]?.score).toBeLessThan(0.92);
  });

  it('treats a partially-typed prefix of a real name as near-exact, not merely similar', () => {
    // "Meralc" is a strict prefix of "Meralco" — this is a still-typing case,
    // not a spelling difference, so it should score high enough to fall out
    // of the "similar" bucket (findExactMatch is what surfaces it).
    expect(findExactMatch('Meralc', companies)?.id).toBe('1');
  });

  it('ranks the closer of two similarly-spelled companies first', () => {
    const matches = findSimilarCompanies('Meralko', companies);
    expect(matches[0]?.company.name).toBe('Meralco');
  });

  it('returns nothing for a short or empty query', () => {
    expect(findSimilarCompanies('', companies)).toEqual([]);
    expect(findSimilarCompanies('a', companies)).toEqual([]);
  });

  it('returns nothing when nothing is close enough', () => {
    expect(findSimilarCompanies('Zzyzx Aerospace', companies)).toEqual([]);
  });

  it('excludes matches strong enough to count as exact', () => {
    const matches = findSimilarCompanies('meralco', companies);
    expect(matches.find(m => m.company.name === 'Meralco')).toBeUndefined();
  });
});
