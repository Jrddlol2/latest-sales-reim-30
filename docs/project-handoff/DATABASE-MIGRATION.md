# Database migration — status

Tracks PRODUCTION-PASS #3 / PROTOTYPE-AUDIT.md's top P0 blocker: "No
persistent database. All state is module-level arrays... A restart, crash,
or second instance = total data loss."

**Update (2026-08-04): mostly complete.** The server now runs against a real
Supabase Postgres database via Drizzle ORM, and the migrated core workflow
writes persist. A follow-up session on 2026-08-04 closed the historical-import,
notification-preference, implicit-company-creation, and user/master-data
audit-event gaps this note used to list — see
[`REMAINING-BACKEND-GAPS.md`](REMAINING-BACKEND-GAPS.md)'s "Resolved since
this audit" section for what changed and why. The mock outbox and `last_seen`
remain intentionally process-local — see "Still open" item 5 below for why
those two specifically are left as-is. See the project README's
[Database persistence](PROJECT-README.md#database-persistence) section for
the full picture (architecture, what's excluded and why, hosting constraints,
RLS notes). This document keeps the original plan for historical context and
lists what's genuinely still open.

## What's done

- **Schema** (`src/db/schema.ts`) — 25 Postgres tables via Drizzle ORM,
  one per in-memory collection in `server.ts`. Table/column names are
  snake_case; every enum (`ClaimStatus`, `UserRole`, etc.) is a Postgres
  `pgEnum` matching `src/serverTypes.ts` exactly. Three fields were found
  missing during the migration and added: `moms.document_type` (MoM vs LOA),
  `liquidations.refund_method`, and `system_settings.category_limits` — all
  real, mutable fields the original schema draft missed.
- **Client factory** (`src/db/index.ts`) — lazily creates a `drizzle()`
  instance from `DATABASE_URL`; falls back to a no-op proxy when unset, so
  the test suite keeps running purely in-memory. `test/setup.ts` (added
  2026-08-05) forces `DATABASE_URL` empty for every test run regardless of
  what a local `.env` sets — the route/workflow suites POST real
  claims/MoMs through the server, and without this they'd write into
  whatever database `.env` points at instead of staying in-memory.
- **Migrations** — now applied via `npm run db:migrate`
  (`src/db/migrate.ts`, added 2026-08-05), Drizzle's own `migrate()` runner
  against the generated `drizzle/*.sql` files, tracked in a
  `drizzle.__drizzle_migrations` table. `npm run db:push` (the live-sync
  command this replaced as the release-pipeline path) still exists for fast
  local iteration. See "Still open" #4 below for what's not yet applied to
  the live database.
- **Repo modules, one per domain** (`src/db/usersRepo.ts`,
  `src/db/coreLoopRepo.ts`, `src/db/cashAdvanceRepo.ts`,
  `src/db/referenceDataRepo.ts`, `src/db/workflowExtrasRepo.ts`) — each with
  a row↔domain-object mapper, `persistX()` upsert functions called from every
  mutating route, and a `loadXFromDb()` boot-time loader.
- **Core business domains migrated**: users; the reimbursement core loop (moms,
  claims, expense line items, approvals, claim-scoped history); cash
  advances and liquidations (including the auto-generated shortfall
  reimbursement claim); companies, the six master-data catalogs, field
  definitions, system settings; approver delegations, review meetings,
  support requests/messages.
- **Verification approach**: for each domain, ran the real workflow end to
  end against the live Supabase database via `curl`, then queried Postgres
  directly to confirm every row landed correctly — not just that the API
  returned 200. This caught two real bugs unit tests didn't: a
  fire-and-forget history insert racing ahead of its not-yet-persisted
  parent row (fixed by reordering: persist the parent, *then* log history),
  and an empty-string-vs-`NULL` mapping bug (`mom_id: ca.momId || ''` sent as
  a literal nonexistent foreign key; fixed with `|| null` instead of
  `?? null` in the mapper). Also separately verified the `DEMO_MODE=false`
  boot-load path (a standalone script boots the app with that flag, confirms
  it loads real data from Postgres instead of reseeding) for each domain.

## Architecture decision: in-memory cache + write-through, not a full rewrite

The original plan below assumed removing the in-memory arrays entirely
("retire the arrays," step 6). That did **not** happen, deliberately: the
arrays remain every route's in-process read cache, and only became
additionally backed by Postgres via:

1. Every mutating route also calls a `persist*()` upsert after its existing
   in-memory mutation.
2. Boot-time loading replaces the in-memory arrays with a fresh read from
   Postgres — but **only when `DEMO_MODE=false`**.

Why gate boot-loading on `DEMO_MODE` rather than doing it unconditionally:
`seedYearOfData()` (the demo generator) is a single ~1,400-line function that
generates a full year of interleaved demo claims, MOMs, cash advances,
liquidations, delegations, etc. all in one pass, and it runs on every boot
while `DEMO_MODE=true`. Reading from Postgres unconditionally at boot would
mean either (a) skipping that generator entirely once real Postgres rows
exist — breaking the "always have fresh demo data to present" behavior the
whole demo experience depends on — or (b) surgically threading a bypass
through that function so it skips regenerating only the domains that already
have real DB rows, which risks a subtle interaction bug in a function that
size for a benefit (avoiding one restart's worth of reseeding) that doesn't
matter until you're actually running with `DEMO_MODE=false`. Given the
constraint "don't break the ability to present," gating on `DEMO_MODE` was
the safe choice: the demo experience is provably unchanged (verified — see
README), and the moment a real deployment sets `DEMO_MODE=false`, the load
path takes over correctly (also verified, per-domain).

One real, known cost of this design: **it requires a single persistent Node
process.** See the README's hosting note — this is not compatible with
Vercel serverless functions without further work.

## Still open

1. **Gate the demo seed generator itself**, so `seedYearOfData()` doesn't
   regenerate fresh in-memory data on every restart while `DEMO_MODE=true`.
   Not a correctness bug today (real writes persist correctly regardless;
   this only affects what's *visibly shown* after a restart while still
   presenting), but the natural next step once the demo needs to show
   restart-to-restart continuity.
2. **Most multi-step writes still aren't wrapped in real Postgres
   transactions.** A route like claim submission calls several `persist*()`
   functions as sequential awaited upserts (claim, then expense line items,
   then the linked MOM), not one atomic transaction. Each individual call is
   a complete, valid write; the risk is a failure mid-sequence leaving a
   partial update, not corrupted data. One exception now exists: historical
   import (`POST /api/imports`) commits its batch + claims + line items +
   history as a single transaction via `persistHistoricalImportBatch()`
   (2026-08-04 follow-up session) — the pattern to extend to other
   multi-record routes if this becomes a priority.
3. **`POST /api/admin/reset` clears and re-persists reference data, but this
   is the one route doing bulk multi-table clear+reseed** — worth a second
   look if its scope grows further.
4. ~~Migrations still run via `drizzle-kit push`~~ **Resolved 2026-08-05.**
   `npm run db:migrate` (`src/db/migrate.ts`) now applies the reviewed SQL
   files in `drizzle/` via Drizzle's own `migrate()` runner, which tracks
   what's already been applied in a `drizzle.__drizzle_migrations` table so
   re-running it is a no-op. The release-pipeline workflow going forward:
   edit `schema.ts` → `npm run db:generate` (writes a new numbered file
   under `drizzle/`, review it like any other diff) → `npm run db:migrate`
   (applies pending files in order) — instead of `db:push`'s implicit
   live-diff-and-apply. `db:push` is left in `package.json` for fast local
   iteration (e.g. exploring a schema change before generating its
   migration) but should not be the way changes reach a real database going
   forward. `drizzle/0004_skinny_flatman.sql` (added 2026-08-04 for the
   claim-number sequence + unique constraint) is the first migration file
   that's genuinely current with `schema.ts`, but as of this note it has
   **not yet been applied** to the connected Supabase database — running
   `npm run db:migrate` is what applies it (and any migration after it).
   This wasn't run as part of adding the tooling since it mutates the live,
   shared database; confirm with whoever owns that database before running
   it. Until then, any code path that creates a claim while
   `DATABASE_URL` is set will fail on `nextval('claim_number_seq')`.
   **Update 2026-08-05:** a follow-up session got explicit go-ahead and
   attempted this — and found `npm run db:migrate` itself fails on a
   different problem first. The live database was built via `drizzle-kit
   push`, so its schema already has 0000–0003's objects, but Drizzle's own
   migration ledger (`drizzle.__drizzle_migrations`) has no record of
   that — `migrate()` tries to replay 0000 from scratch and collides on
   `CREATE TYPE "approval_decision"` already existing. Worse: even a
   from-scratch, ledger-aware apply of 0004 would fail on its own merits —
   the live `claims` table has **252 of 254 rows with duplicate
   `claim_number` values** (one number shared by up to 36 rows), almost
   certainly demo-seed pollution accumulated across repeated dev-server
   restarts (writes persist to Postgres regardless of `DEMO_MODE`). Adding
   0004's `UNIQUE` constraint over existing duplicates is something Postgres
   will simply refuse. **Nothing was applied** — a direct attempt to apply
   just the safe pieces (the sequence + `0005`'s `companies` columns) via
   raw SQL was also blocked by Claude Code's own auto-mode safety classifier
   for being DDL against live shared data outside the sanctioned tooling.
   Two decisions needed from whoever owns that database before this can
   move: (a) how to handle the 252 duplicate `claim_number` rows, and
   separately (b) whether to baseline the migration ledger so 0000–0003
   aren't replayed, or take some other path to get `db:migrate` itself
   working cleanly going forward.
5. **`drizzle/0005_bored_colonel_america.sql`** (added 2026-08-05 —
   `companies.pending_review` + `companies.created_by`, for the
   unlisted-company-dedup feature) has the same not-yet-applied status as
   0004, for the same reason above.
6. **Mock email/outbox and `last_seen` remain intentionally in-memory-only**
   — see the README for why. Migrate them only if a real need for that data
   to survive a restart shows up. `import_batches` no longer belongs on
   this list: historical import now persists the batch and every imported
   row transactionally (see item 2 above and
   [`REMAINING-BACKEND-GAPS.md`](REMAINING-BACKEND-GAPS.md)).
7. ~~Row-Level Security (RLS) is off on every Supabase table.~~
   **Corrected 2026-08-05** — checked directly via the live `DATABASE_URL`
   connection: RLS is actually **on** for every table already (Supabase's
   default for new tables), just with zero policies, which is functionally
   default-deny for any role without `BYPASSRLS`. The app's own connection
   (`postgres` role) has `BYPASSRLS = true` so this doesn't affect the app's
   read/write path either way; only relevant if something else ever
   connects with a different Supabase role, which nothing here does today.
