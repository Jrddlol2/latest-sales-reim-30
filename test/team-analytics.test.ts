import { describe, expect, it } from 'vitest';
import { calculateTeamAnalytics } from '../src/lib/teamAnalytics';
import { ClaimStatus, type Claim, type ExpenseLineItem, type User } from '../src/types';

describe('team analytics', () => {
  it('scopes rollups to team members and uses paid reimbursement timestamps for the weekly total', () => {
    const now = new Date('2026-07-31T00:00:00Z').getTime();
    const members = [
      { id: 'u1', name: 'Alice Reyes', department: 'Sales' },
      { id: 'u2', name: 'Eve Garcia', department: 'Marketing' },
    ] as User[];
    const claims = [
      {
        id: 'c1',
        requestorId: 'u1',
        status: ClaimStatus.COMPLETED,
        type: 'Reimbursement',
        paidAmount: 900,
        paidAt: '2026-07-29T00:00:00Z',
      },
      {
        id: 'c2',
        requestorId: 'u2',
        status: ClaimStatus.PENDING_APPROVAL,
        type: 'Reimbursement',
        paidAmount: 0,
      },
      {
        id: 'c3',
        requestorId: 'outside-team',
        status: ClaimStatus.COMPLETED,
        type: 'Reimbursement',
        paidAmount: 5000,
        paidAt: '2026-07-30T00:00:00Z',
      },
    ] as Claim[];
    const lineItems = [
      { id: 'l1', claimId: 'c1', category: 'Transportation', amount: 900, receiptUrl: '/r1.pdf' },
      { id: 'l2', claimId: 'c2', category: 'Meals', amount: 750, receiptUrl: '/r2.pdf' },
      { id: 'l3', claimId: 'c3', category: 'Travel', amount: 5000, receiptUrl: '/r3.pdf' },
    ] as ExpenseLineItem[];

    const result = calculateTeamAnalytics({ members, claims, lineItems, now });

    expect(result.totalClaims).toBe(2);
    expect(result.pendingClaims).toBe(1);
    expect(result.receiptCount).toBe(2);
    expect(result.receiptSpend).toBe(1650);
    expect(result.reimbursedThisWeek).toBe(900);
    expect(result.categories.map(category => category.name)).toEqual(['Transportation', 'Meals']);
  });

  it('does not double-count liquidation spend as a reimbursement payout', () => {
    const members = [{ id: 'u1', name: 'Alice Reyes', department: 'Sales' }] as User[];
    const claims = [{
      id: 'liq1',
      requestorId: 'u1',
      status: ClaimStatus.CLOSED,
      type: 'Liquidation',
      paidAmount: 0,
      paidAt: '2026-07-30T00:00:00Z',
    }] as Claim[];

    const result = calculateTeamAnalytics({
      members,
      claims,
      lineItems: [],
      now: new Date('2026-07-31T00:00:00Z').getTime(),
    });

    expect(result.reimbursedThisWeek).toBe(0);
    expect(result.members[0].paidAmount).toBe(0);
  });
});
