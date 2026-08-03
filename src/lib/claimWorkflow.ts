import { Claim, ClaimStatus, ClaimType } from '../types';

export function claimTypeIcon(type: ClaimType): string {
  if (type === 'Transport Reimbursement') return 'local_taxi';
  if (type === 'Cash Advance') return 'account_balance_wallet';
  if (type === 'Liquidation') return 'request_quote';
  return 'receipt_long';
}

export interface RequestAmountPresentation {
  expenseLabel: 'Expense total' | 'Requested' | 'Amount spent';
  expenseAmount: number;
  reimbursementLabel: 'Paid' | 'Approved' | 'Released' | 'Pending' | 'Not applicable';
  reimbursementAmount?: number;
}

/** Preserve the business meaning of amounts shown in mixed request tables. */
export function getRequestAmountPresentation(claim: Claim): RequestAmountPresentation {
  if (claim.type === 'Cash Advance') {
    if (claim.paidAmount > 0) {
      return { expenseLabel: 'Requested', expenseAmount: claim.claimedAmount, reimbursementLabel: 'Released', reimbursementAmount: claim.paidAmount };
    }
    if (claim.approvedAmount !== undefined) {
      return { expenseLabel: 'Requested', expenseAmount: claim.claimedAmount, reimbursementLabel: 'Approved', reimbursementAmount: claim.approvedAmount };
    }
    return {
      expenseLabel: 'Requested',
      expenseAmount: claim.claimedAmount,
      reimbursementLabel: [ClaimStatus.SUBMITTED, ClaimStatus.PENDING_APPROVAL].includes(claim.status) ? 'Pending' : 'Not applicable',
    };
  }

  if (claim.type === 'Liquidation') {
    return { expenseLabel: 'Amount spent', expenseAmount: claim.claimedAmount, reimbursementLabel: 'Not applicable' };
  }

  if (claim.paidAmount > 0) {
    return { expenseLabel: 'Expense total', expenseAmount: claim.claimedAmount, reimbursementLabel: 'Paid', reimbursementAmount: claim.paidAmount };
  }
  if (claim.approvedAmount !== undefined) {
    return { expenseLabel: 'Expense total', expenseAmount: claim.claimedAmount, reimbursementLabel: 'Approved', reimbursementAmount: claim.approvedAmount };
  }
  return {
    expenseLabel: 'Expense total',
    expenseAmount: claim.claimedAmount,
    reimbursementLabel: [ClaimStatus.SUBMITTED, ClaimStatus.PENDING_APPROVAL, ClaimStatus.REVIEW_MEETING_SCHEDULED].includes(claim.status) ? 'Pending' : 'Not applicable',
  };
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
