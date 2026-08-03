import { describe, expect, it } from 'vitest';
import { Claim, ClaimStatus } from '../types';
import { getRequestAmountPresentation } from './claimWorkflow';

const claim = (overrides: Partial<Claim>): Claim => ({
  id: 'c1', ref: 'REIM-1', requestorId: 'u1', status: ClaimStatus.PENDING_APPROVAL,
  total: 25000, claimedAmount: 25000, paidAmount: 0, createdAt: '2026-08-01',
  type: 'Reimbursement', purpose: 'Client meeting', ...overrides,
});

describe('getRequestAmountPresentation', () => {
  it('keeps a receipt total separate from a pending reimbursement', () => {
    expect(getRequestAmountPresentation(claim({}))).toEqual({
      expenseLabel: 'Expense total', expenseAmount: 25000, reimbursementLabel: 'Pending',
    });
  });

  it('shows the amount actually paid on a completed reimbursement', () => {
    expect(getRequestAmountPresentation(claim({ status: ClaimStatus.COMPLETED, approvedAmount: 1000, paidAmount: 1000 }))).toEqual({
      expenseLabel: 'Expense total', expenseAmount: 25000, reimbursementLabel: 'Paid', reimbursementAmount: 1000,
    });
  });

  it('uses requested and released language for cash advances', () => {
    expect(getRequestAmountPresentation(claim({ type: 'Cash Advance', claimedAmount: 10000, total: 10000, status: ClaimStatus.RELEASED, approvedAmount: 10000, paidAmount: 10000 }))).toEqual({
      expenseLabel: 'Requested', expenseAmount: 10000, reimbursementLabel: 'Released', reimbursementAmount: 10000,
    });
  });
});
