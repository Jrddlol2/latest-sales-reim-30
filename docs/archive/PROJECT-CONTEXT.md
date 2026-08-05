# Project Context — Sales Reimbursement System

Orientation doc for a fresh Claude Code session picking up this project. Read this first;
it carries the mental model and the non-obvious gotchas that aren't visible from the code
alone. For the outstanding work, see `AUDIT.md` (functional gaps) and `PRODUCTION-PASS.md`
(what's needed to run for real).

> **Tip:** to have this auto-load every session, copy it to `app/CLAUDE.md`.

---

## 1. What this project is

A sales-expense reimbursement system (reimbursements, cash advances, liquidations,
minutes-of-meeting, approvals, disbursement). It started as **three zips** in the repo
root:

- `claude.zip` — the **old, working system**: a polished-enough UI plus a real
  **218 KB Express backend** (`server.ts`) with a full in-memory REST API and all the
  workflow rules. This is the **behavioral source of truth**.
- `zip (5).zip` — the **new UI**: a much nicer React front end, but **frontend-only**,
  all state faked in a React context from a mock generator. This is the **look we want**.
- `stitch_enterprise_expense_dashboard (2).zip` — static HTML/PNG **design reference**
  only, no code to port.

**The decision (already made):** keep the new UI as the base, port the old `server.ts`
into it, and rewire the UI from mock context state to real API calls. Re-skinning the old
app was rejected. The working project lives in **`app/`** (git-initialized; the zips are
left untouched as reference).

---

## 2. Architecture — the one thing to understand

The two sides model the domain **differently**, and neither was rewritten to match the
other. A **model adapter** bridges them. This is the single most important concept:

| | Server (`server.ts`) | New UI |
|---|---|---|
| Claim types | 3 **separate entities**: `Claim` (reimbursement), `CashAdvance`, `Liquidation` | **one** `Claim` discriminated by `type` |
| Statuses | 3 separate enums | 1 unified `ClaimStatus` (14 values) |
| Field naming | `snake_case` (`total_amount`, `reports_to`) | `camelCase` (`total`, `reportsTo`) |
| MOM | standalone; claim points at it via `mom_id` | subordinate; points at claim via `claimId` |
| Master data | 6 separate typed catalogs | one array with a `type` discriminator |

**`app/src/lib/api.ts` is the adapter and the only place that speaks both dialects.**
- `loadWorkspace()` fetches ~13 endpoints in parallel and **merges** the three claim-ish
  collections into one unified `Claim[]`, converts snake→camel, and maps statuses.
- The `fromServer*` functions convert inbound; the mutation helpers
  (`decideOnClaim`, `confirmReceipt`, `createMasterData`, …) convert outbound.
- Status mapping is table-driven (`CLAIM_STATUS`, `CASH_ADVANCE_STATUS`,
  `LIQUIDATION_STATUS`) with `toServerStatus()` as the reverse. The reverse needs the
  claim's `type` to disambiguate shared labels (e.g. "Approved").

**`app/src/components/AppContext.tsx`** loads from the server, gates render until data is
in, and exposes it to pages. `updateClaimStatus(claimId, newStatus, changedBy, comment,
updates)` keeps its original signature but now **maps the target status onto whichever
server route owns that transition**, then re-`refresh()`es so the UI shows the
authoritative result (including server side effects like routing and emails).

**Backend layout:** `app/server.ts` (the ported Express app, imports from
`app/src/serverTypes.ts`), runs Vite as middleware. `npm run dev` = `tsx server.ts` on
**port 3000**; it **auto-seeds a year of demo data on startup**.

---

## 3. Auth model (mock — read this before touching security)

Authentication is a single header: **`X-User-Id`**. The client sets it; the server trusts
it. The frontend stores the current identity in `localStorage.mockUserId` and `apiFetch`
attaches it. There are no sessions, tokens, or passwords. This is deliberate for the
prototype and is **P0 #1** in `PRODUCTION-PASS.md` — do not build real features assuming
this is secure.

**To act as a different user** in code or the browser console:
```js
localStorage.setItem('mockUserId', 'u4'); location.reload();
```
Or use the role-switcher dropdown in the top bar (also a production blocker — it's a
one-click privilege escalation).

---

## 4. Gotchas that will waste your time if you don't know them

1. **`POST /api/admin/reset` EMPTIES everything.** It wipes all transactional tables
   (claims, emails, history, support, delegations) and only rebuilds the reference
   catalogs — it does **not** reseed. Calling it alone leaves the app blank. Always follow
   with `POST /api/admin/seed-year` using the full options:
   ```json
   { "options": { "demoClaims": true, "demoCashAdvances": true, "delegations": true, "historicalBackfill": true } }
   ```
   The `resetData()` helper in `AppContext` (the Settings "Generate New Mock Data" button)
   already does both. Just never call reset by itself.

2. **The seed is deterministic** — same user IDs every restart. Reliable test accounts:
   - `u4` = **Admin** (Dave Lopez)
   - `u13` = **Requestor** (Mia Fernandez)
   - `u3` = **Custodian** (Carol Ramos)
   - `u2`, `u14`, `u16`, `u18` = **Approvers**; `u7` (Grace) is often an active delegate.

3. **Restarting the dev server re-seeds fresh** and wipes any test data you created — this
   is fine, nothing is meant to persist (it's all in-memory).

4. **Payout completion is the REQUESTOR's action, not the custodian's.** The backend
   completes a claim only when the requestor quotes the release code the custodian issued
   (`requestor_id` + code match — an anti-fraud control). So: custodian's "Ready to Claim"
   queue is **informational** (shows the code to convey); the requestor confirms via the
   **Confirm Receipt** modal in `ClaimDetail`. Don't move this back to the custodian.

5. **`updateClaimStatus` only maps a subset of statuses.** `Closed` and `Reviewed` are not
   mapped and currently **throw** — that's a known bug (AUDIT #4), not your mistake.

6. **Currency mismatch:** the UI displays `$` but the backend runs in **PHP**. Known
   (PRODUCTION-PASS #6). Don't assume amounts are USD.

7. **`tsconfig` has no `strict` mode** — a reference to a non-existent property can compile
   cleanly. Don't trust a green `tsc` as proof of correctness; verify behavior.

---

## 5. What's wired to the server vs. still mock

> **Updated 2026-07-28** — see `docs/ROADMAP.md`'s status block for the full Phase 1 /
> Phase 1.5 / Phase 2 / Improvements_v2 history. The paragraph below reflects current state,
> not the original baseline.

**Fully server-backed & verified:** the core loop (submit → approve → process → ready →
complete), Approval Queue + Claim Detail inline actions, Delegations (full lifecycle + access
control), MOMs (list + `/moms/:id` detail with real file viewer), Receipt Archive (My/Team
scoping for approvers), Calendar (read), Support, Master Data / Field Definitions / User
Accounts / Company Directory admin (now with contact/email/location), Audit Log, System
Emails, Admin Reporting, Transaction History (real per-row dates), all four dashboards (real
KPIs, no hardcoded numbers), payment-method picker, `/payouts` page.

**Known gaps (see `AUDIT.md` / `ROADMAP.md`):** Historical Import is simulated;
review-meeting responses, resubmit, and stale-approver transfer aren't surfaced yet; Audit
Log / System Emails still paginate client-side only (not server-side); currency still reads
`$` instead of PHP; per-role Notifications isn't wired to `/api/outbox` yet (UI built, not
wired — B15); **Policy Compliance tab doesn't exist** (new scope from user feedback, not yet
designed — needs its own session, not a fold-in to existing work).

**Still on generated data:** `importBatches` (no read endpoint wired). Everything else
moved to the server.

---

## 6. How to run and verify

```bash
cd app
npm install
npm run dev        # Express + Vite on http://localhost:3000, auto-seeds on startup
npx tsc --noEmit   # typecheck (note: not strict)
```

**Working style used so far (worth continuing):** every change is typechecked *and*
exercised in a browser against the real backend before committing — role-switch, drive the
actual UI, and read back server state via the API to confirm the mutation landed. Commits
are descriptive and co-authored. The git history in `app/` is a clean, reviewable
progression (baseline → backend port → adapter → each feature area).

---

## 7. Where things live

```
sales-reimbursement-new-ui/
├─ app/                         ← the working project (git repo)
│  ├─ server.ts                 ← ported Express backend (in-memory, auto-seeds)
│  ├─ src/
│  │  ├─ serverTypes.ts         ← old backend's types (server-side shape)
│  │  ├─ types.ts               ← UI types (unified Claim, camelCase)
│  │  ├─ lib/api.ts             ← THE ADAPTER: transport + model + status mapping + mutations
│  │  ├─ components/AppContext.tsx  ← server-backed global state, updateClaimStatus
│  │  ├─ pages/                 ← requestor/ approver/ custodian/ admin/ shared/
│  │  └─ components/layout/     ← Sidebar, Topbar (has the dev role switcher)
│  └─ package.json              ← dev = tsx server.ts
├─ AUDIT.md                     ← 19 functional findings by severity + what's solid
├─ PRODUCTION-PASS.md           ← 23 production-readiness items (P0/P1/P2)
├─ PROJECT-CONTEXT.md           ← this file
├─ claude.zip / zip (5).zip / stitch_*.zip   ← original inputs (reference, untouched)
```

---

## 8. Suggested first move

The four 🔴 Broken AUDIT items (Cash Advance/Liquidation submission, Historical Import,
Liquidation close) are long since fixed — don't start there. As of 2026-07-28, pick up
`docs/ROADMAP.md`'s M3 (review-meeting loop, resubmit, stale-approver transfer, per-role
notifications wiring) or scope the new **Policy Compliance tab** as its own session. The
highest-value production move is still **real auth + removing the role switcher**
(PRODUCTION P0 #1–2) if the work calls for a hardening lens instead of features.
