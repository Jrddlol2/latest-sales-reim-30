import { describe, it, expect } from 'vitest';
import {
  fromServerClaim, fromServerCashAdvance, fromServerLiquidation,
  fromServerUser, fromServerEmail, fromServerMom, toServerStatus,
} from './api';
import { ClaimStatus } from '../types';

describe('fromServerClaim', () => {
  it('maps snake_case fields to the unified camelCase Claim shape', () => {
    const claim = fromServerClaim({
      id: 'c1',
      claim_number: 'REIM-2026-000001',
      requestor_id: 'u1',
      status: 'Pending Approval',
      total_amount: '4500',
      created_at: '2026-01-01T00:00:00.000Z',
      remarks: 'Client dinner',
      current_approver_id: 'u2',
      history: [],
    });

    expect(claim.id).toBe('c1');
    expect(claim.ref).toBe('REIM-2026-000001');
    expect(claim.requestorId).toBe('u1');
    expect(claim.status).toBe(ClaimStatus.PENDING_APPROVAL);
    expect(claim.total).toBe(4500);
    expect(claim.type).toBe('Reimbursement');
    expect(claim.approverId).toBe('u2');
  });

  it('falls back to a generated ref when claim_number is missing', () => {
    const claim = fromServerClaim({ id: 'abcdef123456', status: 'Draft', history: [] });
    expect(claim.ref).toBe('REIM-abcdef');
  });

  it('falls back through remarks -> mom purpose -> expense category -> default', () => {
    expect(fromServerClaim({ id: 'c1', status: 'Draft', remarks: 'A', history: [] }).purpose).toBe('A');
    expect(fromServerClaim({ id: 'c1', status: 'Draft', mom: { purpose: 'B' }, history: [] }).purpose).toBe('B');
    expect(fromServerClaim({ id: 'c1', status: 'Draft', expense_category: 'C', history: [] }).purpose).toBe('C');
    expect(fromServerClaim({ id: 'c1', status: 'Draft', history: [] }).purpose).toBe('Reimbursement');
  });

  it('derives submittedAt from the history entry that transitioned to Pending Approval', () => {
    const claim = fromServerClaim({
      id: 'c1',
      status: 'Pending Approval',
      history: [
        { new_status: 'Draft', timestamp: '2026-01-01T00:00:00.000Z' },
        { new_status: 'Pending Approval', timestamp: '2026-01-02T00:00:00.000Z' },
      ],
    });
    expect(claim.submittedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('passes an unrecognized status straight through rather than dropping it', () => {
    const claim = fromServerClaim({ id: 'c1', status: 'SomeFutureStatus', history: [] });
    expect(claim.status).toBe('SomeFutureStatus');
  });
});

describe('fromServerCashAdvance', () => {
  it('generates a CADV- prefixed ref and maps its own status table', () => {
    const ca = fromServerCashAdvance({
      id: 'abcdef123456', requestorId: 'u1', status: 'Released', amount: '5000', createdAt: '2026-01-01',
    });
    expect(ca.ref).toBe('CADV-abcdef');
    expect(ca.type).toBe('Cash Advance');
    expect(ca.status).toBe(ClaimStatus.RELEASED);
    expect(ca.total).toBe(5000);
  });

  it('leaves submittedAt undefined while still a Draft', () => {
    const draft = fromServerCashAdvance({ id: 'c1', status: 'Draft', createdAt: '2026-01-01' });
    expect(draft.submittedAt).toBeUndefined();

    const submitted = fromServerCashAdvance({ id: 'c1', status: 'Submitted', createdAt: '2026-01-01' });
    expect(submitted.submittedAt).toBe('2026-01-01');
  });
});

describe('fromServerLiquidation', () => {
  it('generates a LIQ- prefixed ref, maps its own status table, and inherits purpose from the cash advance', () => {
    const liq = fromServerLiquidation({
      id: 'abcdef123456',
      status: 'Reviewed',
      totalSpent: '3000',
      varianceAmount: '-200',
      varianceType: 'RefundDue',
      cashAdvance: { purpose: 'Client visit' },
      createdAt: '2026-01-01',
    });
    expect(liq.ref).toBe('LIQ-abcdef');
    expect(liq.type).toBe('Liquidation');
    expect(liq.status).toBe(ClaimStatus.REVIEWED);
    expect(liq.purpose).toBe('Client visit');
    expect(liq.varianceAmount).toBe(-200);
  });

  it('falls back to a generic purpose when there is no linked cash advance', () => {
    const liq = fromServerLiquidation({ id: 'c1', status: 'Draft', createdAt: '2026-01-01' });
    expect(liq.purpose).toBe('Liquidation');
  });
});

describe('toServerStatus', () => {
  it('round-trips every Reimbursement status through the claim table', () => {
    expect(toServerStatus(ClaimStatus.PENDING_APPROVAL, 'Reimbursement')).toBe('Pending Approval');
    expect(toServerStatus(ClaimStatus.APPROVED, 'Reimbursement')).toBe('Approved');
    // The UI enum value differs from the server's own spelling — this is the
    // exact class of drift the audit flagged (currentApproverId vs approverId,
    // missing Completed enum) as slipping through without `strict` on.
    expect(toServerStatus(ClaimStatus.RETURNED, 'Reimbursement')).toBe('Returned');
  });

  it('disambiguates the same UI status by claim type', () => {
    // 'Rejected' exists in both the Reimbursement and Cash Advance tables —
    // toServerStatus must route through the table for the given type, not
    // whichever table happens to be checked first.
    expect(toServerStatus(ClaimStatus.REJECTED, 'Reimbursement')).toBe('Rejected');
    expect(toServerStatus(ClaimStatus.REJECTED, 'Cash Advance')).toBe('Rejected');
    expect(toServerStatus(ClaimStatus.RETURNED, 'Liquidation')).toBe('ReturnedForRevision');
  });

  it('falls back to the UI status string when no server label maps to it', () => {
    expect(toServerStatus(ClaimStatus.REVIEW_MEETING_SCHEDULED, 'Reimbursement')).toBe('Review Meeting Scheduled');
  });
});

describe('fromServerUser', () => {
  it('maps snake_case identity fields to camelCase', () => {
    const user = fromServerUser({
      id: 'u1', name: 'Alice Reyes', email: 'alice@mgenesis.com', role: 'Requestor',
      department: 'Sales', reports_to: 'u2', avatar_url: '/avatars/corp_female_1.jpg',
    });
    expect(user.reportsTo).toBe('u2');
    expect(user.avatarUrl).toBe('/avatars/corp_female_1.jpg');
  });
});

describe('fromServerEmail', () => {
  it('maps snake_case email fields to camelCase', () => {
    const email = fromServerEmail({
      id: 'e1', recipient_id: 'u1', from: 'system', to: 'alice@mgenesis.com',
      subject: 'Test', body: 'Body', read: false, timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(email.recipientId).toBe('u1');
    expect(email.read).toBe(false);
  });
});

describe('fromServerMom', () => {
  it('hides the retired demo placeholder while preserving real uploads', () => {
    const legacy = fromServerMom({
      id: 'm1', requestor_id: 'u1', file_url: '/mom_attachment_placeholder.png', file_name: 'fake-minutes.png',
    });
    const uploaded = fromServerMom({
      id: 'm2', requestor_id: 'u1', file_url: '/uploads/real-minutes.pdf', file_name: 'real-minutes.pdf', minutes_source: 'Uploaded',
    });

    expect(legacy?.fileUrl).toBeUndefined();
    expect(legacy?.fileName).toBeUndefined();
    expect(uploaded?.fileUrl).toBe('/uploads/real-minutes.pdf');
    expect(uploaded?.fileName).toBe('real-minutes.pdf');
  });
});
