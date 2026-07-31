/**
 * E2E smoke test of the core reimbursement loop, against the real Express
 * app and its real in-memory routes — no mocking. This is the path the
 * audit flags as the one thing that must never silently break: submit ->
 * approve -> process -> ready-for-claim -> complete.
 *
 * VERCEL=1 skips the module's own app.listen() (we drive listen() ourselves
 * on an ephemeral port); AUTO_SEED=false skips the year-long demo seed so
 * the test starts from a clean, fast, deterministic slate; NODE_ENV=production
 * skips mounting the Vite dev-middleware, which this API-only test doesn't need.
 */
process.env.VERCEL = '1';
process.env.AUTO_SEED = 'false';
process.env.NODE_ENV = 'production';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { getTodayIsoDate, shiftIsoDate } from '../src/lib/reimbursementPolicy';

const { createApp } = await import('../server');

// Seeded org chart: Alice (u1, Requestor) reports to Bob (u2, Approver);
// Carol (u3) is the Custodian who processes and releases payment.
const REQUESTOR_ID = 'u1';
const APPROVER_ID = 'u2';
const CUSTODIAN_ID = 'u3';
const FINANCE_ID = 'u22';
const PURCHASE_DATE = getTodayIsoDate();

let baseUrl: string;
let server: Server;

async function api(path: string, userId: string, init: RequestInit = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => undefined);
  return { status: res.status, body };
}

beforeAll(async () => {
  const app = await createApp();
  server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;
});

afterAll(() => {
  server?.close();
});

