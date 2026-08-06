# AGENTS.md

Comprehensive quick-start for any AI agent (or human) picking up this repo
cold. This is a map to the traps and a working reference, not a replacement
for `README.md` (full architecture, data model, API reference) — **read that
too before making non-trivial changes.** Everything here is either something
that's easy to get wrong even after reading the README, or a fast-path
answer to "where do I even start."

Last verified accurate: 2026-08-06.

---

## 1. What this is

A role-based web app for managing sales reimbursements, transport
reimbursements, cash advances, liquidations, client-meeting records (MOM/LOA),
approvals, release processing, receipts, and support requests. Five roles:
Requestor, Approver, Custodian, Finance, Admin. It's a high-fidelity
**prototype**, functional end-to-end against a real Supabase Postgres
database, but identity is still demo-only (no real Microsoft Entra sign-in
yet) — **not safe for real employee, client, or financial data.** See
`docs/project-handoff/PRODUCTION-PUNCHLIST.md` for the exact, current list of
what's blocking that.

## 2. You are probably not in the only copy of this project

If your working directory has sibling folders like `app/` or
`latest-sales-reimburse-2926/` next to this one, **those are stale/older
copies from earlier sessions, not alternates to choose between.** This
folder (wherever `AGENTS.md` and `README.md` live together) is the canonical
one. Confirm you're editing here — not a sibling — before trusting any file
search result, and don't assume a preview/dev server is pointed at this copy
without checking its launch config. If a preview shows an unfamiliar UI or a
page title that doesn't match the source (e.g. "My Google AI Studio App"),
you're very likely looking at a sibling copy, not this one.

## 3. Quick facts

| | |
|---|---|
| Frontend | React 19 + TypeScript, Vite 6, React Router 7, Tailwind CSS 4, Recharts |
| Backend | Express 4, one file (`server.ts`, ~7,200 lines) |
| Persistence | Supabase Postgres via Drizzle ORM (`src/db/schema.ts`, 25 tables) — but see §5, it's not a plain CRUD-backed app |
| Auth | Demo-only (`X-User-Id` header). Real Entra OIDC is scaffolded but not implemented — blocked on IT, not effort |
| Tests | Vitest, 97 tests / 14 files. Real Express app on an ephemeral port, no mocking |
| Build | `vite build` (frontend) + `esbuild` (server → `dist/server.cjs`) |
| Hosting | Persistent-process host only (Render/Railway/Fly.io) — **not** Vercel serverless as currently built |
| TypeScript | `strict: true` as of 2026-08-06 |

### Directory map

```
server.ts                    Entire backend — routes, business rules, demo seed generator
src/
  db/
    schema.ts                Drizzle table definitions (source of truth for DB shape)
    index.ts                 getDb() — the one place a Postgres connection is created
    *Repo.ts                 One file per domain: coreLoopRepo, cashAdvanceRepo,
                              usersRepo, referenceDataRepo, workflowExtrasRepo.
                              Each exports persist*()/load*FromDb() pairs.
    persistenceHealth.ts     In-process write-through failure tracker (see §7)
  lib/
    api.ts                   THE frontend↔server adapter. Read before touching
                              any API-backed page or status mapping.
    *.test.ts                Framework-free unit tests, colocated with the code
  serverTypes.ts              Server-side types (snake_case — matches server.ts/JSON wire shape)
  types.ts                   Frontend types (camelCase — matches what api.ts hands components)
  components/, pages/         React UI, organized by role (admin/, approver/, custodian/, …)
test/
  *.test.ts                  Route-level integration tests (real Express app, real HTTP)
  helpers/pgMemDb.ts          Builds an in-process pg-mem Postgres from the real migrations
  setup.ts                   Global test setup — forces DATABASE_URL='' (see §6)
drizzle/*.sql                 Ordered migrations — the only source of truth for live DB shape
docs/project-handoff/         Curated, current handoff docs (§10 has the full map)
docs/archive/                 Superseded docs, kept for history — don't treat as current
```

### Running it

```bash
npm install
npm run dev            # tsx server.ts — full app, port 3000, Vite middleware in dev
npm run lint            # tsc --noEmit — the whole typecheck, no separate ESLint config
npm test                # vitest run — 97 tests, ~7s
npm run build            # vite build + esbuild bundle → dist/
npm run db:generate      # after editing schema.ts — writes a new drizzle/*.sql migration
```

