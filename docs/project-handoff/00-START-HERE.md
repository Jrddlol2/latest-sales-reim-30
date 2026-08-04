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

The current baseline is 70 tests across 10 files (2026-08-04 follow-up
session added 3 covering the demo-mode-gated financial fallback).

## Database-change rule

If a change touches `src/db/*Repo.ts` or a route that calls a `persist*()`
function, the automated suite is not enough. It runs without `DATABASE_URL`
and only exercises the in-memory path.

Verify the real workflow against Supabase, query Postgres directly to confirm
the row, and restart with `DEMO_MODE=false` to verify boot-time loading when the
change affects persistence or record creation.

## Current priorities

A 2026-08-04 follow-up session closed items 1, 3, and 4 below (see
[`HANDOFF-NEXT-STEPS.md`](HANDOFF-NEXT-STEPS.md)'s "Resolved this session"
for specifics) while working without Microsoft/Google accounts available —
that's why 2 and 5 are still open: they're blocked on external credentials
(an Entra tenant/app registration; Google Workspace/Gmail), not on
engineering effort.

1. ~~Replace the HTML client-copy preview with the exact generated PDF.~~
   Done — `MomClientPreviewModal.tsx` now renders the real generated PDF.
2. Add real client email and internal Teams delivery with attachments, retries,
   and delivery state. **Still open — blocked on Google Workspace/Gmail and
   an Entra app registration.**
3. ~~Replace the in-memory claim-number counter with an atomic database sequence
   and unique constraint.~~ Done — Postgres sequence + `UNIQUE` constraint,
   in-memory counter kept only for the no-database mode.
4. ~~Make historical imports transactional and durable.~~ Done — one
   Postgres transaction per import batch.
5. Implement Microsoft Entra authentication and server-side sessions.
   **Still open — blocked on an Entra tenant/app registration.**
6. Move uploads to private object storage with record-level authorization.
   **Partially open** — the authorization *rule* is now in place (a file
   only serves to someone who can already see the record it's attached to);
   the storage location itself is still local disk, not object storage.

Also closed this session, not on the original list above: notification
preferences (persisted + enforced), implicit company creation (persisted),
user/master-data audit history (persisted), delegation-expiry persistence
plus an automatic hourly scheduler for stale-approver escalation (previously
manual-only), the frontend's financial-amount fallback (now gated behind
demo mode), and MOM list filter parity with the Claims list. Full detail in
[`REMAINING-BACKEND-GAPS.md`](REMAINING-BACKEND-GAPS.md)'s "Resolved since
this audit" table.

## Documents intentionally excluded

Older audits, roadmaps, production passes, and project-context documents remain
in the parent `docs/` directory but are not copied here because later work has
superseded significant parts of them. In particular, older statements that the
database is not connected are no longer true.

When a handoff document conflicts with the code, the current code wins. When two
documents conflict, use `PROJECT-README.md`, then the newest dated handoff or
gap document.

## Snapshot information

This handoff pack was assembled on 2026-08-04 from repository commit
`f89196b`. The source documents outside this folder were not modified.

