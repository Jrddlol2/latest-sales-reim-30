/**
 * Persist -> load round-trip tests against a REAL Postgres schema — built by
 * replaying this repo's actual drizzle/*.sql migration files through pg-mem
 * (test/helpers/pgMemDb.ts), not against the in-memory arrays every other
 * test in this suite exercises (test/setup.ts forces DATABASE_URL='').
 *
 * Why this file exists: the write-through repo functions (coreLoopRepo.ts,
 * usersRepo.ts, …) had ZERO automated coverage of their actual generated SQL
 * against the actual schema — the whole suite ran with DATABASE_URL unset, so
 * a column a repo function writes that a migration never added would pass
 * every test and only fail live, against Supabase. That's exactly what
 * happened in production: migration 0006 (release-code expiry/attempts/
 * lockout) shipped in code before it was applied to the live database, and
 * persistClaim started failing there — silently, since write-through failures
 * are logged and swallowed by design (see src/db/persistenceHealth.ts, added
 * the same day to surface that on /readyz). This suite is the piece that
 * catches that class of bug automatically, in CI, before it ships.
 *
 * Fidelity: pg-mem is a SQL emulator, not real Postgres (see pgMemDb.ts's own
 * header for the one known gap and its safe workaround). Treat this as a net
 * for schema/code drift, not a replacement for verifying against the real
 * Supabase instance before a migration reaches production.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildPgMemDb } from './helpers/pgMemDb';
import { __setTestDb } from '../src/db/index';
import { syncUsersToDb } from '../src/db/usersRepo';
import {
  persistMom,
  persistClaim,
  persistClaimWithLineItems,
  loadCoreLoopFromDb,
} from '../src/db/coreLoopRepo';
import { UserRole, MomStatus, MinutesSource, ClaimStatus } from '../src/serverTypes';
import type { User, Mom, Claim, ExpenseLineItem } from '../src/serverTypes';

const REQUESTOR: User = {
  id: 'pgmem-test-requestor',
  name: 'PG-Mem Test Requestor',
  email: 'pgmem-test-requestor@example.com',
  role: UserRole.REQUESTOR,
  department: 'Sales',
  reports_to: 'pgmem-test-approver',
};
const APPROVER: User = {
  id: 'pgmem-test-approver',
  name: 'PG-Mem Test Approver',
  email: 'pgmem-test-approver@example.com',
  role: UserRole.APPROVER,
  department: 'Sales',
  reports_to: null,
};

describe('persist -> load round trip against the full (pg-mem) schema', () => {
  beforeAll(async () => {
    // isDbConfigured() in every repo file is `!!process.env.DATABASE_URL` —
    // needs to be truthy so the write-through code paths actually run
    // instead of early-returning as a no-op. The value itself is never used
    // for a real connection: __setTestDb makes getDb() return the pg-mem
    // instance directly. Scoped to this file only (vitest isolates modules —
    // and therefore process.env mutations from test/setup.ts — per file), and
    // reset in afterAll as a second layer of defense against leaking into
    // whichever file runs next in the same worker.
    process.env.DATABASE_URL = 'postgres://pg-mem-test-placeholder/db';
    __setTestDb(buildPgMemDb());
    await syncUsersToDb([REQUESTOR, APPROVER]);
  });

  afterAll(() => {
    __setTestDb(undefined);
    process.env.DATABASE_URL = '';
  });

  it('round-trips a claim, its expense line items, and its MOM backfill', async () => {
    const mom: Mom = {
      id: 'pgmem-test-mom-1',
      requestor_id: REQUESTOR.id,
      client: 'Acme Corp',
      contact_person: 'Jane Doe',
      meeting_date: '2026-01-15',
      status: MomStatus.COMPLETED,
      created_at: new Date().toISOString(),
      minutes_source: MinutesSource.TEMPLATE,
    };
    const claim: Claim = {
      id: 'pgmem-test-claim-1',
      claim_number: 'REIM-2026-TEST001',
      requestor_id: REQUESTOR.id,
      current_approver_id: APPROVER.id,
      mom_id: mom.id,
      claim_type: 'Reimbursement',
      status: ClaimStatus.PENDING_APPROVAL,
      total_amount: 1250.5,
      expense_category: 'Client Meals',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    // Mirrors the real request flow: a MOM is always created and persisted
    // by its own standalone POST /api/moms call BEFORE a claim can select
    // it (claims.mom_id is an FK to moms.id, so the row must already exist).
    await persistMom(mom);

    // mkClaim in server.ts links the MOM back to its claim in memory before
    // persisting — mirror that here so the MOM backfill is exercised too.
    mom.claim_id = claim.id;
    const items: ExpenseLineItem[] = [{
      id: 'pgmem-test-expense-1',
      claim_id: claim.id,
      expense_date: '2026-01-15',
      vendor: 'Test Vendor',
      category: 'Client Meals',
      amount: 1250.5,
      payment_method: 'Cash',
      business_purpose: 'Client meeting',
    }];

    await persistClaimWithLineItems(claim, items, [mom]);

    const loaded = await loadCoreLoopFromDb();
    const loadedClaim = loaded.claims.find((c) => c.id === claim.id);
    const loadedMom = loaded.moms.find((m) => m.id === mom.id);
    const loadedExpenses = loaded.expenses.filter((e) => e.claim_id === claim.id);

    expect(loadedClaim).toBeDefined();
    expect(loadedClaim?.claim_number).toBe(claim.claim_number);
    expect(loadedClaim?.status).toBe(ClaimStatus.PENDING_APPROVAL);
    expect(loadedClaim?.total_amount).toBe(1250.5);
    expect(loadedClaim?.mom_id).toBe(mom.id);
    // Proves the MOM backfill (moms.claim_id) actually happened, not just
    // that the claim row itself was written.
    expect(loadedMom?.claim_id).toBe(claim.id);
    expect(loadedExpenses).toHaveLength(1);
    expect(loadedExpenses[0].vendor).toBe('Test Vendor');
    expect(loadedExpenses[0].amount).toBe(1250.5);
  });

  it('round-trips the release-code expiry/attempts/lockout columns migration 0006 added', async () => {
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const claim: Claim = {
      id: 'pgmem-test-claim-2',
      requestor_id: REQUESTOR.id,
      current_approver_id: APPROVER.id,
      status: ClaimStatus.READY_FOR_CLAIM,
      total_amount: 500,
      release_code: 'ABCD23',
      release_code_expires_at: expiresAt,
      release_code_attempts: 3,
      release_code_locked_until: lockedUntil,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await persistClaim(claim);

    const loaded = await loadCoreLoopFromDb();
    const loadedClaim = loaded.claims.find((c) => c.id === claim.id);

    expect(loadedClaim?.release_code).toBe('ABCD23');
    expect(loadedClaim?.release_code_attempts).toBe(3);
    // Timestamps round-trip through a real `timestamp with time zone` column
    // and back to an ISO string — compare by parsed value, not exact string,
    // since Postgres doesn't preserve sub-millisecond formatting quirks.
    expect(new Date(loadedClaim!.release_code_expires_at!).getTime()).toBe(new Date(expiresAt).getTime());
    expect(new Date(loadedClaim!.release_code_locked_until!).getTime()).toBe(new Date(lockedUntil).getTime());
  });
});

describe('a database missing a migration reproduces the exact production failure', () => {
  afterAll(() => {
    __setTestDb(undefined);
    process.env.DATABASE_URL = '';
  });

  it('fails persistClaim with a release code when migration 0006 was never applied', async () => {
    process.env.DATABASE_URL = 'postgres://pg-mem-test-placeholder/db-pre-0006';
    // Stop replay at 0005 — the exact state the live Supabase DB was actually
    // in on 2026-08-06 (see PRODUCTION-PUNCHLIST.md #5): every migration
    // through the previous release applied, this one not yet run.
    __setTestDb(buildPgMemDb('0005_bored_colonel_america.sql'));
    await syncUsersToDb([REQUESTOR, APPROVER]);

    const claim: Claim = {
      id: 'pgmem-test-claim-missing-migration',
      requestor_id: REQUESTOR.id,
      current_approver_id: APPROVER.id,
      status: ClaimStatus.READY_FOR_CLAIM,
      total_amount: 500,
      release_code: 'ZZZZ99',
      release_code_expires_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // This is the reproduction: the exact same "column ... does not exist"
    // failure the live Supabase DB threw for every persistClaim call today,
    // now caught here instead of discovered live.
    await expect(persistClaim(claim)).rejects.toThrow(/release_code_expires_at/);
  });
});
