export const REIMBURSEMENT_FILING_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateOnly(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return timestamp;
}

export function getTodayIsoDate(timeZone = 'Asia/Manila'): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function shiftIsoDate(date: string, days: number): string {
  const timestamp = parseDateOnly(date);
  if (timestamp === null) return '';
  return new Date(timestamp + days * DAY_MS).toISOString().slice(0, 10);
}

export type ReimbursementDateStatus =
  | { valid: true; ageDays: number }
  | { valid: false; reason: 'missing' | 'invalid' | 'future' | 'expired'; ageDays?: number };

/**
 * The purchase day is day 0, so a receipt purchased exactly 30 calendar days
 * before filing is still eligible. Day 31 and beyond are rejected.
 */
export function validateReimbursementPurchaseDate(
  purchaseDate: string | undefined,
  filingDate = getTodayIsoDate(),
): ReimbursementDateStatus {
  if (!purchaseDate) return { valid: false, reason: 'missing' };

  const purchaseTimestamp = parseDateOnly(purchaseDate);
  const filingTimestamp = parseDateOnly(filingDate);
  if (purchaseTimestamp === null || filingTimestamp === null) {
    return { valid: false, reason: 'invalid' };
  }

  const ageDays = Math.round((filingTimestamp - purchaseTimestamp) / DAY_MS);
  if (ageDays < 0) return { valid: false, reason: 'future', ageDays };
  if (ageDays > REIMBURSEMENT_FILING_WINDOW_DAYS) {
    return { valid: false, reason: 'expired', ageDays };
  }
  return { valid: true, ageDays };
}

export function getReimbursementDateError(
  purchaseDate: string | undefined,
  filingDate = getTodayIsoDate(),
): string | null {
  const status = validateReimbursementPurchaseDate(purchaseDate, filingDate);
  if (status.valid) return null;

  if (status.reason === 'missing') return 'Enter the receipt purchase date.';
  if (status.reason === 'invalid') return 'Enter a valid receipt purchase date.';
  if (status.reason === 'future') return 'The receipt purchase date cannot be in the future.';
  return `This receipt is ${status.ageDays} days old. Reimbursement claims must be filed within ${REIMBURSEMENT_FILING_WINDOW_DAYS} days of purchase.`;
}
