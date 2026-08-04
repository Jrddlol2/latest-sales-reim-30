# AGENTS.md

Quick-start for any AI agent (or human) picking up this repo cold. This is a
map to the traps, not a duplicate of the docs — **read `README.md` in full
before making changes**; it has the architecture, tech stack, data model,
API reference, and known limitations. This file exists because a few things
here are easy to get wrong even after reading that.

## You are probably not in the only copy of this project

If your working directory has sibling folders like `app/` or
`latest-sales-reimburse-2926/` next to this one, **those are stale/older
copies from earlier sessions, not alternates to choose between.** This
folder (wherever `AGENTS.md` and `README.md` live together) is the canonical
one. Confirm you're editing here — not a sibling — before trusting any file
search result, and don't assume a preview/dev server is pointed at this copy
without checking its launch config.

## The one architectural nuance that isn't obvious from the code

Every domain (users, claims, cash advances, etc.) persists to a real
Supabase Postgres database — but **reads and writes are split**:

- **Writes always persist.** Every mutating route calls a `persist*()`
  function (in `src/db/*Repo.ts`) in addition to its existing in-memory
  array mutation.
- **Boot-time loading from Postgres only happens when `DEMO_MODE=false`.**
  While `DEMO_MODE=true` (the default, used for presenting), the demo seed
  generator (`seedYearOfData()` in `server.ts`) regenerates fresh randomized
  data in memory on every restart, and real writes land in Postgres in the
  background without being read back.

Full reasoning in README's **Database persistence** section and
`docs/DATABASE-MIGRATION.md`. If you add a new domain or route, follow the
existing pattern (`src/db/coreLoopRepo.ts` is the clearest example) —
`load*FromDb()` gated the same way, `persist*()` called from every mutation.

## Testing a DB-touching change: `npm test` is not enough

The automated suite (`npm test`) never sets `DATABASE_URL`, so it only
exercises the in-memory code paths — it will pass even if your Postgres
persistence code is broken. **Two real bugs shipped past lint, typecheck,
and the full test suite** and were only caught by live-testing against the
actual Supabase database:

1. A fire-and-forget history insert racing ahead of its not-yet-persisted
   parent row (foreign-key violation).
2. An empty-string-vs-`NULL` mapping bug (`?? null` doesn't catch `''`).

If you touch anything in `src/db/*Repo.ts` or a route that calls a
`persist*()` function, verify it against the real database before calling it
done:

```bash
# 1. Confirm DATABASE_URL is set in .env (ask the user for the Supabase
#    session-pooler connection string if it isn't — see README's
#    "Database persistence" section for why session pooler, not direct).
# 2. Run the actual workflow end to end (curl or the browser).
# 3. Query Postgres directly to confirm the row landed correctly — don't
#    trust a 200 response alone.
# 4. If touching a "create" route, restart the server (or run a
#    DEMO_MODE=false standalone boot) and confirm the record is still there.
```

## Constraints that aren't going away soon

- **No real authentication.** `X-User-Id` is a client-supplied header — do
  not build features that assume identity is trustworthy beyond the demo.
  Microsoft Entra integration is blocked on the user getting tenant access,
  not on more engineering effort.
- **Don't deploy to Vercel serverless as currently built.** The in-memory-
  cache-plus-write-through persistence design requires one continuous
  process. Render/Railway/Fly.io are fine; Vercel functions are not, without
  a larger rewrite. See README's hosting note.
- **Two dependency CVEs are deferred on purpose** (`jspdf`, `react-router`)
  to avoid breaking the demo mid-presentation. Don't "fix" these
  unilaterally — both fixes are breaking upgrades; confirm with the user
  first.
- **Keep demo/seed data working.** The user is actively presenting this
  system. Don't remove or disable demo mode, the seed generator, or the
  account launcher without being explicitly asked to.

## Where to actually start reading

1. `README.md` — full architecture and current status.
2. `docs/SYSTEM-AUDIT-2026-08-03.md` — most recent full audit; the other
   `docs/*AUDIT*.md` files are historical, superseded by this one.
3. `src/lib/api.ts` — the frontend↔server model adapter; read before
   changing any API-backed page or status mapping.
4. `server.ts` — the entire backend (~6,200 lines, one file). Grep before
   assuming you've found every place a given field or entity is touched.
