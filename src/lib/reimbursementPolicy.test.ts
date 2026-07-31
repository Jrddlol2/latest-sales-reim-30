import { describe, expect, it } from 'vitest';
import {
  getReimbursementDateError,
  shiftIsoDate,
  validateReimbursementPurchaseDate,
} from './reimbursementPolicy';

describe('reimbursement filing window', () => {
  const filingDate = '2026-07-31';

  it('allows a purchase made exactly 30 calendar days before filing', () => {
    expect(validateReimbursementPurchaseDate('2026-07-01', filingDate)).toEqual({
      valid: true,
      ageDays: 30,
    });
  });

  it('rejects a purchase made 31 days before filing', () => {
    expect(validateReimbursementPurchaseDate('2026-06-30', filingDate)).toEqual({
      valid: false,
      reason: 'expired',
      ageDays: 31,
    });
  });

  it('rejects missing and future purchase dates', () => {
    expect(getReimbursementDateError('', filingDate)).toBe('Enter the receipt purchase date.');
    expect(validateReimbursementPurchaseDate('2026-08-01', filingDate)).toMatchObject({
      valid: false,
      reason: 'future',
    });
  });

  it('shifts ISO dates across month boundaries', () => {
    expect(shiftIsoDate(filingDate, -30)).toBe('2026-07-01');
  });
});