No `DATABASE_URL` in `.env`? The app runs fully in-memory — every route still
works, nothing persists across a restart. See `.env.example` for every flag
and what it does; `DEMO_MODE` is the master switch.

---

## 4. The one architectural nuance that isn't obvious from the code

Every domain (users, claims, cash advances, etc.) persists to a real
Supabase Postgres database — but **reads and writes are split**:

- **Writes always persist.** Every mutating route calls a `persist*()`
  function (in `src/db/*Repo.ts`) in addition to its existing in-memory
  array mutation.
- **Boot-time loading from Postgres only happens when `DEMO_MODE=false`.**
  While `DEMO_MODE=true` (the default, used for presenting), the demo seed
  generator (`seedYearOfData()` in `server.ts`) regenerates fresh randomized
  data in memory on every restart, and real writes land in Postgres in the
  background without being read back. `seedYearOfData()` itself now throws
  if called while `DEMO_MODE` is off — a hard backstop, not just a per-route
  check, so a real deployment can never accidentally reseed.

Full reasoning in README's **Database persistence** section and
`docs/project-handoff/DATABASE-MIGRATION.md`. If you add a new domain or
route, follow the existing pattern (`src/db/coreLoopRepo.ts` is the clearest
example) — `load*FromDb()` gated the same way, `persist*()` called from every
mutation, write-through wrapped in `try/catch` that logs and continues (a
transient DB blip should never fail a user's request).

**Naming convention that trips people up:** `schema.ts` (Drizzle) is
camelCase, matching idiomatic TypeScript. `serverTypes.ts` (what `server.ts`
actually passes around and what the JSON wire format uses) is snake_case.
Every `*Repo.ts` file has a `xToRow()`/`xFromRow()` pair that translates
between them — that's the one place casing conversion happens, not scattered
through route handlers.

---

## 5. Design decisions that look like bugs but aren't

- **Release codes are stored in plaintext**, not hashed. This is deliberate:
  custodians re-display the code later in the Ready-for-Claim queue and
  Payouts history so they can read it back to a requestor in person — a
  one-way hash would make that impossible. The mitigations are a 14-day
  expiry, a 5-attempt lockout, and `crypto.timingSafeEqual` for the compare
  (all in `server.ts` near `generateReleaseCode`). Don't "fix" this by
  hashing without understanding this tradeoff first.
- **Write-through failures are logged and swallowed, not thrown to the
  user.** This is correct behavior for a transient DB blip — the app keeps
  serving from memory, which is the authoritative read source while
  `DEMO_MODE=true` anyway. The failure mode this creates (memory and
  Postgres silently diverging) is made visible via `/readyz`'s `persistence`
  field (`src/db/persistenceHealth.ts`) rather than by changing this
  behavior — see §7.
- **The demo seed generator reseeds fresh random data on every restart**
  while `DEMO_MODE=true`, even though real writes are landing in Postgres in
  the background the whole time. This is intentional for presenting a
  consistent demo, not a bug in the persistence layer — see §4.

---

## 6. Testing a DB-touching change — the full picture

There are three tiers of confidence here, and knowing which one you're
actually getting matters:

1. **`npm test` (97 tests, ~7s).** Almost all of these force
   `DATABASE_URL=''` (`test/setup.ts`) and exercise the in-memory code paths
   only — they pass or fail independent of whether your Postgres persistence
   code is correct.
2. **`test/db-persistence.test.ts`** is the one exception. It builds an
   in-process Postgres emulator (`pg-mem`, pure JS, no Docker needed) from
   the **real `drizzle/*.sql` migration files**, points the real
   `persistClaim()`/`persistClaimWithLineItems()`/`loadCoreLoopFromDb()`
   functions at it via a test-only `__setTestDb()` seam in
   `src/db/index.ts`, and asserts a full round trip. This *does* catch
   schema/code drift — a column a repo function writes that a migration
   never added, for example. One of its tests builds a database stopped at
   an earlier migration specifically to prove this: it reproduces a real
   production failure (`persistClaim()` throwing `column
   release_code_expires_at does not exist`) automatically, in CI.
   **Caveat, stated in the code:** pg-mem is a SQL emulator, not real
   Postgres. It's a net for drift, not a substitute for #3.
3. **Live verification against the actual Supabase database** is still the
   only way to confirm a migration was actually *applied* there, or to catch
   anything pg-mem doesn't emulate faithfully (see the fidelity notes in
   `test/helpers/pgMemDb.ts`). Two real bugs have shipped past lint,
   typecheck, and the full test suite historically and were only caught this
   way: a fire-and-forget history insert racing ahead of its
   not-yet-persisted parent row (FK violation), and an
   empty-string-vs-`NULL` mapping bug (`?? null` doesn't catch `''`).

**Bottom line:** if you touch `src/db/*Repo.ts`, `schema.ts`, or a route that
calls a `persist*()` function, tiers 1+2 (`npm test`) now catch a lot more
than they used to — but for anything going to production, or if you're not
sure pg-mem faithfully emulates what you changed, still do tier 3:

```bash
# 1. Confirm DATABASE_URL is set in .env (ask the user for the Supabase
#    session-pooler connection string if it isn't — see README's
#    "Database persistence" section for why session pooler, not direct).
# 2. Run the actual workflow end to end (curl or the browser).
# 3. Check GET /readyz — its `persistence` field will show a recent write
#    failure even if the HTTP response looked fine (see §7).
# 4. Query Postgres directly to confirm the row landed correctly — don't
#    trust a 200 response alone.
# 5. If touching a "create" route, restart the server (or run a
#    DEMO_MODE=false standalone boot) and confirm the record is still there.
```

## 7. Debugging: `/readyz` tells you more than "is the DB up"

`GET /readyz` returns liveness/readiness **plus** a `persistence` field:

```json
{ "status": "ok", "database": "reachable",
  "persistence": { "healthy": false, "totalFailures": 3, "consecutiveFailures": 1,
    "lastFailure": { "context": "persistClaim", "message": "...", "at": "..." },
    "lastSuccessAt": "2026-08-06T01:00:00Z" } }
```

If something looks like it saved (200 response, correct in-memory state) but
doesn't survive a restart, or you're chasing a "works in the UI but the DB
looks stale" report, check this endpoint *first* — it's cheaper than reading
server logs by hand. Currently only the core reimbursement-loop writes
(`coreLoopRepo.ts`) are instrumented; extending the same
`recordDbFailure`/`recordDbSuccess` pair to the other repo files is
mechanical (see `persistenceHealth.ts`'s own header comment).

Note what it does **not** do: a write-through failure never flips `/readyz`
to a 503. That's intentional — the app is still correctly serving from
memory, so failing readiness (and pulling a working demo out of a load
balancer) would be the wrong response.

---

## 8. Constraints that aren't going away soon

- **No real authentication.** `X-User-Id` is a client-supplied header — do
  not build features that assume identity is trustworthy beyond the demo.
  Microsoft Entra integration is blocked on the user getting tenant access,
  not on more engineering effort. See
  `docs/project-handoff/MICROSOFT-AUTH-HANDOFF.md`.
- **Don't deploy to Vercel serverless as currently built.** The in-memory-
  cache-plus-write-through persistence design requires one continuous
  process. Render/Railway/Fly.io are fine; Vercel functions are not, without
  a larger rewrite. (`api/index.ts` + `vercel.json` exist as a *documented,
  self-aware* demo-only path — it warns about this in its own header
  comment — not as a recommendation.)
- **One dependency CVE is deferred on purpose:** `react-router`/
  `react-router-dom` (high — RSC-mode CSRF, low exposure since this app
  isn't in RSC mode). No forward-compatible patch exists yet as of
  2026-08-06; `npm audit fix --force` would *downgrade* it, not fix it —
  don't run that. (`jspdf`'s critical CVE **is** fixed, 3.0.3→4.2.1. The
  `esbuild`/`drizzle-kit` moderate CVE is dev-toolchain-only, not shipped —
  fixing it needs a breaking `drizzle-kit` 0.31→1.0.0-rc jump, schedule that
  deliberately and re-test `db:generate`/`db:push` against it first.)
- **Keep demo/seed data working.** The user is actively presenting this
  system. Don't remove or disable demo mode, the seed generator, or the
  account launcher without being explicitly asked to.

---

## 9. Conventions

- **Commits land directly on `main`.** Solo, linear history, no PR flow —
  that's the established convention here, not an oversight.
- **Never `--no-verify`, never force-push, never touch `.env`/`.env.*`
  besides `.env.example`.** `.env*` is gitignored except `.env.example`;
  keep it that way.
- **Never run destructive operations against the live Supabase DB**
  (`db:push`, `db:migrate`, or raw SQL against it) **without the user's
  explicit go-ahead first** — it's their live data, and it's currently
  drifted behind the migration files (see `PRODUCTION-PUNCHLIST.md` #5).
- **Grep before assuming you've found every place a field/entity is
  touched.** `server.ts` is one ~7,200-line file; there is no route-per-file
  convention to rely on for "have I found everything."
- **Verify before claiming a fix works.** `npm run lint && npm test && npm
  run build` is the minimum bar after any change; for DB-path or UI changes,
  see §6 and this session's convention of taking a real browser screenshot
  or `curl` output as proof, not just "tests pass."

---

## 10. Where to actually start reading

Primary path:

1. `README.md` — full architecture, tech stack, data model, API reference,
   current status. Read before any non-trivial change.
2. `docs/project-handoff/00-START-HERE.md` — the curated index of what's
   still current in the handoff pack (below) vs. superseded.
3. `docs/project-handoff/PRODUCTION-PUNCHLIST.md` — the single, actively
   maintained source of truth for "what's left before real data." Verify
   against it before trusting an older doc's "still open" claim — it drifts
   less than the others because it gets checked off in-place.
4. `src/lib/api.ts` — the frontend↔server model adapter; read before
   changing any API-backed page or status mapping.
5. `server.ts` — the entire backend. Grep before assuming you've found every
   place a given field or entity is touched.

Full map of `docs/project-handoff/` (all current; `docs/archive/` holds
everything superseded):

| Doc | Read it for |
|---|---|
| `00-START-HERE.md` | The index — what's current, what order to read things in |
| `PRODUCTION-PUNCHLIST.md` | **The** burn-down list before real data — check here first |
| `PROJECT-README.md` | A richer/alternate README variant — cross-check if the two drift |
| `USER-MANUAL.md` (+ `.pdf`) | Role-by-role how-to-use guide, not developer-facing |
| `DATABASE-MIGRATION.md` | Postgres migration status and what's left per domain |
| `MICROSOFT-AUTH-HANDOFF.md` | Exactly what IT needs to supply for real Entra sign-in |
| `HANDOFF-NEXT-STEPS.md` | Session-by-session changelog of what's been resolved and why |
| `REMAINING-BACKEND-GAPS.md` | Mock-vs-real inventory: what's genuinely backed by Postgres vs still process-local |
| `HIERARCHY-SYNC-DESIGN.md` | The simulated Entra org-chart sync — approver changes, stale routing |
| `ANALYTICS-METRIC-CONTRACT.md` | Which financial/workflow measures dashboards and exports must use, and why |

## 11. Common task playbook

| You're about to… | Read this first |
|---|---|
| Add a new domain/table | `src/db/coreLoopRepo.ts` as the pattern to copy; `DATABASE-MIGRATION.md` |
| Change anything about release codes | §5 above, and the block comment above `generateReleaseCode` in `server.ts` |
| Touch upload/download routes | The comment block above `GET /uploads/:filename` in `server.ts` — per-object authorization already exists there |
| Add a repo function's test coverage | `test/db-persistence.test.ts` + `test/helpers/pgMemDb.ts` — the harness works for any repo file, not just `coreLoopRepo.ts` |
| Change a workflow/status transition rule | `server.ts`'s route handler + its guard comment; `test/workflow-guards.test.ts` for the existing regression coverage pattern |
| Touch `schema.ts` | Run `npm run db:generate` after, review the generated `drizzle/*.sql`, never hand-edit a migration that's already been applied anywhere |
| Deploy or change hosting | §8's Vercel constraint; `PRODUCTION-PUNCHLIST.md`'s env-flag list (#4) |
| Wonder "is this already done?" | `PRODUCTION-PUNCHLIST.md` first — it's corrected mid-session more than once when other docs implied something was still open that wasn't |
