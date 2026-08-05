# Sales Reimbursement — System Audit

**New UI on ported backend.** A full sweep of every page against the real Express
backend. The core reimbursement loop and the admin write-paths are solid; the gaps
cluster in three places — the two non-reimbursement claim types, the dashboards'
hardcoded numbers, and a set of workflow features the server supports but the UI
never calls.

- **Scope:** 28 pages, server routes cross-checked
- **Method:** code read + live API probes
- **Findings:** 19 (4 broken · 4 misleading · 5 missing · 6 polish) + 13 areas verified solid

| Severity | Count |
|---|---|
| 🔴 Broken | 4 |
| 🟠 Misleading data | 4 |
| 🔵 Missing features | 5 |
| ⚪ Polish | 6 |
| 🟢 Solid (working) | 13 |

---

## 🔴 Broken
*Features present in the UI that do not function at all.*

> **Status (2026-07-28):** all four Broken items below were fixed and verified
> end-to-end against the live server (commit "Fix the four AUDIT.md Broken
> items"). Kept here for the record; see each item for what changed.

### 1. Cash Advance submission can't complete — `CRITICAL`
**Where:** `SubmitClaim.tsx` · `api.ts` `submitClaimFlow`

The wizard's type picker offers Reimbursement, Cash Advance, and Liquidation — but
`submitClaimFlow` always `POST`s to `/api/claims`. A cash advance has no expense line
items, so the server rejects it with *"Expense Category is required."* Confirmed live.

**Fix:** Route Cash Advance submissions to `POST /api/cash-advances` (amount + purpose
+ approver), not the reimbursement endpoint.

### 2. Liquidation submission is wired to the wrong endpoint — `CRITICAL`
**Where:** `SubmitClaim.tsx`

Same root cause. Selecting Liquidation computes a variance in the UI but still posts to
`/api/claims`; it never calls `POST /api/liquidations`, never attaches its line items,
and never links back to the parent cash advance.

**Fix:** Add a liquidation path: create the liquidation, add line items, then submit —
using the dedicated liquidation routes.

### 3. Historical Import doesn't import anything — `CRITICAL`
**Where:** `admin/HistoricalImport.tsx`

The whole page is theater: it ignores the chosen file, runs four `setTimeout` calls
that print a hardcoded "Found 142 records… Import completed," and never parses the CSV
or calls the server. The real `POST /api/imports` endpoint (which parses records and
creates historical claims) is never touched.

**Fix:** Parse the CSV client-side, send rows to `POST /api/imports`, and drive the log
from the real response.

### 4. Liquidation close throws for the custodian — `CRITICAL`
**Where:** `custodian/ProcessingQueue.tsx` · `AppContext`

The "Close Liquidation" action targets status `Closed`, but `updateClaimStatus` only
maps Approved / Rejected / Returned / Ready / Completed / Released — anything else throws
*"No server route maps to status."* The custodian can't close a liquidation or collect
a refund.

**Fix:** Map Closed → `POST /api/liquidations/:id/collect-refund` and wire the review
step to `/review`.

---

## 🟠 Misleading data
*Screens that render but show invented numbers, not real state.*

### 5. Admin dashboard is entirely fabricated — `HIGH`
**Where:** `admin/AdminDashboard.tsx`

The admin landing page never touches `useAppContext`. Every figure is a literal: 1,248
users, 482 active claims, 99.98% uptime, "14 pending master data," plus a fake System
Health panel and three invented audit-log entries (e.g. "Admin updated John Doe to
Approver"). It looks live and is 100% static.

**Fix:** Compute from real context — user count, claim counts by status, recent
`/api/history` entries.

### 6. Approver dashboard KPIs aren't scoped, and half are hardcoded — `HIGH`
**Where:** `approver/ApproverDashboard.tsx`

"Awaiting Approval" and "Total Managed" sum *all* claims, not this approver's (a code
comment even says "just show everything for demo"). Avg Response 4.2 hrs, Approval Rate
94.2%, the ±% trends, the "Recent Activity" feed (Jessica Chen…), and Team Sentiment
98% / 84% are all fixed text. "Generate Weekly Report" only fires a toast.

**Fix:** Scope counts to the approver's queue; drop or compute the invented metrics.

### 7. Custodian dashboard mixes real queue with fiction — `HIGH`
**Where:** `custodian/CustodianDashboard.tsx`

Total Pending is real; everything around it isn't. "Missing Receipts 42" and "Oldest
Item 4.2" are hardcoded, the Queue Velocity chart is a fixed array, and the "Automated
Audit Mode — FinFlow AI is verifying 24 receipts" card describes a product that doesn't
exist. "Export Report" downloads a placeholder `"Report Data…"` string.

**Fix:** Compute the two KPIs from claims; delete the AI card and the fake export or make
it a real CSV.

### 8. Requestor dashboard's float & liquidation widgets are static — `HIGH`
**Where:** `requestor/RequestorDashboard.tsx`

Active Claims and Total Reimbursed are real. But "Unliquidated Float $2,450.00 / 3
Overdue," the "+2 since last week" trends, and the "Liquidation Progress 66% — 3 advances
need liquidation" card are all hardcoded, and "Submit Reports Now" only toasts.

**Fix:** Derive float and liquidation progress from the requestor's cash advances; remove
dead trends.

---

## 🔵 Missing features
*Backend supports it fully; the UI never surfaces it.*

### 9. Review-meeting responses (the whole scheduling loop) — `MEDIUM`
**Where:** `shared/Calendar.tsx`

Submitting a claim proposes a review meeting, but the Calendar is read-only. An approver
can't confirm, decline, or reschedule — the server exposes `confirm`, `decline`, and
`reschedule` routes plus an approver schedule feed, none of which are called.

**Fix:** Add confirm / decline / propose-new-time actions on calendar events and pending
claims.

### 10. Resubmitting a returned claim — `MEDIUM`
**Where:** `shared/ClaimDetail.tsx`

When an approver returns a claim for revision, the requestor has no path to edit and
resend it. `PUT /api/claims/:id/resubmit` exists and is unused, so a Returned claim is
effectively a dead end in the UI.

**Fix:** On a Returned claim the requestor owns, offer "Revise & Resubmit."

### 11. The org-change / stale-approver system is mocked — `MEDIUM`
**Where:** `approver/ApprovalQueue.tsx`

The queue shows a "Stale Approvals Detected" banner, but "Review Stale Claims" just
re-sets a filter — a code comment marks it `// Mock action`. The backend has a complete
hierarchy-sync feature: transfer-approver, admin reassign, and a fallback-escalation
check. None of it is wired.

**Fix:** Wire transfer / reassign actions and, for admins, the fallback-check trigger.

### 12. My Requests search & status filter don't work — `MEDIUM`
**Where:** `shared/ClaimsList.tsx`

The search box and the status dropdown render but have no `onChange` — they're
decorative. On an account with many claims the list can't be narrowed at all.

**Fix:** Wire both inputs to filter the claim list (the MOMs page already does this well —
mirror it).

### 13. Receipt Archive upload is local-only — `MEDIUM`
**Where:** `shared/Receipts.tsx`

The archive *lists* real receipts from server line items, but "Upload to Archive" creates
an in-memory object-URL that vanishes on reload and never reaches the server. It looks
like it saved; it didn't.

**Fix:** Send the file to `POST /api/upload`; either persist a standalone-receipt concept
or drop the standalone upload.

---

## ⚪ Polish
*Low-stakes cleanups and dead controls.*

### 14. Approver dashboard type-filter pills are inert — `LOW`
**Where:** `approver/ApproverDashboard.tsx`
All Requests / Claims / Cash Advances / Liquidations look like a filter but have no
handler. **Fix:** Wire them to filter the worklist by type, or remove them.

### 15. Transaction History shows today's date for every payout — `LOW`
> **Fixed 2026-07-28.** Real per-row completion date now sourced from `statusHistory`; added
> Payment Method + Payment Reference columns. Also gained search + pagination in the same pass.

**Where:** `custodian/TransactionHistory.tsx`
The "Completion Date" column renders `new Date()` for all rows (a comment admits it's a
mock), and the release code / payment reference the custodian recorded aren't shown.
**Fix:** Use the claim's processing date; surface release code & payment reference.

### 16. Toast-only "mock action" buttons scattered across dashboards — `LOW`
**Where:** Approver / Custodian dashboards
Filter, more-options, "Generate Weekly Report," "Submit Reports Now," and "Export Report"
fire a success toast without doing anything. **Fix:** Implement or remove; a button that
lies about success erodes trust in the ones that don't.

### 17. Settings — Notifications & Security tabs are placeholders — `LOW`
**Where:** `shared/Settings.tsx`
Both show "Settings for … can be configured here." (Profile and the new Delegation tab
are real.) **Fix:** Build them out or hide the tabs until they exist.

### 18. Every dashboard visit fakes an 800 ms load — `LOW`
**Where:** `pages/Dashboard.tsx`
A `setTimeout` skeleton runs on each mount even though context data is already in memory —
it just adds latency. **Fix:** Gate the skeleton on the context's real loading flag.

### 19. Context still exposes non-persisting writers — `LOW`
**Where:** `components/AppContext.tsx`
`setClaims`, `setMoms`, `setLineItems` and friends remain on the context from the mock
era. Now that state is server-owned, writing them mutates local state that the next
refresh silently overwrites — a trap for future edits. **Fix:** Remove the setters or
funnel them through server calls + refresh.

---

## 🟢 What's already solid
*Verified working end-to-end against the backend.*

- **Core loop** — submit → approve → process → ready → complete, with the requestor closing payout by release code.
- **Approval queue** — approve / reject / return with comment validation, scoped to reports + delegates.
- **Delegations** — full request → accept / decline → cancel lifecycle, now enforced in access control.
- **MOMs** — real list of all minutes, search, links to claims.
- **Calendar** — real month grid with actual review meetings (read side).
- **Support** — create, threaded replies, admin status changes.
- **Master Data admin** — create / edit catalogs with server validation.
- **Field Definitions** — create / edit, incl. per-claim-type visibility.
- **User Accounts** — edit role / manager / status with orphan-warning confirm.
- **Company Directory** — real entities, create & edit.
- **Audit Log** — full immutable event feed with search.
- **System Emails** — real outbox with read-state persistence.
- **Admin Reporting** — charts & CSV export computed from real claims.

---

## Suggested order of attack

The four **Broken** items are the only things that hard-fail a user mid-task — start
there, and Cash Advance + Liquidation submission are really one fix (route the wizard by
type). The **Admin dashboard** is the highest-visibility lie and is a quick win since the
data's already in context. The **Missing features** are where the ported backend's real
depth is going unused — the review-meeting loop and the stale-approver system are the
biggest untapped pieces. **Polish** can trail behind.

---

# UX Review — user scroll-through (2026-07-28)

A second pass, sourced from the product owner clicking through the running app and
annotating screenshots (`Improvements.pdf`, 10 screens). These are **experience** gaps —
things that render but feel broken, dead-end, or missing — rather than the hard failures
above. Grouped by theme; where an item overlaps an existing finding it's cross-referenced
rather than duplicated. Numbered `UX-n` to stay clear of the 1–19 above.

| Theme | Count |
|---|---|
| 🔵 List UX (scroll / click / filter) | 1 (spans 5 pages) |
| 🔵 Missing surfaces & modules | 4 |
| 🟠 Dead / misleading controls | 2 |
| ⚪ Wording & discoverability | 2 |

---

## 🔵 UX-1. List pages: no pagination, rows not clickable, no filters — `MEDIUM`
*Screenshots: pp. 3, 4, 8, 10 ("infinite scrolling and can't click for more info and no
filter", repeated).*

The recurring complaint across the app's tables. Every long list renders **all** its rows
at once (reads as "infinite scroll"), most rows **aren't clickable** to drill in, and the
type/status **filters are missing or decorative**. Confirmed per page:

- **MOMs** (`shared/MOMs.tsx`) — has a search box, but a row click goes to the *claim*
  (`/claims/:id`), not to the MOM itself; there is **no MOM detail** to open (see UX-2).
  No type/status filter.
- **My Requests** (`shared/ClaimsList.tsx`) — rows *are* clickable, but the search box and
  status dropdown have no `onChange` (**duplicate of #12**).
- **Audit Log** (`admin/AuditLog.tsx`) — search only; renders `.slice(0, 500)`, rows not
  clickable.
- **System Emails** (`admin/SystemEmails.tsx`) — search only, `.slice(0, 300)`.
- **Transaction History** (`custodian/TransactionHistory.tsx`) — no filter, no row click,
  no pagination (and still shows a mock completion date — **see #15**).

**Fix direction:** one shared list pattern — server-side pagination + a filter/search bar
+ a clickable row → detail. This is the UI half of **PRODUCTION-PASS #8** (paginate &
filter server-side); do them together.

## 🔵 UX-2. No MOM detail view; meeting summary is thin and the file isn't viewable — `MEDIUM`
> **Fixed 2026-07-28** (roadmap B13). `/moms/:id` now renders the full record with a real
> file viewer; also surfaced a real "View Full Minutes" link from Claim Detail (was dead text).

*Screenshots: pp. 3, 6 ("can't click the minutes of the meeting for more info"; "I want
more details from the meeting summary… and if there is a template form, make sure the file
is viewable").*

There is no `MomDetail` route at all — a MOM can't be opened on its own. Where meeting
info does show, it's a thin summary. Two asks: (a) a real MOM detail surface with the full
record, and (b) when a MOM was uploaded as a file (or filled from a template), make that
document **viewable/downloadable** in-app, not just referenced. The old system had a
`MomDetail` page that wasn't carried over.

## 🔵 UX-3. Approver "My Requests" should merge the requestor Dashboard + My Requests — `MEDIUM`
> **Fixed in Phase 1.5** (`41f9ec6`, roadmap B14).

*Screenshot: p. 4 (Additional Requests).*

For the approver role, fold the requestor-style Dashboard and the My Requests list into a
single "My Requests" module, so an approver who is also a requestor sees one consolidated
place rather than two.

## 🔵 UX-4. In-app Notification / Email module per role — `MEDIUM`
*Screenshot: p. 4 (Additional Requests).*

Every role should have its own notifications/email inbox surface. Today the mock email
outbox exists but is **admin-only** (`admin/SystemEmails.tsx`); the bell in the top bar
isn't a real inbox. Give requestors/approvers/custodians their own view of the mail the
system already generates for them. (Backend already sends per-recipient mail — this is a
read surface + routing, and pairs with **PRODUCTION-PASS #15** live counts.)

---

## 🟠 UX-5. Approval Queue quick actions are hidden until hover — `MEDIUM`
*Screenshot: p. 1 ("the quick actions tab only shows up when the pointer is hovered…
instead of actions should this be like a click-to-review").*

In `approver/ApprovalQueue.tsx` the Approve/Return/Reject buttons are
`opacity-0 group-hover:opacity-100` — invisible until you hover the row, so they're
undiscoverable (and unusable on touch). Product owner suggests making the **row itself a
"click to review"** affordance and/or keeping the actions always visible.

## 🟠 UX-6. Dead / mystery controls that fire a toast or nothing — `MEDIUM`
*Screenshots: pp. 1, 2, 5, 9 ("the other buttons do not work"; "what report is this, also
the button does nothing"; "what is this and this don't work"; "make sure this is fixed").*

The scroll-through kept hitting buttons that either do nothing or fake success with a
toast — the filter icon on the Approval Queue, the report/export buttons on the dashboards,
and other unlabeled controls. This is the same rot catalogued in **#16** (toast-only mock
actions) and the fabricated dashboards **#5–#8**; the PDF is fresh evidence of how visible
it is in normal use. **Fix:** implement or remove — a control that lies about success is
worse than no control.

---

## ⚪ UX-7. Dashboard quick-launch doesn't deep-link to the claim type — `LOW`
*Screenshot: p. 4 ("click Request Cash Advance doesn't immediately go to the cash advance
UI, same with the New Reimbursement tab").*

`requestor/RequestorDashboard.tsx` already navigates to `/claims/new?type=advance`, but the
wizard (`shared/SubmitClaim.tsx`) **ignores the `?type=` query param** and always opens on
the type-picker (step 0). Read the param and pre-select the type / skip the picker so the
button lands the user straight in the right flow. (The wizard now branches cleanly by type
after the Broken-items fix, so this is a small addition.)

## ⚪ UX-8. Custodian action wording: "Generate Release Code" vs "Review" — `LOW`
*Screenshot: p. 7 ("should the action be review instead of generate code").*

On the custodian queue (`custodian/CustodianDashboard.tsx`) the primary action reads
"Generate Release Code". The product owner questions whether the label should reflect a
*review* step instead. A wording/semantics decision — confirm the intended verb, then align
the button and the underlying step name.

---

## Additional requests already tracked elsewhere

- **Currency → Philippine Pesos** (p. 4). The UI formats money as `$` while the backend runs
  in PHP — this is **PRODUCTION-PASS #6** (currency integrity). Same fix.
