# Database migration — status

Tracks PRODUCTION-PASS #3 / PROTOTYPE-AUDIT.md's top P0 blocker: "No
persistent database. All state is module-level arrays... A restart, crash,
or second instance = total data loss."

## What's done

- **Schema** (`src/db/schema.ts`) — 25 Postgres tables via Drizzle ORM,
  one per in-memory collection in `server.ts`. Table/column names are
  snake_case; every enum (`ClaimStatus`, `UserRole`, etc.) is a Postgres
  `pgEnum` matching `src/serverTypes.ts` exactly. Foreign keys are declared
  everywhere the in-memory data has a real relationship — including the
  circular-looking `moms.claim_id` <-> `claims.mom_id` pair (broken by
  `moms.claim_id` being nullable and backfilled after the claim exists,
  which is also how `server.ts` already does it in memory) and the
  self-referencing `users.reports_to` org-chart edge.
- **Client factory** (`src/db/index.ts`) — lazily creates a `drizzle()`
  instance from `DATABASE_URL`. Throws a clear error if that env var is
  unset; nothing currently imports this module, so its absence today is
  inert.
- **Migration** (`drizzle/0000_*.sql`) — generated via `npm run db:generate`
  from the schema above. Generation doesn't need a live connection; applying
  it (`npm run db:push`, or `drizzle-kit migrate` in a real pipeline) does.
- **Config** — `drizzle.config.ts`, and `DATABASE_URL` documented in
  `.env.example`.

## What's NOT done yet

**`server.ts` still runs entirely on in-memory arrays.** Nothing above is
wired into the actual request handlers — this was deliberately scoped as
schema-and-migrations-only until a real `DATABASE_URL` exists to develop
and test the swap against (see the session that produced this doc for why:
no Postgres instance was available at the time).

The remaining work, in order:

1. **Get a `DATABASE_URL`** — Render's managed Postgres add-on is the
   natural choice (matches this app's existing Render deploy), or Neon/
   Supabase for a free instant option.
2. **Apply the migration**: `npm run db:push` (or switch to
   `drizzle-kit generate` + a proper `migrate()` call at boot, once this
   is past prototype stage).
3. **Seed the DB** — `server.ts`'s `seedYearOfData()` and
   `buildDefaultUsers()` currently populate the in-memory arrays directly;
   port that same generation logic to `INSERT` through the Drizzle client
   instead, gated the same way (`AUTO_SEED` env var).
4. **Swap each route's data access, collection by collection.** Realistic
   order: `users` first (almost everything joins against it), then
   `moms`/`claims`/`expense_line_items` (the core loop — covered by
   `test/core-loop.smoke.test.ts`, which should keep passing throughout),
   then `cash_advances`/`liquidations`, then the smaller/independent
   collections (`companies`, the six master-data tables, `field_definitions`,
   `emails`, `support_requests`, `delegations`, `review_meetings`,
   `import_batches`, `system_settings`, `last_seen`).
5. **Decide a transaction boundary story.** Several routes currently do
   several in-memory array mutations that need to become one Postgres
   transaction (e.g. approving a claim: status change + `approvals` insert +
   `status_histories` insert + email send must not partially apply).
6. **Retire the arrays** once every route reads/writes through the DB —
   delete the `let claims: Claim[] = []` style module-level state in
   `server.ts`.
7. **Update `POST /api/admin/reset`** — today it just re-initializes the
   in-memory arrays; post-migration it needs to `TRUNCATE`/reseed the
   actual tables.

Steps 1–2 need your input (a real connection string) before anything past
this document can be verified against a live database — an untested
1000+-line data-access rewrite across 25 tables isn't something to hand off
without a way to actually run it.
