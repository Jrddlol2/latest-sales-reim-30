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

const { createApp } = await import('../server');

// Seeded org chart: Alice (u1, Requestor) reports to Bob (u2, Approver);
// Carol (u3) is the Custodian who processes and releases payment.
const REQUESTOR_ID = 'u1';
const APPROVER_ID = 'u2';
const CUSTODIAN_ID = 'u3';

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
        receipt_url: '/receipt_placeholder.png', meeting_date: '2026-01-16', meeting_time: '11:00',
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
        receipt_url: '/receipt_placeholder.png', meeting_date: '2026-01-17', meeting_time: '11:00',
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
});
