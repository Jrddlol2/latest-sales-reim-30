# Project handoff — start here

This folder is the curated handoff pack for the Sales Reimbursement System.
It contains only the documents that are still relevant to understanding,
running, maintaining, and finishing the current system.

The original Markdown files outside this folder were intentionally left
untouched as historical references and backups.

## Five-minute orientation

1. This is a React 19 application served by one Express process from
   `server.ts`.
2. Supabase Postgres persistence is implemented through Drizzle repositories in
   `src/db/`.
3. Routes still read from in-process arrays. Writes go through to Postgres, and
   production-mode boot loads those arrays from Postgres.
4. That architecture requires one persistent Node process. Do not deploy it to
   Vercel serverless without first replacing the process-local read cache.
5. Demo identity is not authentication. The API still trusts `X-User-Id` until
   Microsoft Entra OIDC and server sessions are implemented.
6. Email and Teams delivery are mocked. Uploaded files are stored on local disk.
7. Keep `DEMO_MODE=true` and the seed generator working while the system is
   still being presented.

## Reading order

| Order | Document | Why to read it |
|---:|---|---|
| 1 | [`PROJECT-README.md`](PROJECT-README.md) | Full current architecture, workflows, routes, data model, configuration, testing, and known limitations. |
| 2 | [`HANDOFF-NEXT-STEPS.md`](HANDOFF-NEXT-STEPS.md) | The exact work left after the latest UI and workflow changes. |
| 3 | [`REMAINING-BACKEND-GAPS.md`](REMAINING-BACKEND-GAPS.md) | Prioritized inventory of mock, non-durable, and production-backend gaps with code evidence. |
| 4 | [`DATABASE-MIGRATION.md`](DATABASE-MIGRATION.md) | The Postgres write-through/boot-load design, completed migration work, and database-specific open items. |
| 5 | [`MICROSOFT-AUTH-HANDOFF.md`](MICROSOFT-AUTH-HANDOFF.md) | Inputs required from IT and the Entra OIDC/session implementation checklist. |
| 6 | [`USER-MANUAL.md`](USER-MANUAL.md) | Role-by-role product usage and operational workflows. |

Read these when working in the corresponding area:

- [`HIERARCHY-SYNC-DESIGN.md`](HIERARCHY-SYNC-DESIGN.md) — reporting-line
  changes, stale approvers, delegation, and escalation.
- [`ANALYTICS-METRIC-CONTRACT.md`](ANALYTICS-METRIC-CONTRACT.md) — financial
  metric definitions that dashboards and exports must preserve.

## Safe local start

```powershell
npm install
npm.cmd run dev
```

Open `http://127.0.0.1:3000/`.

Before handing off a code change:

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

The current baseline is 87 tests across 12 files (grown from 70 across three
2026-08-05 sessions — see `HANDOFF-NEXT-STEPS.md`'s "Resolved 2026-08-05"
sections for what each batch added).

## Database-change rule

If a change touches `src/db/*Repo.ts` or a route that calls a `persist*()`
function, the automated suite is not enough. It runs without `DATABASE_URL`
and only exercises the in-memory path.

Verify the real workflow against Supabase, query Postgres directly to confirm
the row, and restart with `DEMO_MODE=false` to verify boot-time loading when the
change affects persistence or record creation.

## Current priorities

Three sessions across 2026-08-04 and 2026-08-05 closed most of what's
engineering-effort-only. What's left breaks into two very different kinds of
"open":

**Blocked on external accounts this environment doesn't have** (not on
engineering effort):
1. Real client email (Gmail/Workspace) and internal Teams delivery.
2. Microsoft Entra authentication and server-side sessions — the API still
   trusts `X-User-Id`.
3. Private object storage for uploads (Supabase Storage/S3 credentials) —
   the download *authorization* rule is done; files still live on local disk.

**Needs a decision only the client/product owner can make** (found 2026-08-05,
see `HANDOFF-NEXT-STEPS.md`'s "Resolved 2026-08-05 (continued)" for detail):
4. The connected Supabase database's `claims` table has 252 of 254 rows with
   duplicate `claim_number` values (accumulated demo-seed writes across many
   dev-server restarts) — this blocks applying the `UNIQUE` constraint from
   migration 0004 until someone decides how to handle the duplicates
   (deleting demo pollution vs. investigating further). The sequence itself
   is safe to create and was floored above the current max.
5. Migrations 0004 and 0005 (claim-number sequence, `companies.pending_review`
   columns) are still **not applied** to the live database — needs
   `npm run db:migrate` run by someone with authority over that live,
   shared data.
6. `DEMO_MODE=false` hasn't been flipped — the live database's reference
   data (field definitions, the six master-data catalogs) is nearly empty,
   so flipping it today would boot the app with empty Category/Type of
   Account/cost-center/department dropdowns. Needs that reference data
   seeded for real first.

Structural/operational hardening (rate limiting, health/readiness endpoints,
self-hosted fonts + CSP, structured request logging, the `jspdf` critical
CVE) and the shared FilterBar/CompanyPicker UI work are done — see
`HANDOFF-NEXT-STEPS.md` and `REMAINING-BACKEND-GAPS.md` for full detail on
all of the above.

## Documents intentionally excluded

Older audits, roadmaps, production passes, and project-context documents were
moved to `docs/archive/` (2026-08-05) rather than copied here, because later
work has superseded significant parts of them. In particular, older
statements that the database is not connected are no longer true. They're
kept as historical reference, not deleted — `git log` on any of them still
shows their full history from before the move.

When a handoff document conflicts with the code, the current code wins. When two
documents conflict, use `PROJECT-README.md`, then the newest dated handoff or
gap document.

## Snapshot information

This handoff pack was assembled on 2026-08-04 from repository commit
`f89196b`, then updated across three 2026-08-05 sessions (test-suite
hermeticity + dynamic-field validation + migration tooling; unlisted-company
dedup; rate limiting/health checks/CSP/logging/FilterBar/`jspdf` CVE fix).
The archived documents in `docs/archive/` were not modified.