describe('core reimbursement loop (submit -> approve -> process -> ready -> complete)', () => {
  it('drives a claim through every status transition against the real routes', async () => {
    // 1. Requestor completes a Minutes of Meeting.
    const mom = await api('/api/moms', REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({
        client: 'Acme Corp', purpose: 'Quarterly review', meeting_date: '2026-01-15',
        status: 'Completed',
      }),
    });
    expect(mom.status).toBe(200);
    const momId = mom.body.id;

    // 2. Requestor submits a reimbursement claim against that MOM.
    const submit = await api('/api/claims', REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({
        mom_id: momId,
        expense_category: 'Client Meals',
        total_amount: 2500,
        receipt_url: '/receipt_placeholder.png',
        expense_date: PURCHASE_DATE,
        meeting_date: '2026-01-15',
        meeting_time: '10:00',
      }),
    });
    expect(submit.status).toBe(200);
    const claimId = submit.body.id;
    expect(submit.body.status).toBe('Pending Approval');
    expect(submit.body.current_approver_id).toBe(APPROVER_ID);

    // 3. Approver approves it — moves straight to Processing.
    const approve = await api(`/api/claims/${claimId}/approve`, APPROVER_ID, {
      method: 'POST',
      body: JSON.stringify({ decision: 'Approved' }),
    });
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe('Processing');
    expect(approve.body.approved_amount).toBe(1000);
    expect(approve.body.approved_at).toBeTruthy();

    // 4. Custodian generates a claim/release code.
    const claimCode = await api(`/api/claims/${claimId}/claim-code`, CUSTODIAN_ID, {
      method: 'PUT',
      body: JSON.stringify({}),
    });
    expect(claimCode.status).toBe(200);
    const releaseCode = claimCode.body.release_code;
    expect(releaseCode).toBeTruthy();

    // 5. Custodian releases payment and marks it Ready for Claim.
    const ready = await api(`/api/claims/${claimId}/ready-for-claim`, CUSTODIAN_ID, {
      method: 'POST',
      body: JSON.stringify({ payment_method: 'Cash' }),
    });
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe('Ready for Claim');
    expect(ready.body.paid_amount).toBe(1000);
    expect(ready.body.paid_at).toBeTruthy();

    // 6. Requestor confirms receipt with the release code — claim completes.
    const complete = await api(`/api/claims/${claimId}/claim`, REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({ code: releaseCode }),
    });
    expect(complete.status).toBe(200);
    expect(complete.body.status).toBe('Completed');

    // The immutable history should carry every transition, in order. Claim-code
    // generation logs its own same-status ("Processing" -> "Processing") entry
    // rather than a transition, so it shows up as a repeat, not a new status.
    const detail = await api(`/api/claims/${claimId}`, REQUESTOR_ID);
    const transitions = detail.body.history
      .slice()
      .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map((h: any) => h.new_status);
    expect(transitions).toEqual([
      'Pending Approval', 'Processing', 'Processing', 'Ready for Claim', 'Completed',
    ]);
  });

  it('rejects an approval attempt from someone who is not the assigned approver', async () => {
    const mom = await api('/api/moms', REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({ client: 'Acme Corp', purpose: 'Follow-up', meeting_date: '2026-01-16', status: 'Completed' }),
    });
    const submit = await api('/api/claims', REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({
        mom_id: mom.body.id, expense_category: 'Travel', total_amount: 1000,
        receipt_url: '/receipt_placeholder.png', expense_date: PURCHASE_DATE, meeting_date: '2026-01-16', meeting_time: '11:00',
      }),
    });
    const claimId = submit.body.id;

    // Custodian (not the assigned approver) tries to approve — must be rejected.
    const forbidden = await api(`/api/claims/${claimId}/approve`, CUSTODIAN_ID, {
      method: 'POST',
      body: JSON.stringify({ decision: 'Approved' }),
    });
    expect(forbidden.status).toBe(403);
  });

  it('rejects the requestor confirming receipt with the wrong release code', async () => {
    const mom = await api('/api/moms', REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({ client: 'Acme Corp', purpose: 'Wrong code test', meeting_date: '2026-01-17', status: 'Completed' }),
    });
    const submit = await api('/api/claims', REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({
        mom_id: mom.body.id, expense_category: 'Travel', total_amount: 800,
        receipt_url: '/receipt_placeholder.png', expense_date: PURCHASE_DATE, meeting_date: '2026-01-17', meeting_time: '11:00',
      }),
    });
    const claimId = submit.body.id;
    await api(`/api/claims/${claimId}/approve`, APPROVER_ID, { method: 'POST', body: JSON.stringify({ decision: 'Approved' }) });
    await api(`/api/claims/${claimId}/claim-code`, CUSTODIAN_ID, { method: 'PUT', body: JSON.stringify({}) });
    await api(`/api/claims/${claimId}/ready-for-claim`, CUSTODIAN_ID, { method: 'POST', body: JSON.stringify({ payment_method: 'Cash' }) });

    const wrongCode = await api(`/api/claims/${claimId}/claim`, REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({ code: 'NOT-THE-CODE' }),
    });
    expect(wrongCode.status).toBe(400);
  });

  it('files Transport Reimbursement without a MOM and still requires a receipt', async () => {
    const missingReceipt = await api('/api/claims', REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({
        claim_type: 'Transport Reimbursement',
        expense_category: 'Transportation',
        total_amount: 850,
        expense_date: PURCHASE_DATE,
      }),
    });
    expect(missingReceipt.status).toBe(400);

    const expiredReceipt = await api('/api/claims', REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({
        claim_type: 'Transport Reimbursement',
        expense_category: 'Transportation',
        total_amount: 850,
        expense_date: shiftIsoDate(PURCHASE_DATE, -31),
        receipt_url: '/receipt_placeholder.png',
      }),
    });
    expect(expiredReceipt.status).toBe(400);
    expect(expiredReceipt.body.error).toContain('within 30 days');

    const submitted = await api('/api/claims', REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({
        claim_type: 'Transport Reimbursement',
        expense_category: 'Transportation',
        total_amount: 850,
        receipt_url: '/receipt_placeholder.png',
        expense_date: PURCHASE_DATE,
        or_number: 'OR-TRANSPORT-001',
      }),
    });

    expect(submitted.status).toBe(200);
    expect(submitted.body.claim_type).toBe('Transport Reimbursement');
    expect(submitted.body.mom_id).toBeUndefined();
    expect(submitted.body.status).toBe('Pending Approval');
  });

  it('lets the Custodian return a processing reimbursement with an audited reason', async () => {
    const mom = await api('/api/moms', REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({ client: 'Correction Client', purpose: 'Custodian return test', meeting_date: '2026-01-18', status: 'Completed' }),
    });
    const submit = await api('/api/claims', REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({
        mom_id: mom.body.id,
        expense_category: 'Transportation',
        total_amount: 950,
        receipt_url: '/receipt_placeholder.png',
        expense_date: PURCHASE_DATE,
        meeting_date: '2026-01-18',
        meeting_time: '09:00',
      }),
    });
    await api(`/api/claims/${submit.body.id}/approve`, APPROVER_ID, {
      method: 'POST',
      body: JSON.stringify({ decision: 'Approved' }),
    });

    const missingReason = await api(`/api/custodian/claims/${submit.body.id}/decision`, CUSTODIAN_ID, {
      method: 'POST',
      body: JSON.stringify({ decision: 'Return', comment: '' }),
    });
    expect(missingReason.status).toBe(400);

    const returned = await api(`/api/custodian/claims/${submit.body.id}/decision`, CUSTODIAN_ID, {
      method: 'POST',
      body: JSON.stringify({ decision: 'Return', comment: 'Receipt image does not show the OR number.' }),
    });
    expect(returned.status).toBe(200);
    expect(returned.body.status).toBe('Returned');

    const detail = await api(`/api/claims/${submit.body.id}`, REQUESTOR_ID);
    expect(detail.body.history[0].reason).toContain('Custodian return');
    expect(detail.body.history[0].reason).toContain('OR number');
  });

  it('gives Finance company-wide read access without approval or processing authority', async () => {
    const linkedMom = await api('/api/moms', REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({ client: 'Finance View Client', purpose: 'Finance visibility test', meeting_date: '2026-01-18', status: 'Completed' }),
    });
    const submitted = await api('/api/claims', REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({
        mom_id: linkedMom.body.id,
        expense_category: 'Travel',
        total_amount: 1200,
        receipt_url: '/receipt_placeholder.png',
        expense_date: PURCHASE_DATE,
        meeting_date: '2026-01-18',
        meeting_time: '13:00',
      }),
    });
    const standaloneMom = await api('/api/moms', REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({ client: 'Private Client', purpose: 'Standalone personal minutes', meeting_date: '2026-01-19', status: 'Completed' }),
    });

    const financeClaims = await api('/api/claims', FINANCE_ID);
    expect(financeClaims.status).toBe(200);
    expect(financeClaims.body.some((claim: any) => claim.id === submitted.body.id)).toBe(true);

    const financeMoms = await api('/api/moms', FINANCE_ID);
    expect(financeMoms.status).toBe(200);
    expect(financeMoms.body.some((mom: any) => mom.id === linkedMom.body.id)).toBe(true);
    expect(financeMoms.body.some((mom: any) => mom.id === standaloneMom.body.id)).toBe(false);

    const cannotApprove = await api(`/api/claims/${submitted.body.id}/approve`, FINANCE_ID, {
      method: 'POST',
      body: JSON.stringify({ decision: 'Approved' }),
    });
    expect(cannotApprove.status).toBe(403);

    const cannotEditMinutes = await api(`/api/moms/${linkedMom.body.id}`, FINANCE_ID, {
      method: 'PUT',
      body: JSON.stringify({ purpose: 'Finance must not change this' }),
    });
    expect(cannotEditMinutes.status).toBe(403);

    const cannotGenerateCode = await api(`/api/claims/${submitted.body.id}/claim-code`, FINANCE_ID, {
      method: 'PUT',
      body: JSON.stringify({}),
    });
    expect(cannotGenerateCode.status).toBe(403);
  });

  it('includes cash-advance and liquidation history in list responses', async () => {
    const advance = await api('/api/cash-advances', REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({ amount: 3000, purpose: 'Field expenses' }),
    });
    expect(advance.status).toBe(200);

    const submittedAdvance = await api(`/api/cash-advances/${advance.body.id}/submit`, REQUESTOR_ID, { method: 'POST' });
    expect(submittedAdvance.status).toBe(200);
    const approvedAdvance = await api(`/api/cash-advances/${advance.body.id}/approve`, APPROVER_ID, {
      method: 'POST',
      body: JSON.stringify({ decision: 'Approved', comment: 'Budget confirmed' }),
    });
    expect(approvedAdvance.status).toBe(200);
    expect(approvedAdvance.body.approvedAt).toBeTruthy();

    const releasedAdvance = await api(`/api/cash-advances/${advance.body.id}/release`, CUSTODIAN_ID, {
      method: 'POST',
      body: JSON.stringify({ releaseReference: 'CV-3000', releaseMethod: 'Cash' }),
    });
    expect(releasedAdvance.status).toBe(200);
    expect(releasedAdvance.body.paidAmount).toBe(3000);

    const liquidation = await api('/api/liquidations', REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({ cashAdvanceId: advance.body.id }),
    });
    expect(liquidation.status).toBe(200);
    const lineItem = await api(`/api/liquidations/${liquidation.body.id}/line-items`, REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({
        expense_date: '2026-01-20',
        vendor: 'Field Vendor',
        category: 'Travel',
        amount: 3000,
        payment_method: 'Cash',
        business_purpose: 'Field expenses',
        receipt_url: '/receipt_placeholder.png',
        or_number: 'OR-3000',
      }),
    });
    expect(lineItem.status).toBe(200);
    const submittedLiquidation = await api(`/api/liquidations/${liquidation.body.id}/submit`, REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(submittedLiquidation.status).toBe(200);

    const financeAdvances = await api('/api/cash-advances', FINANCE_ID);
    const listedAdvance = financeAdvances.body.find((item: any) => item.id === advance.body.id);
    expect(listedAdvance.history.map((entry: any) => entry.new_status)).toEqual(
      expect.arrayContaining(['Submitted', 'Approved', 'Released'])
    );

    const financeLiquidations = await api('/api/liquidations', FINANCE_ID);
    const listedLiquidation = financeLiquidations.body.find((item: any) => item.id === liquidation.body.id);
    expect(listedLiquidation.history.map((entry: any) => entry.new_status)).toEqual(
      expect.arrayContaining(['Draft', 'Submitted'])
    );

    const financeAnalytics = await api('/api/analytics/summary?type=Cash%20Advance&paymentMethod=Cash', FINANCE_ID);
    expect(financeAnalytics.status).toBe(200);
    const analyticsAdvance = financeAnalytics.body.records.find((item: any) => item.id === advance.body.id);
    expect(analyticsAdvance).toMatchObject({
      type: 'Cash Advance',
      claimedAmount: 3000,
      approvedAmount: 3000,
      paidAmount: 3000,
      outstandingAmount: 0,
    });
    expect(analyticsAdvance.submittedAt).toBeTruthy();
    expect(financeAnalytics.body.metrics.paidAmount).toBeGreaterThanOrEqual(3000);

    const liquidationAnalytics = await api('/api/analytics/summary?type=Liquidation', FINANCE_ID);
    const analyticsLiquidation = liquidationAnalytics.body.records.find((item: any) => item.id === liquidation.body.id);
    expect(analyticsLiquidation.paidAmount).toBe(0);
    expect(liquidationAnalytics.body.dimensions.types).toContain('Liquidation');
  });
});

