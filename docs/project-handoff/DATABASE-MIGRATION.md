# Database migration — status

Tracks PRODUCTION-PASS #3 / PROTOTYPE-AUDIT.md's top P0 blocker: "No
persistent database. All state is module-level arrays... A restart, crash,
or second instance = total data loss."

**Update (2026-08-04): mostly complete.** The server now runs against a real
Supabase Postgres database via Drizzle ORM, and the migrated core workflow
writes persist. Historical imports, notification preferences, implicit company
creation, user/master-data audit events, the mock outbox, and `last_seen` still
have process-local gaps documented in `REMAINING-BACKEND-GAPS.md`. See
the project README's [Database persistence](PROJECT-README.md#database-persistence)
section for the full picture (architecture, what's excluded and why, hosting
constraints, RLS notes). This document keeps the original plan for
historical context and lists what's genuinely still open.

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
  the test suite (which never sets it) keeps running purely in-memory.
- **Migrations** — applied via `npm run db:push` (Drizzle's live-sync
  command) rather than the generated `drizzle/0000_*.sql` + a manual
  `migrate()` step; fine for this stage, worth revisiting for a real release
  pipeline (see "Still open" below).
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
2. **Multi-step writes aren't wrapped in real Postgres transactions.** A
   route like claim submission calls several `persist*()` functions as
   sequential awaited upserts (claim, then expense line items, then the
   linked MOM), not one atomic transaction. Each individual call is a
   complete, valid write; the risk is a failure mid-sequence leaving a
   partial update, not corrupted data.
3. **`POST /api/admin/reset` clears and re-persists reference data, but this
   is the one route doing bulk multi-table clear+reseed** — worth a second
   look if its scope grows further.
4. **Migrations still run via `drizzle-kit push`** (live schema sync), not
   generated SQL files applied through a proper migration runner. Fine for
   active development; before a real release pipeline exists, switch to
   `drizzle-kit generate` + an explicit `migrate()` step so schema changes
   are reviewable, ordered files instead of an implicit diff-and-apply.
5. **Mock email/outbox, `last_seen`, and `import_batches` remain
   intentionally in-memory-only** — see the README for why. Migrate them
   only if a real need for that data to survive a restart shows up.
6. **Row-Level Security (RLS)** is off on every Supabase table (the
   dashboard flags this). Low-risk today (see the README's RLS section) but
   worth enabling with default-deny policies as cheap defense-in-depth.
