import { Claim, ClaimStatus, ClaimType } from '../types';

export function claimTypeIcon(type: ClaimType): string {
  if (type === 'Transport Reimbursement') return 'local_taxi';
  if (type === 'Cash Advance') return 'account_balance_wallet';
  if (type === 'Liquidation') return 'request_quote';
  return 'receipt_long';
}

export function getClaimAgingInfo(submittedAt: string | undefined, createdAt: string) {
  const start = new Date(submittedAt || createdAt).getTime();
  const days = Math.max(0, Math.floor((Date.now() - start) / (1000 * 60 * 60 * 24)));

  if (days >= 5) {
    return {
      text: `Waiting ${days} day${days === 1 ? '' : 's'}`,
      color: 'text-on-error-container bg-error-container border border-error/30',
      raw: days,
    };
  }
  if (days >= 3) {
    return {
      text: `Waiting ${days} day${days === 1 ? '' : 's'}`,
      color: 'text-on-tertiary-container bg-tertiary-container border border-tertiary/40',
      raw: days,
    };
  }
  return {
    text: days === 0 ? 'Today' : `Waiting ${days} day${days === 1 ? '' : 's'}`,
    color: 'text-on-surface-variant bg-surface-container-high border border-outline-variant',
    raw: days,
  };
}

/** The single source of truth for items a custodian can still act on. */
export function isCustodianProcessingClaim(claim: Claim): boolean {
  return claim.status === ClaimStatus.APPROVED ||
    claim.status === ClaimStatus.PROCESSING ||
    (claim.type === 'Liquidation' &&
      claim.status === ClaimStatus.REVIEWED &&
      claim.varianceType === 'RefundDue');
}

export function isFinanceVisibleClaim(claim: Claim): boolean {
  return claim.status !== ClaimStatus.DRAFT;
}
