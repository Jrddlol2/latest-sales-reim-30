import { describe, expect, it } from 'vitest';
import { calculatePercentChange } from '../src/lib/chartTheme';

describe('calculatePercentChange', () => {
  it('calculates increases and decreases against the previous period', () => {
    expect(calculatePercentChange(150, 100)).toBe(50);
    expect(calculatePercentChange(75, 100)).toBe(-25);
  });

  it('does not manufacture a comparison when the prior period is zero', () => {
    expect(calculatePercentChange(100, 0)).toBeNull();
  });

  it('rejects non-finite values', () => {
    expect(calculatePercentChange(Number.NaN, 100)).toBeNull();
  });
});
