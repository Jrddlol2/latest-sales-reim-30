/**
 * Regression suite for the reimbursement workflow transition guards added after
 * the 2026-08-03 system audit. These lock in that the server rejects replay and
 * out-of-order mutations (re-approving a settled claim, generating a code or
 * releasing payment out of sequence) instead of silently re-running them, and
 * that release codes are minted from the secure, unambiguous alphabet.
 *
 * Runs against the real Express app and its in-memory routes — no mocking. See
 * core-loop.smoke.test.ts for the happy-path counterpart and the env rationale.
 */
process.env.VERCEL = '1';
process.env.AUTO_SEED = 'false';
process.env.NODE_ENV = 'production';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { getTodayIsoDate } from '../src/lib/reimbursementPolicy';

const { createApp } = await import('../server');

// Seeded org chart: Alice (u1, Requestor) reports to Bob (u2, Approver);
// Carol (u3) is the Custodian who processes and releases payment.
const REQUESTOR_ID = 'u1';
const APPROVER_ID = 'u2';
const CUSTODIAN_ID = 'u3';
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

/** Create a MOM + reimbursement claim; returns the claim id (status Pending Approval). */
async function submitClaim(purpose: string, amount = 900) {
  const mom = await api('/api/moms', REQUESTOR_ID, {
    method: 'POST',
    body: JSON.stringify({ client: 'Guard Test Client', purpose, meeting_date: '2026-01-20', status: 'Completed' }),
  });
  const submit = await api('/api/claims', REQUESTOR_ID, {
    method: 'POST',
    body: JSON.stringify({
      mom_id: mom.body.id,
      expense_category: 'Client Meals',
      total_amount: amount,
      receipt_url: '/receipt_placeholder.png',
      expense_date: PURCHASE_DATE,
      meeting_date: '2026-01-20',
      meeting_time: '10:00',
    }),
  });
  expect(submit.status).toBe(200);
  expect(submit.body.status).toBe('Pending Approval');
  return submit.body.id as string;
}

const approve = (claimId: string, approverId = APPROVER_ID) =>
  api(`/api/claims/${claimId}/approve`, approverId, { method: 'POST', body: JSON.stringify({ decision: 'Approved' }) });
const genCode = (claimId: string) =>
  api(`/api/claims/${claimId}/claim-code`, CUSTODIAN_ID, { method: 'PUT', body: JSON.stringify({}) });
const markReady = (claimId: string) =>
  api(`/api/claims/${claimId}/ready-for-claim`, CUSTODIAN_ID, { method: 'POST', body: JSON.stringify({ payment_method: 'Cash' }) });

beforeAll(async () => {
  const app = await createApp();
  server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;
});

afterAll(() => {
  server?.close();
});

describe('approval transition guard', () => {
  it('rejects re-approving a claim that already left Pending Approval', async () => {
    const claimId = await submitClaim('re-approve');
    expect((await approve(claimId)).status).toBe(200); // -> Processing

    const replay = await approve(claimId);
    expect(replay.status).toBe(409);
    expect(replay.body.error).toContain('no longer awaiting');
  });

  it('rejects returning/rejecting a claim that is no longer pending', async () => {
    const claimId = await submitClaim('return-after-approve');
    expect((await approve(claimId)).status).toBe(200); // -> Processing

    const lateReturn = await api(`/api/claims/${claimId}/approve`, APPROVER_ID, {
      method: 'POST',
      body: JSON.stringify({ decision: 'Returned', comment: 'too late' }),
    });
    expect(lateReturn.status).toBe(409);
  });
});

describe('custodian claim-code guard', () => {
  it('rejects generating a claim code before the claim reaches Processing', async () => {
    const claimId = await submitClaim('early-code'); // still Pending Approval
    const early = await genCode(claimId);
    expect(early.status).toBe(409);
    expect(early.body.error).toContain('Processing');
  });

  it('mints codes from the secure, unambiguous alphabet', async () => {
    const claimId = await submitClaim('code-format');
    await approve(claimId);
    const code = (await genCode(claimId)).body.release_code as string;
    // 6 chars, no ambiguous 0/O/1/I, from crypto.randomBytes.
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });
});

describe('release code confirm guard', () => {
  it('locks out after too many incorrect confirm attempts, blocking even the correct code', async () => {
    const claimId = await submitClaim('lockout-test');
    await approve(claimId);
    await genCode(claimId);
    await markReady(claimId);

    const wrongAttempt = () =>
      api(`/api/claims/${claimId}/claim`, REQUESTOR_ID, { method: 'POST', body: JSON.stringify({ code: 'WRONG1' }) });

    // The 5th wrong attempt itself still reports "incorrect code" but is the
    // one that trips the lockout for every attempt after it.
    for (let i = 0; i < 5; i++) {
      const res = await wrongAttempt();
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Incorrect Claim Code');
    }
    const locked = await wrongAttempt();
    expect(locked.status).toBe(429);
    expect(locked.body.error).toContain('Too many incorrect attempts');

    // Even the correct code is rejected while locked out.
    const claim = await api(`/api/claims/${claimId}`, REQUESTOR_ID);
    const correctWhileLocked = await api(`/api/claims/${claimId}/claim`, REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({ code: claim.body.release_code }),
    });
    expect(correctWhileLocked.status).toBe(429);
  });

  it('resets the attempt counter after a successful confirm', async () => {
    const claimId = await submitClaim('reset-test');
    await approve(claimId);
    await genCode(claimId);
    await markReady(claimId);

    await api(`/api/claims/${claimId}/claim`, REQUESTOR_ID, { method: 'POST', body: JSON.stringify({ code: 'WRONG1' }) });

    const claim = await api(`/api/claims/${claimId}`, REQUESTOR_ID);
    const success = await api(`/api/claims/${claimId}/claim`, REQUESTOR_ID, {
      method: 'POST',
      body: JSON.stringify({ code: claim.body.release_code }),
    });
    expect(success.status).toBe(200);
    expect(success.body.status).toBe('Completed');
  });
});

describe('ready-for-claim transition guard', () => {
  it('rejects marking a claim ready before it is in Processing', async () => {
    const claimId = await submitClaim('early-ready'); // still Pending Approval
    const early = await markReady(claimId);
    expect(early.status).toBe(409);
    expect(early.body.error).toContain('Processing');
  });

  it('rejects marking an already-ready claim ready again (idempotent guard)', async () => {
    const claimId = await submitClaim('double-ready');
    await approve(claimId);
    await genCode(claimId);
    expect((await markReady(claimId)).status).toBe(200); // -> Ready for Claim

    const second = await markReady(claimId);
    expect(second.status).toBe(409);
  });
});
