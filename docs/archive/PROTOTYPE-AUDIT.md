# Sales Reimbursement — Prototype Audit & Backlog

**Date:** 2026-07-28
**Scope:** Full sweep of the `app/` codebase after the Wave A/B/C feature passes.
**Method:** Code read + live API/browser verification of every workflow.

This is a fresh, honest assessment of the whole prototype — a rating, what's
strong, what's missing, what's dead weight, and a prioritized plan of what to
do next. It supersedes the status blocks in `AUDIT.md` / `PRODUCTION-PASS.md` /
`ROADMAP.md`, several of which are now stale (see [Doc hygiene](#doc-hygiene)).

---

## TL;DR

**As a prototype / demo: strong — roughly an A‑ (8/10).** Nearly every workflow
the backend supports is now actually wired and verified end‑to‑end: the core
loop, cash advances, liquidations, MOMs, delegations, the review‑meeting
scheduling loop, revise‑&‑resubmit, the stale‑approver / org‑change system,
per‑role notifications, and PHP currency throughout. The UI is polished and
coherent. For showing the domain and the flows to stakeholders, it's in good
shape.

**As a production system: not ready — roughly a D (3/10), by design.** It still
runs entirely on in‑memory arrays behind `X‑User‑Id` header trust, with local
disk file storage, zero automated tests, no persistent database, and no
observability. These are known and intentional for a prototype, but they are
real and load‑bearing — nothing below the "demo" line should be treated as safe
for real employees or finance data yet.

**Target: this will connect to Office 365 accounts.** That decision reshapes the
production tier — auth becomes Microsoft Entra ID (Azure AD) sign‑in, email
becomes Microsoft Graph, and the org‑chart the app already simulates maps onto
Entra's real manager hierarchy. See
[Target integration: Office 365 / Microsoft Entra ID](#target-integration-office-365--microsoft-entra-id)
for the backend prep this needs; it drives Phase 3 below.

The gap between those two grades is the entire backlog below.

### Scorecard

| Dimension | Grade | One‑line |
|---|---|---|
| Functional completeness | **A‑** | Almost every backend capability is now surfaced and verified |
| Data integrity / "truthfulness" | **B** | Dashboards & currency are real now; a few fabricated cards remain |
| UX & flows | **A‑** | Clean, consistent, discoverable; a couple of dead controls linger |
| Accessibility | **C+** | aria‑labels + focus states partly done; no full WCAG pass |
| Code quality / maintainability | **C** | 4,969‑line server monolith, no `strict`, 17 scratch files in root |
| Security | **D+** | Prototype‑hardened (helmet/CORS/login gate) but header‑trust at core |
| Testing / CI | **F** | Zero tests, no CI |
| Production readiness | **D** | No DB, no real auth, no storage, no observability |

---

## What's working well (keep / don't touch)

- **The model adapter (`src/lib/api.ts`).** The snake↔camel + 3‑entities‑into‑one
  `Claim` + status‑mapping bridge is the smartest part of the codebase and has
  held up across every feature added on top of it. It's the one file most worth
  protecting with tests.
- **The core reimbursement loop**, submit → approve → process → ready → complete,
  with the two‑party release‑code payout control, is solid and verified.
- **Workflow depth is now surfaced**, not just present in the backend:
  delegation lifecycle, review‑meeting confirm/decline/reschedule, revise‑&‑
  resubmit, stale‑approver transfer/reassign/fallback. These were the biggest
  untapped pieces and they now work end‑to‑end.
- **Truthful dashboards & PHP currency.** No hardcoded KPI literals remain on the
  dashboards, and money renders through one `formatMoney()` helper.
- **Server‑enforced business rules** (segregation of duties, receipt‑required,
  claim‑scoped authorization) are real and defended server‑side, not just in the
  UI.

---

## Findings

Grouped by severity/type. Each item notes the concrete location and the fix.

### 🔴 Data integrity — fabricated UI still presented as real

*The audit's original sin was "screens that look live but show invented data."
Most are fixed; these three survived every pass and should go next.*

1. **Claim Detail "Policy Compliance" card is 100% fake.**
   `src/pages/shared/ClaimDetail.tsx:289‑303` renders a hardcoded
   "Flight Class ✓ / Per Diem Meal ⚠" panel on **every** claim, unrelated to the
   actual claim's data. It reads as a real per‑claim compliance check and is
   pure decoration. **Fix:** either drive it from real policy rules (see the
   Policy Compliance feature below) or remove the card until that exists.

2. **Requestor dashboard "Policies & Guidelines" is static + stale + wrong currency.**
   `src/pages/requestor/RequestorDashboard.tsx:170‑185` hardcodes
   *"Meal Allowance Cap — Daily limit increased to **$65.00** effective Oct 1st."*
   It's fake copy, dated, and still in `$` (the one money string the PHP pass
   couldn't catch because it's prose, not a formatted amount). **Fix:** pull from
   real admin‑configured policy/master data, or remove.

3. **Settings → Notifications & Security tabs don't persist.**
   `src/pages/shared/Settings.tsx:282,327` still carry `// TODO(claude): persist
   settings` — the toggles and password fields render but save nowhere (they
   fire a success toast). A control that claims success without effect is the
   exact rot the audit set out to kill. **Fix:** wire to a real per‑user settings
   endpoint, or clearly mark the tabs "coming soon" until then.

### 🟠 Missing / half‑done features

4. **No real Policy Compliance engine.** Flagged as new scope in the roadmap and
   still absent. Both fake cards above are placeholders for it. A small
   admin‑editable rules set (per‑category caps, required fields, flight class)
   evaluated against a claim would retire findings #1–#2 and add genuine value.

5. **Server‑side pagination never landed.** `Audit Log` truncates to
   `filtered.slice(0, 500)` (`AuditLog.tsx:95`) and `System Emails` to
   `.slice(0, 300)` (`SystemEmails.tsx:73`) **in the browser**, after fetching
   everything. At demo volume (~2,830 audit rows, ~1,851 emails) `loadWorkspace`
   already pulls it all on every mutation. Everything that *is* paginated is
   client‑side `.slice()`. This is `PRODUCTION‑PASS #8` and it's still fully open.
   **Fix:** push `page`/`pageSize`/filter to query params on the heavy routes.

6. **Pages still with no pagination at all:** `MasterData`, `FieldDefinitions`,
   `Support`, `ProcessingQueue`, `ApprovalQueue`. Fine at demo size, will bite at
   scale.

7. **"Export PDF" is `window.print()`.** `ClaimDetail.tsx:123`. Not a real
   document. `PRODUCTION‑PASS #21`. **Fix:** server‑side PDF, or relabel to "Print".

8. **Custodian gets zero notifications in demo data.** Not a wiring bug — the
   live `/approve` route *does* email the custodian — but the seeded year of
   historical‑backfill claims bypasses `sendEmail()` entirely, so Carol's inbox
   is empty out of the box and the notifications feature looks broken for that
   role. **Fix:** have the backfill seeder emit the same notifications a live run
   would (or a representative sample).

### 🟡 Code quality & technical debt

9. **17 scratch codemod files committed to the repo root.**
   `clean_receipts.cjs`, `fix_brace.cjs`, `fix_buttons.cjs`, `fix_claim.cjs`,
   `fix_claim2.cjs`, `fix_company.cjs`, `fix_confirm.cjs`, `fix_emails.cjs`,
   `fix_other_buttons.cjs`, `fix_receipts_clean.cjs`, `fix_receipts_final.cjs`,
   `fix_receipts_portal.cjs`, `fix_receipts_proper.cjs`, `fix_settings.cjs`,
   `fix_support.cjs`, `use_portals.cjs`, `update_submit.js`, `update_width.js`.
   These are one‑off migration scripts from earlier UI surgery. **Remove them
   all** — they're pure noise and imply the repo is messier than it is.

10. **`server.ts` is a 4,969‑line monolith.** Every route, the seeder, the email
    mock, and all business logic live in one file. It works, but it's the single
    biggest maintainability risk. **Fix (incremental):** split by domain
    (claims / cash‑advances / liquidations / admin / seed / email) into modules
    behind the same `createApp()`.

11. **TypeScript `strict` is off** (`tsconfig.json` has no `strict` flag). During
    the port a reference to a non‑existent property compiled clean; this session
    hit the same class twice (`currentApproverId` vs `approverId`, missing
    `Completed` enum). `PRODUCTION‑PASS #11`. **Fix:** enable at least
    `strictNullChecks` + `noImplicitAny`, fix the fallout, keep `tsc` green.

12. **Unused dependencies shipping in the bundle.**
    `@google/genai`, `lucide-react`, `motion`, and both `@fontsource/*` packages
    have **0 imports** in `src/`. **Remove them.** (`PRODUCTION‑PASS #20`.)

13. **Fonts load from the Google CDN at runtime** (`index.html:8‑11`: Hanken
    Grotesk, JetBrains Mono, Material Symbols). Third‑party request on every page
    load — privacy, offline, and reliability cost. **Fix:** self‑host (the
    `@fontsource` packages were meant for exactly this before being left unused).

14. **931 KB JS bundle** (257 KB gzipped), single chunk — the build warns about
    it. **Fix:** route‑level `React.lazy` code‑splitting; `recharts` alone is a
    big chunk only the admin/reporting pages need.

15. **`X‑Powered‑By`/`X‑User‑Id` mock‑auth is threaded through everything.** Not
    "debt" so much as the central architectural assumption — noted here because
    every security item below traces back to it.

### 🔵 Production blockers (the launch‑gating tier)

*None of these are bugs; they're the "safe to put in front of finance" gap.*

16. **No persistent database.** All state is module‑level arrays (`let claims =
    []`, ~25 of them). A restart, crash, or second instance = total data loss;
    `POST /api/admin/reset` literally empties everything. `PRODUCTION‑PASS #3`,
    `P0`. This is the top blocker — nothing else is trustworthy until it lands.

17. **No real authentication.** `X‑User‑Id` header trust: anyone can be anyone,
    including Admin, by changing one string. The Wave C login gate adds friction
    but not security (still no password, still header trust underneath).
    `PRODUCTION‑PASS #1`, `P0`. **→ Target fix is Office 365 / Entra ID sign‑in —
    see the [O365 section](#target-integration-office-365--microsoft-entra-id).**

18. **File storage is local disk with weak access control.** Uploads land in
    `uploads/` and the gate only checks *that* a user is logged in, not that
    they're allowed to see *that* file. `PRODUCTION‑PASS #4`, `P0`.

19. **No automated tests, no CI.** Zero `.test`/`.spec` files. The `lib/api.ts`
    adapter and the core submit→approve→disburse loop are exactly where silent
    drift happens and there's nothing guarding them. `PRODUCTION‑PASS #12`.

20. **No React error boundary.** One thrown error white‑screens the whole app;
    `App.tsx` has no boundary. `PRODUCTION‑PASS #9`. (The `ErrorFallback`
    component was designed in the roadmap but never wired.)

21. **No observability.** No structured logging, error tracker, or
    `/healthz`/`/readyz` endpoints — `render.yaml` exists but has nothing to
    probe. `PRODUCTION‑PASS #19`.

22. **Mock email transport.** `console.log('--- MOCK EMAIL TRANSPORT ---')` — the
    templates are production‑quality (already SharePoint/Outlook‑styled), the
    delivery is not. `PRODUCTION‑PASS #10`. **→ Target fix is Microsoft Graph
    `sendMail` — see the [O365 section](#target-integration-office-365--microsoft-entra-id).**

### ⚪ Polish / nice‑to‑haves

23. **`updateClaimStatus` in `AppContext` refetches the entire workspace** (all
    ~13 endpoints) after every mutation. Targeted refetch would make the app feel
    much snappier. `PRODUCTION‑PASS #14`.
24. **No live queue/badge counts.** The new sidebar/bell badges only update on
    navigation or refresh; polling or SSE would make them live. `PRODUCTION‑PASS #15`.
25. **No bulk actions** for approvers/custodians clearing a backlog. `PP #18`.
26. **Date formatting is inconsistent** (`toLocaleString` vs `toLocaleDateString`,
    timezones unpinned). `PRODUCTION‑PASS #23`.
27. **Full accessibility pass** (dense‑table scroll containers on mobile, modal
    keyboard nav, remaining contrast checks) is only partly done. `PP #16`.

---

## What to remove

A concrete "delete list" — everything here is safe to drop and reduces noise:

- **All 17 root scratch files** (finding #9) — `fix_*.cjs`, `update_*.js`,
  `clean_receipts.cjs`, `use_portals.cjs`.
- **Unused deps** (finding #12): `@google/genai`, `lucide-react`, `motion`,
  `@fontsource/hanken-grotesk`, `@fontsource/jetbrains-mono` — unless #13
  (self‑host fonts) revives the fontsource packages, in which case keep those two.
- **The two fabricated cards** (findings #1, #2) until backed by a real policy
  engine.
- **`src/data.ts` mock leftovers** — only `mockImportBatches` is still imported
  (`AppContext.tsx:3`), because `importBatches` has no read endpoint. Either wire
  the endpoint or drop the mock and the field.

---

## Target integration: Office 365 / Microsoft Entra ID

**Decision:** this system will run against the organization's **Office 365 /
Microsoft Entra ID (Azure AD)** accounts. This is the intended home for several
of the production‑blocker items above — it's not a separate feature bolted on,
it's *how* auth, directory, and email should be done for real. The good news:
the backend was **designed with this in mind** (the email templates are already
SharePoint/Outlook‑styled, and the org‑change / stale‑approver system is a
faithful simulation of an Entra ID "hierarchy sync"), so this is wiring a real
provider into slots that already exist — not a redesign.

### What "connect to O365" means concretely

Four distinct Microsoft integrations, in dependency order:

**1. Authentication — Entra ID sign‑in (OIDC / OAuth 2.0)** *(replaces finding #17)*
- Register the app in **Entra ID** (App Registration): get a **Tenant ID**,
  **Client ID**, and a **client secret or certificate**; configure the SPA/web
  **redirect URIs**.
- Add a real sign‑in flow (MSAL — `@azure/msal-browser` on the front end and/or
  `@azure/msal-node` server‑side for the auth‑code flow). This **replaces the
  Wave C `Login.tsx` mock gate** and the `X‑User‑Id` header entirely.
- Server‑side: **validate the Entra JWT** on every request (signature, issuer,
  audience, tenant), then derive the user from the validated token's `oid` —
  never from a client‑set header. This is the actual fix for `getUser()`.
- Scopes to start: `openid profile email User.Read`.

**2. Directory / user + manager sync — Microsoft Graph** *(feeds the existing hierarchy model)*
- Pull users, job titles, departments, and — critically — the **manager
  relationship** from Graph (`GET /users`, `GET /users/{id}/manager`). The app's
  `reports_to` field **is** the Entra `manager` edge; the whole approval‑routing
  and stale‑approver system already assumes this shape.
- Run it as a periodic sync (or Graph **delta query** / change notifications) so
  an HR/org change in Entra flows into the app — which is exactly the
  "org‑change → stale approver → transfer/reassign" flow already built and
  verified. Right now that flow is triggered by a manual `PUT /api/users/:id`;
  with Graph it becomes automatic.
- Graph permission: `User.Read.All` (or `Directory.Read.All`), app‑level.

**3. Email / notifications — Microsoft Graph `sendMail`** *(replaces finding #22)*
- Swap the mock `console.log` transport for Graph `POST /me/sendMail` (delegated)
  or `POST /users/{id}/sendMail` (application). The existing per‑recipient
  templates drop straight in; keep the in‑app outbox as the audit copy.
- Add retry/queueing and a bounce/suppression story.
- Graph permission: `Mail.Send`.

**4. (Optional) Calendar — Microsoft Graph events** *(enhances the review‑meeting loop)*
- The review‑meeting confirm/decline/reschedule loop (just wired) could create
  and update **real Outlook calendar events** (`POST /me/events`) so a confirmed
  review meeting actually lands on the approver's Outlook calendar.
- Graph permission: `Calendars.ReadWrite`.

### Backend prep to do *now* (before the O365 credentials exist)

These make the eventual switch a drop‑in rather than a rewrite, and can be done
against the current in‑memory prototype:

- [ ] **Stop assuming `u1`‑style internal IDs are the identity.** Add an
      `entra_object_id` (Entra `oid`) and `user_principal_name` (UPN/email) field
      to the user model now, and make `getUser()` resolve on those — so when real
      tokens arrive, the join key already exists. (The seed can populate fake
      `oid`s meanwhile.)
- [ ] **Isolate auth behind one seam.** Today `getUser(req)` reads a header in
      ~40 route handlers. Keep that single function as the *only* place identity
      is derived, so replacing "read `X‑User‑Id`" with "validate Entra JWT" is a
      one‑function change, not a 40‑site edit. (It's already centralized — keep it
      that way; don't let new routes read the header directly.)
- [ ] **Isolate email behind `sendEmail()`.** It already is — keep all delivery
      going through that one function so swapping console→Graph is one change.
- [ ] **Add the config/secrets story** (`PRODUCTION‑PASS #5`): `TENANT_ID`,
      `CLIENT_ID`, `CLIENT_SECRET`/cert path, `GRAPH_SCOPES`, redirect URIs — all
      from env/secret manager, documented in `.env.example`, fail‑fast on startup
      if a required one is missing. (`ALLOWED_ORIGINS` from Wave C is the first
      entry in this story.)
- [ ] **Pin the manager edge as the routing source of truth.** Confirm no code
      path routes approvals on anything except `reports_to` + active delegation
      (the old design's hard rule) — because `reports_to` will soon be
      authoritative, synced from Entra.

### Sequencing note

Auth (#1) is the keystone and should land **with or right after** the persistent
database (blocker #16) — a real login is meaningless if the user records it
authenticates against evaporate on restart. Directory sync (#2) and Graph email
(#3) can follow independently. Calendar (#4) is optional polish.

---

## Prioritized plan

Sequenced so each phase is independently shippable and the app visibly improves.

### Phase 0 — Cleanup (½ day, zero risk)
- [ ] Delete the 17 root scratch files.
- [ ] Remove the 5 unused deps; run `npm run build` to confirm nothing breaks.
- [ ] Remove or gate the two fabricated cards (findings #1, #2).
- [ ] Enable TS `strictNullChecks` + `noImplicitAny`, fix fallout, `tsc` green.

### Phase 1 — Truthfulness & polish (1–2 days)
- [ ] Persist Settings (Notifications/Security tabs) — finding #3.
- [ ] Seed custodian notifications in the backfill — finding #8.
- [ ] Real "Export PDF" or relabel — finding #7.
- [ ] Add the React error boundary (`ErrorFallback` already designed) — #20.
- [ ] Centralize date formatting — #26.

### Phase 2 — Scale & confidence (2–4 days)
- [ ] Server‑side pagination + filtering on Audit Log, System Emails, Claims — #5.
- [ ] Pagination on the remaining unpaginated lists — #6.
- [ ] Unit tests for `lib/api.ts` (adapter + status mapping) and an e2e smoke of
      the core loop; run in CI — #19.
- [ ] Route‑level code‑splitting; self‑host fonts — #13, #14.

### Phase 3 — Production foundation + Office 365 (the real work, multi‑session)
*Anchored by the [O365 target](#target-integration-office-365--microsoft-entra-id).*
- [ ] **Backend prep now** (identity fields, one auth seam, one email seam, config
      story) so the O365 switch is a drop‑in — see that section's checklist.
- [ ] Persistent database + data‑access layer behind the existing routes — #16
      *(lands with auth; a login is meaningless if users evaporate on restart).*
- [ ] **Entra ID sign‑in (OIDC/MSAL)** replacing `X‑User‑Id` + the mock login;
      retire the role switcher for good — #17.
- [ ] **Microsoft Graph directory sync** (users + manager hierarchy → `reports_to`),
      feeding the existing org‑change/stale‑approver flow automatically.
- [ ] **Microsoft Graph `sendMail`** replacing the mock transport — #22.
- [ ] Object storage with per‑resource ACLs + signed URLs — #18.
- [ ] Observability: structured logs, error tracker, `/healthz` — #21.
- [ ] *(Optional)* Outlook calendar events for confirmed review meetings.
- [ ] Optimistic/targeted refetch + live counts — #23, #24.

### Phase 4 — Product depth (as desired)
- [ ] Policy Compliance engine (retires findings #1, #2, #4).
- [ ] Bulk actions; full a11y pass; `server.ts` modularization — #25, #27, #10.

---

## Doc hygiene

The three original docs are now **partially stale** and will mislead a fresh
reader who trusts their checkboxes:

- `AUDIT.md` — items #9 (review meetings), #10 (resubmit), #11 (stale approver)
  are marked open but are **done** (this session). The four "Broken" items were
  already fixed earlier.
- `ROADMAP.md` — B15 (per‑role notifications), B17 (currency → PHP), B5/B6/B7 are
  marked open but are **done**.
- `PRODUCTION‑PASS.md` — #7 (security middleware) is now **partly done** (helmet,
  CORS, body‑limit); #2 (role switcher) is **partly done** (dev‑gated + login).

**Recommendation:** treat *this* document as the current source of truth for
outstanding work, and either archive the older three or add a one‑line "see
PROTOTYPE‑AUDIT.md" banner to each.

---

## Appendix — key file references

| Concern | Location |
|---|---|
| Model adapter (protect with tests) | `src/lib/api.ts` |
| Server monolith | `server.ts` (4,969 lines) |
| Fabricated policy card | `src/pages/shared/ClaimDetail.tsx:289` |
| Static policy guidelines (`$65.00`) | `src/pages/requestor/RequestorDashboard.tsx:170` |
| Unpersisted settings | `src/pages/shared/Settings.tsx:282,327` |
| Client‑side truncation | `src/pages/admin/AuditLog.tsx:95`, `SystemEmails.tsx:73` |
| `window.print()` export | `src/pages/shared/ClaimDetail.tsx:123` |
| In‑memory storage | `server.ts:24‑29` (`let claims = []`, …) |
| Mock email transport | `server.ts` (`--- MOCK EMAIL TRANSPORT ---`) |
| Mock import batches | `src/components/AppContext.tsx:3` |
| Wave C security middleware | `server.ts` (`createApp()` top) |
| Login gate | `src/pages/Login.tsx`, `src/App.tsx` |
