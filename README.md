# Sales Reimbursement System

A sales-expense reimbursement platform for a mid-size org: reimbursements, cash advances,
liquidations, minutes-of-meeting (MOM), multi-role approvals, and disbursement — with a
full admin console (master data, field definitions, company directory, audit log, system
email log, reporting) on top. A polished React front end on a ported Express backend that
holds all state in memory and auto-seeds a year of realistic demo data on every startup.

> **Prototype status.** The backend is in-memory (state is lost on restart) and
> authentication is a mock `X-User-Id` header — good enough to demo every workflow
> end-to-end, not yet safe for real employee or finance data. See
> [Production readiness](#production-readiness) below and
> [`docs/PROTOTYPE-AUDIT.md`](docs/PROTOTYPE-AUDIT.md) for the current, authoritative
> gap list.
>
> **Looking for how to *use* the app?** See [`docs/USER-MANUAL.md`](docs/USER-MANUAL.md) —
> this README is the technical/developer doc.

---

## Table of contents

- [What it does](#what-it-does)
- [Roles](#roles)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Core workflows](#core-workflows)
- [Testing](#testing)
- [Deployment](#deployment)
- [Production readiness](#production-readiness)
- [Documentation index](#documentation-index)

---

## What it does

- **Reimbursements** — submit a Minutes-of-Meeting record first, then itemized expenses
  (date, category, vendor, payment method, amount, receipt), route through the requestor's
  manager for approval, then to a custodian for disbursement, and back to the requestor to
  confirm receipt with a release code.
- **Cash Advances** — request funds up front for an upcoming expense; approve → release →
  liquidate later.
- **Liquidations** — settle a cash advance against actual spend; the system computes the
  variance (settled / refund due / reimbursement due) automatically.
- **Minutes of Meeting (MOM)** — a first-class record (client, purpose, discussion,
  agreements, action items, custom admin-defined fields), either filled from a template or
  uploaded as a file; every reimbursement is anchored to one.
- **Review meetings** — a reimbursement submission proposes a review meeting with the
  approver; the approver can confirm, decline (with a reason), or the requestor can propose
  a new time.
- **Delegations** — an approver can delegate their approval authority to a peer for a date
  range (e.g. while on leave); claims route to the delegate automatically while active.
- **Org-change / stale-approver handling** — if a requestor's manager changes while a claim
  is still pending, the claim is flagged stale for the *old* approver, who can transfer it
  to the new one (or an admin can reassign/escalate it).
- **Admin console** — user accounts & org chart, six master-data catalogs (departments,
  cost centers, business units, branches, project codes, vendors), admin-configurable
  dynamic form fields, company directory, historical CSV import, reporting/analytics, an
  immutable audit log, and the full system email log.
- **Support helpdesk** — in-app tickets with a threaded reply log, tied to any
  claim/advance/liquidation.

Money renders as Philippine Pesos (₱) throughout — the backend has always modeled the
domain in PHP.

## Roles

| Role | What they do |
|---|---|
| **Requestor** | Submits reimbursements/advances/liquidations, tracks their status, confirms payout receipt, resubmits returned claims. |
| **Approver** | Reviews their direct reports' submissions (approve / reject / return with a comment), confirms review meetings, can delegate approval authority. Also a Requestor for their own claims. |
| **Custodian** | Processes approved claims: generates a release code, records the payment method, marks a claim Ready for Claim, collects liquidation refunds. |
| **Admin** | Owns master data, user accounts/org chart, field definitions, company directory, historical import, reporting, the audit log, and system emails. |

## Tech stack

- **Frontend:** React 19, React Router 7, Tailwind CSS 4, Vite 6, Recharts (admin reporting
  only, code-split — see [Architecture](#architecture))
- **Backend:** Express 4, in-memory data (no database yet — see
  [`docs/DATABASE-MIGRATION.md`](docs/DATABASE-MIGRATION.md)), `helmet` + `cors` for basic
  HTTP hardening
- **Language/tooling:** TypeScript, `tsx` for dev, `esbuild` for the server bundle
- **Testing:** Vitest — unit tests for the model adapter, an e2e smoke test of the core
  claim lifecycle against the real Express app
- **DB tooling (schema-ready, not wired in yet):** Drizzle ORM + `pg`, targeting Postgres

## Getting started

**Prerequisites:** Node.js 18+

```bash
npm install
npm run dev        # Express + Vite on http://localhost:3000, auto-seeds a year of demo data
npm run lint        # tsc --noEmit (note: not strict mode — see Gotchas below)
npm test             # Vitest — unit tests + the core-loop smoke test
```

Open `http://localhost:3000` — you'll land on an account picker (`Login.tsx`), grouped by
role. Click any account to sign in as them; there are no passwords (see
[Production readiness](#production-readiness)). "Sign out" in the top bar returns you to
the picker so you can switch identities.

**Useful seed accounts** (same every restart — the seed is deterministic):

| id | Name | Role |
|---|---|---|
| `u4` | Dave Lopez | Admin |
| `u1` | Alice Reyes | Requestor |
| `u2` | Bob Santos | Approver (Alice's manager) |
| `u3` | Carol Ramos | Custodian |

## Architecture

**The one thing to understand:** the server and the UI model the domain *differently*, and
neither was rewritten to match the other — a model adapter bridges them.

| | Server (`server.ts`) | Front end |
|---|---|---|
| Claim types | 3 separate entities: `Claim` (reimbursement), `CashAdvance`, `Liquidation` | one `Claim`, discriminated by `type` |
| Statuses | 3 separate enums | 1 unified `ClaimStatus` |
| Field naming | `snake_case` (`total_amount`, `reports_to`) | `camelCase` (`total`, `reportsTo`) |
| MOM | standalone; a claim points at it via `mom_id` | subordinate; conceptually tied to its claim |
| Master data | 6 separate typed catalogs | one array with a `type` discriminator |

**`src/lib/api.ts` is the adapter — the only file that speaks both dialects.**
`loadWorkspace()` fetches every collection in parallel, merges the three claim-ish
collections into one unified `Claim[]`, converts snake_case → camelCase, and maps each
entity's own status enum onto the unified `ClaimStatus` (table-driven —
`CLAIM_STATUS`/`CASH_ADVANCE_STATUS`/`LIQUIDATION_STATUS`, with `toServerStatus()` as the
reverse). `fromServer*` functions convert inbound; the mutation helpers
(`decideOnClaim`, `confirmReceipt`, `createMasterData`, …) convert outbound.

`src/components/AppContext.tsx` loads from the server once, gates rendering until data is
in, and exposes it to every page. `updateClaimStatus(...)` keeps one call signature but
internally maps the target status onto whichever server route actually owns that
transition, then re-`refresh()`es so the UI reflects the authoritative server result
(including side effects like re-routing and emails).

**Identity** is a single header, `X-User-Id`, set by the client from `localStorage` and
trusted as-is by the server — no sessions, tokens, or passwords. `getUser(req)` is the one
function every route derives identity through (except the `/uploads/:filename` static
route, which also accepts a `?uid=` query param since browsers don't attach custom headers
to `<img>` loads). This single seam is deliberate prep for swapping in real Microsoft Entra
ID sign-in later — see [Production readiness](#production-readiness).

**Code-splitting:** every route below the app shell (`Layout`) is `React.lazy`-loaded
except the two dashboards (they're the landing page for every role, so lazy-loading them
would just move the wait, not remove it). `recharts` — a large dependency — is isolated to
the one admin reporting route that needs it, so nobody else's bundle pays for it.

**Fonts** load from the Google Fonts CDN (Hanken Grotesk, JetBrains Mono, Material
Symbols) — by design, not an oversight; self-hosting was tried and reverted.

## Project structure

```
app/
├─ server.ts                     ← Express backend (in-memory, auto-seeds); exports createApp()
├─ api/index.ts                  ← Vercel serverless entry point (drives createApp())
├─ vercel.json                   ← Vercel build + routing config
├─ vitest.config.ts              ← test runner config
├─ drizzle.config.ts             ← Drizzle Kit config (schema → migrations)
├─ drizzle/                      ← generated SQL migrations (not applied to any DB yet)
├─ src/
│  ├─ serverTypes.ts             ← server-side entity shapes (snake_case)
│  ├─ types.ts                   ← UI-side entity shapes (unified Claim, camelCase)
│  ├─ lib/
│  │  ├─ api.ts                  ← THE ADAPTER: transport + model + status mapping + mutations
│  │  ├─ api.test.ts             ← unit tests for the adapter
│  │  ├─ money.ts                ← single source of truth for PHP currency formatting
│  │  └─ date.ts                 ← date/time formatting helpers
│  ├─ db/
│  │  ├─ schema.ts               ← Drizzle table definitions (25 tables, mirrors serverTypes.ts)
│  │  └─ index.ts                ← Drizzle client factory (unused until DATABASE_URL exists)
│  ├─ components/
│  │  ├─ AppContext.tsx          ← server-backed global state
│  │  ├─ layout/                 ← Sidebar (role-scoped nav), Topbar, Layout
│  │  ├─ shared/                 ← cross-role widgets (action buttons, modals, empty/error states)
│  │  └─ ui/                     ← design-system primitives (Button, Card, Input, Pagination, …)
│  └─ pages/
│     ├─ requestor/, approver/, custodian/, admin/   ← role-specific pages
│     └─ shared/                 ← pages every role can reach (claims, MOMs, settings, support, …)
├─ test/
│  └─ core-loop.smoke.test.ts    ← e2e smoke test: submit → approve → process → ready → complete
└─ docs/
   ├─ USER-MANUAL.md             ← how to use the app, by role
   ├─ PROJECT-CONTEXT.md         ← orientation & gotchas for a fresh dev session — read first
   ├─ PROTOTYPE-AUDIT.md         ← current, authoritative findings + prioritized backlog
   ├─ DATABASE-MIGRATION.md      ← persistent-DB migration status (schema done, wiring pending)
   ├─ AUDIT.md / PRODUCTION-PASS.md / ROADMAP.md   ← earlier-session docs, partially superseded
   │                                                  (see PROTOTYPE-AUDIT.md's "Doc hygiene" note)
   └─ hierarchy-sync-design.md   ← the org-change / stale-approver design
```

## Core workflows

**The reimbursement loop:** `Draft → Pending Approval → Processing → Ready for Claim →
Completed` (or `Rejected` / `Returned for Revision` at the approval step). A submission
proposes a review meeting with the approver in the same step. Full step-by-step in
[`docs/USER-MANUAL.md`](docs/USER-MANUAL.md).

**Cash advance:** `Draft → Submitted → Approved → Released → Liquidated`.

**Liquidation:** `Draft → Submitted → Reviewed → Closed` (or `Returned for Revision`); the
custodian collects a refund if `RefundDue`, or a follow-up reimbursement claim is
auto-created if `ReimbursementDue`.

Server-side business rules are enforced on the server, not just the UI — a requestor can
never approve their own claim (segregation of duties), a receipt is required before
submission, and every action is authorization-checked against `getUser(req)`.

## Testing

```bash
npm test              # vitest run — unit tests + e2e smoke test
```

- **`src/lib/api.test.ts`** — the model adapter: snake↔camel conversion, status-table
  mapping in both directions, ref-number generation, purpose-fallback chains.
- **`test/core-loop.smoke.test.ts`** — spins up the real Express app on an ephemeral port
  (no mocks) and drives a reimbursement through every status transition, plus two
  negative-path checks (wrong approver, wrong release code).

CI (`.github/workflows/ci.yml`) runs lint, test, and build on every push/PR to `main`.

## Deployment

### Render

This is the project's primary deploy target (`sales-reimbursement.onrender.com`). Standard
Node web service: `npm install && npm run build`, start command `npm start`.

### Vercel

Also configured via [`vercel.json`](vercel.json):
- The Vite frontend builds via `npm run vercel-build` and serves as static assets.
- `/api/*` and `/uploads/*` route to one serverless function
  ([`api/index.ts`](api/index.ts)) running the full Express app from `server.ts`.

```bash
vercel            # preview
vercel --prod     # production
```
Or import the repo at vercel.com — no extra build config needed.

> **Demo-deploy caveats (by design, not bugs):**
> - **State does not persist.** In-memory backend — every cold start (serverless) or
>   restart re-seeds fresh, and concurrent instances don't share state. See
>   [`docs/DATABASE-MIGRATION.md`](docs/DATABASE-MIGRATION.md).
> - **Uploads don't persist** on serverless (read-only filesystem outside `/tmp`).
> - **Auth is mock** — anyone can sign in as anyone from the account picker; there's no
>   real credential check.
>
> Good enough to click through every flow with a client or stakeholder; not for real data.

## Production readiness

Current scorecard (full detail in
[`docs/PROTOTYPE-AUDIT.md`](docs/PROTOTYPE-AUDIT.md)):

| Dimension | Grade |
|---|---|
| Functional completeness | A− |
| UX & flows | A− |
| Code quality / maintainability | C |
| Security | D+ |
| Testing / CI | now wired — was F |
| Production readiness | D |

**The gap, in order of what actually blocks going live:**
1. **Persistent database** — schema and migrations exist
   ([`docs/DATABASE-MIGRATION.md`](docs/DATABASE-MIGRATION.md)), not yet wired into
   `server.ts`. Needs a `DATABASE_URL`.
2. **Real authentication** — target is Microsoft Entra ID / Office 365 sign-in
   (`docs/PROTOTYPE-AUDIT.md`'s "Target integration" section has the full plan). Backend
   prep is done: the identity join keys (`entra_object_id`, `user_principal_name`) already
   exist on every user record, and `getUser()` is the one seam that needs to change.
3. **File storage** — uploads land on local disk with only a login check, not a
   per-resource ownership check.
4. **Observability** — no structured logging, error tracking, or health endpoints yet.

None of this blocks demoing the product — it blocks trusting it with real employee or
finance data.

## Documentation index

| Doc | What it's for |
|---|---|
| [`docs/USER-MANUAL.md`](docs/USER-MANUAL.md) | How to use the app, written per role — start here if you're not a developer. |
| [`docs/PROJECT-CONTEXT.md`](docs/PROJECT-CONTEXT.md) | Orientation for a fresh dev session — architecture, gotchas, where things live. |
| [`docs/PROTOTYPE-AUDIT.md`](docs/PROTOTYPE-AUDIT.md) | Current, authoritative findings and the prioritized backlog (supersedes the three below). |
| [`docs/DATABASE-MIGRATION.md`](docs/DATABASE-MIGRATION.md) | Persistent-database status: what's built, what's left, in what order. |
| [`docs/hierarchy-sync-design.md`](docs/hierarchy-sync-design.md) | How the org-change / stale-approver simulation works. |
| `docs/AUDIT.md`, `docs/PRODUCTION-PASS.md`, `docs/ROADMAP.md` | Earlier-session docs — partially stale; see PROTOTYPE-AUDIT.md's doc-hygiene note before trusting a checkbox in these. |
