/**
 * Lightweight, in-process persistence-health registry.
 *
 * Context: this app is in-memory-first with write-through to Postgres — every
 * mutating route mutates its in-memory array AND calls a `persist*()` function
 * that upserts the same row to Postgres. Those persist calls are deliberately
 * wrapped in log-and-continue `try/catch` blocks so a transient DB blip never
 * fails a user's request (the in-memory array stays the read source while
 * `DEMO_MODE=true`). The downside is that a *persistent* write failure — e.g.
 * schema drift, where the live DB is missing a migration — is silent: the app
 * keeps serving correct data from memory while Postgres quietly falls behind,
 * and nobody notices until a `DEMO_MODE=false` cutover reads the stale DB.
 *
 * This registry makes that failure mode observable without changing any
 * request behavior. Repo write functions call `recordDbFailure`/`recordDbSuccess`
 * around their DB op; `/readyz` exposes `getPersistenceHealth()` so a monitor or
 * human can see "writes are failing" before a cutover depends on the DB. It is
 * intentionally process-local and best-effort (same durability posture as the
 * write-through itself) — not a metrics backend.
 *
 * NOTE: instrumentation currently covers the core reimbursement loop
 * (coreLoopRepo.ts — claims/moms/expenses/approvals/history), the highest-value
 * money path. Extending the same two calls to the other repos
 * (cashAdvanceRepo, usersRepo, companiesRepo, …) is a mechanical follow-up.
 */

export interface PersistenceFailure {
  /** Which write failed, e.g. "persistClaim". */
  context: string;
  /** The error's message (not the whole object — this is a status snapshot). */
  message: string;
  /** ISO timestamp of the failure. */
  at: string;
}

export interface PersistenceHealth {
  /** True when the most recent instrumented write did not fail. */
  healthy: boolean;
  /** Total write failures recorded since process start (or last reset). */
  totalFailures: number;
  /** Failures since the last success — a rising number means writes are stuck. */
  consecutiveFailures: number;
  /** The most recent failure, or null if none has been recorded. */
  lastFailure: PersistenceFailure | null;
  /** ISO timestamp of the last successful instrumented write, or null. */
  lastSuccessAt: string | null;
}

let totalFailures = 0;
let consecutiveFailures = 0;
let lastFailure: PersistenceFailure | null = null;
let lastSuccessAt: string | null = null;

/**
 * Record a failed persistence write. Does NOT log — the calling route already
 * logs via its existing `console.error('[db] …')`, so this only tracks, keeping
 * behavior (and log output) identical to before.
 */
export function recordDbFailure(context: string, err: unknown): void {
  totalFailures += 1;
  consecutiveFailures += 1;
  lastFailure = {
    context,
    message: err instanceof Error ? err.message : String(err),
    at: new Date().toISOString(),
  };
}

/** Record a successful persistence write — resets the consecutive-failure streak. */
export function recordDbSuccess(): void {
  consecutiveFailures = 0;
  lastSuccessAt = new Date().toISOString();
}

/** Snapshot of persistence health for `/readyz` and monitoring. */
export function getPersistenceHealth(): PersistenceHealth {
  return {
    healthy: consecutiveFailures === 0,
    totalFailures,
    consecutiveFailures,
    lastFailure,
    lastSuccessAt,
  };
}

/** Test-only: clear all recorded state so cases don't leak into each other. */
export function resetPersistenceHealth(): void {
  totalFailures = 0;
  consecutiveFailures = 0;
  lastFailure = null;
  lastSuccessAt = null;
}
