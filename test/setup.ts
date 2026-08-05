// Vitest global setup — runs before any test file (and therefore before the
// dynamic `import('../server')` those files do).
//
// The route/workflow suites (core-loop.smoke, workflow-guards, …) exercise the
// in-memory server: they POST real claims/MoMs through the Express routes to
// assert on workflow logic, not on Postgres persistence. If a real
// `DATABASE_URL` happens to be present in `.env`, `server.ts`'s
// `import 'dotenv/config'` would load it and every `isDbConfigured()`-gated
// path would light up — which both (a) writes test claims into the real
// database on every run and (b) hard-fails whenever that database is missing a
// migration (e.g. the `claim_number_seq` sequence from 0004).
//
// Force in-memory mode for the whole suite so the baseline is hermetic,
// fast, and side-effect-free regardless of the developer's local `.env`.
// We assign an empty string rather than `delete`-ing the key: dotenv v17 only
// fills *undefined* keys, so an already-defined empty value survives
// `import 'dotenv/config'`, whereas a deleted key would be repopulated from
// `.env`. `isDbConfigured()` is `!!process.env.DATABASE_URL`, so `''` reads as
// "not configured".
process.env.DATABASE_URL = '';

// Cash Advance / Liquidation are soft-launched OFF for real users
// (src/lib/featureFlags.ts), but the workflow suites still need to exercise
// the full advance→liquidation→shortfall loop — enable every claim type here
// so that coverage is preserved while production stays gated.
process.env.ENABLE_ALL_CLAIM_TYPES = '1';

// The smoke/workflow suites drive dozens of real HTTP requests through the
// server per run; pino-http's per-request access log would otherwise flood
// the test output with a JSON line per call and bury real assertion
// failures in noise. Silent here, unaffected everywhere else (dev/prod set
// their own LOG_LEVEL or fall back to pino's "info" default).
process.env.LOG_LEVEL = 'silent';