describe('approved post-meeting reimbursement rules', () => {
  it('accepts a receipt-backed transport claim without a MOM and caps the whole-claim payout', async () => {
    const submit = await api('/api/claims', REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({
        reimbursement_type: 'Transport',
        remarks: 'Client transport',
        line_items: [
          {
            category: 'Transportation',
            amount: 750,
            expense_date: '2026-07-01',
            vendor: 'Taxi',
            receipt_url: '/receipt_taxi.png',
            or_number: 'OR-TAXI-1',
          },
          {
            category: 'Transportation',
            amount: 700,
            expense_date: '2026-07-01',
            vendor: 'Parking',
            receipt_url: '/receipt_parking.png',
            or_number: 'OR-PARK-1',
          },
        ],
      }),
    });

    expect(submit.status).toBe(200);
    expect(submit.body.reimbursement_type).toBe('Transport');
    expect(submit.body.mom_id).toBeUndefined();
    expect(submit.body.total_amount).toBe(1450);
    expect(submit.body.reimbursable_amount).toBe(1000);
  });

  it('still requires a MOM for a standard reimbursement', async () => {
    const submit = await api('/api/claims', REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({
        reimbursement_type: 'Standard',
        expense_category: 'Client Meals',
        total_amount: 900,
        receipt_url: '/receipt_meal.png',
      }),
    });

    expect(submit.status).toBe(400);
    expect(submit.body.error).toContain('Minutes of Meeting');
  });

  it('lets an approver optionally schedule a review meeting when returning a claim', async () => {
    const transport = await api('/api/claims', REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({
        reimbursement_type: 'Transport',
        line_items: [{
          category: 'Transportation',
          amount: 850,
          expense_date: '2026-07-02',
          vendor: 'Ride share',
          receipt_url: '/receipt_ride.png',
        }],
      }),
    });

    const returned = await api(`/api/claims/${transport.body.id}/approve`, APPROVER_ID, {
      method: 'POST',
      body: JSON.stringify({
        decision: 'Returned',
        comment: 'Please clarify the route.',
        review_meeting: { meeting_date: '2026-08-03', meeting_time: '14:00' },
      }),
    });
    expect(returned.status).toBe(200);
    expect(returned.body.status).toBe('Returned');

    const meetings = await api('/api/review-meetings', REQUESTOR_ID);
    expect(meetings.body.some((meeting: any) =>
      meeting.claim_id === transport.body.id &&
      meeting.meeting_date === '2026-08-03' &&
      meeting.meeting_time === '14:00'
    )).toBe(true);
  });
});
