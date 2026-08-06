/**
 * Unit tests for the persistence-health registry (src/db/persistenceHealth.ts).
 * Pure in-memory state — no database, no Express app — so these run in the same
 * DATABASE_URL-less environment as the rest of the suite (see test/setup.ts).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordDbFailure,
  recordDbSuccess,
  getPersistenceHealth,
  resetPersistenceHealth,
} from '../src/db/persistenceHealth';

beforeEach(() => {
  resetPersistenceHealth();
});

describe('persistence health registry', () => {
  it('reports healthy with no failures before anything is recorded', () => {
    const h = getPersistenceHealth();
    expect(h.healthy).toBe(true);
    expect(h.totalFailures).toBe(0);
    expect(h.consecutiveFailures).toBe(0);
    expect(h.lastFailure).toBeNull();
    expect(h.lastSuccessAt).toBeNull();
  });

  it('records a failure with context and message, and flips healthy to false', () => {
    recordDbFailure('persistClaim', new Error('column "release_code_expires_at" does not exist'));
    const h = getPersistenceHealth();
    expect(h.healthy).toBe(false);
    expect(h.totalFailures).toBe(1);
    expect(h.consecutiveFailures).toBe(1);
    expect(h.lastFailure?.context).toBe('persistClaim');
    expect(h.lastFailure?.message).toContain('release_code_expires_at');
    expect(h.lastFailure?.at).toBeTruthy();
  });

  it('accepts non-Error throwables by stringifying them', () => {
    recordDbFailure('persistMom', 'plain string failure');
    expect(getPersistenceHealth().lastFailure?.message).toBe('plain string failure');
  });

  it('counts consecutive failures until a success resets the streak', () => {
    recordDbFailure('persistClaim', new Error('a'));
    recordDbFailure('persistClaim', new Error('b'));
    recordDbFailure('persistClaim', new Error('c'));
    expect(getPersistenceHealth().consecutiveFailures).toBe(3);

    recordDbSuccess();
    const h = getPersistenceHealth();
    expect(h.healthy).toBe(true);
    expect(h.consecutiveFailures).toBe(0);
    // totalFailures is cumulative and NOT reset by a success.
    expect(h.totalFailures).toBe(3);
    expect(h.lastSuccessAt).toBeTruthy();
    // The last failure is retained as a record even after recovery.
    expect(h.lastFailure?.context).toBe('persistClaim');
  });

  it('goes unhealthy again if a failure follows a recovery', () => {
    recordDbSuccess();
    expect(getPersistenceHealth().healthy).toBe(true);
    recordDbFailure('insertApproval', new Error('boom'));
    const h = getPersistenceHealth();
    expect(h.healthy).toBe(false);
    expect(h.consecutiveFailures).toBe(1);
    expect(h.totalFailures).toBe(1);
  });
});
