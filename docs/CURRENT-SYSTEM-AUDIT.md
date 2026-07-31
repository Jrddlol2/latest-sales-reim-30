# Current System Audit and Claude Code Handoff

**Audit date:** July 31, 2026

**Reviewed commit:** `35cc544f2a3d587bd90706f61097d0d2cbff41ad`

**Intended repository:** `https://github.com/Jrddlol2/latest-sales-reim-30`

**Branch:** `main`

## Purpose

This is the current handoff audit for the Sales Reimbursement System. It reflects
the code at the reviewed commit and supersedes the status and scorecards in
`PROTOTYPE-AUDIT.md`, `AUDIT.md`, `PRODUCTION-PASS.md`, and `ROADMAP.md`.

Use this document together with:

- `CHANGELOG-AND-FUTURE-WORK.md` for delivered product changes and the agreed backlog.
- `USER-MANUAL.md` for role-specific usage.
- `PROJECT-CONTEXT.md` for architecture and development orientation.

## Executive Verdict

The system is a strong stakeholder/demo prototype. The main reimbursement
workflow and most requested role experiences are implemented, backed by a
small but meaningful automated test suite, and build successfully.

Approximate readiness:

- **Stakeholder demonstration:** strong
- **Client-request alignment:** approximately 80–85%
- **Production use with real employee or financial data:** not ready

The largest remaining product gaps are export behavior, cash-only release,
Teams-only internal notifications, demo-data calibration, legacy missing-receipt
behavior, and the unresolved weekly approver KPI.

The largest production blockers are mock authentication, in-memory persistence,
local attachment storage, incomplete resource authorization, missing CI and
observability, and incomplete accessibility/browser testing.

## Validation Performed

The following commands passed against the reviewed commit:

```bash
npm test -- --run
npm run build
npx tsc --noEmit
```

Results:

- 5 test files passed.
- 30 tests passed.
- TypeScript completed without errors when run sequentially.
- The production frontend and bundled Express server built successfully.
- Vite reported an initial JavaScript chunk of approximately 770 KB.

The test suite currently covers:

- The reimbursement submit-to-completion lifecycle.
- Assigned-approver authorization.
- Invalid payout confirmation codes.
- Transport Reimbursement without MOM and with a required receipt.
- Custodian return with an audited reason.
- Finance read-only behavior.
- Cash Advance and Liquidation list/history mapping.
- The 30-day reimbursement filing policy.
- Team-analytics calculation behavior.
- Frontend/server data adapters and status mapping.

### Validation limitation

A live browser connection was unavailable during this audit. Responsive,
keyboard, screen-reader, visual-regression, and complete role-by-role interaction
testing still require a manual or browser-automation pass. Do not claim that all
specified viewports have been verified based on this audit alone.

## Confirmed Delivered Requirements

### Requestor and filing

- A single **New Claim** entry point exposes General Reimbursement, Transport
  Reimbursement, Cash Advance, and Liquidation.
- The redundant Submit Claim navigation item is removed.
- Recent Requests and the latest claim tracker are prioritized on the dashboard.
- Requestor analytics charts were removed.
- Receipt Archive is now **Expenses & Receipts**.
- General Reimbursement captures Minutes of Meeting before expense details.
- MOM includes Discussion, Action Items, Client Email, and CC Client.
- Cost Center, Project Code, and Department are removed from the active MOM form.
- Type of Account retains Existing, New Client, and Dormant.
- Date of Meeting, Location of Meeting, Date of Purchase, and OR Number are clarified.
- Expense rows support OR Number, receipt attachment, multiple rows, and totals.
- The requestor can file more than PHP 1,000 while reimbursement is capped at PHP 1,000.
- Purchase date begins blank.
- A receipt exactly 30 days old is accepted.
- A receipt 31 days old is blocked in the frontend adapter and server.
- Review & Submit shows claimed and maximum reimbursable amounts.

### Transport Reimbursement

- Transport Reimbursement is a distinct claim type.
- It does not require Minutes of Meeting.
- It requires a receipt and Date of Purchase.
- It follows approver, custodian, release-code, and confirmation routing.

### Minutes and Agreements

- A requestor can create a standalone MOM without filing a claim.
- Standalone requestor MOM records remain private from team approvers.
- Approvers receive access to claim-linked team MOM records.
- MOM lists include search and linked/status filters.
- Claim Detail displays expense lines before the complete minutes.
- MOM and claim-review events appear on the Calendar.

### Approver

- Average Response Time and Approval Rate were removed.
- The dashboard prioritizes awaiting work, pending value, aging, and team reimbursement.
- Approval Queue defaults to oldest first.
- Aging indicators and View All navigation are present.
- Approval Queue contains compact filters and Approval History.
- Approve, Return, and Reject actions are shared between list and detail views.
- Return and Reject require a reason.
- Optional review-meeting scheduling is presented during Return and Reject.
- Team-member spending and recent decisions are presented side by side.

### Expenses and Receipts

- The module is expense-centered rather than file-archive-centered.
- Approvers can filter by team member.
- Search covers vendor, OR number, claim reference, filename, and purpose.
- Category, status, type, client, requestor, amount, attachment, and date filters exist.
- List and grid modes exist, with list as the default.

### Custodian and Finance

- Processing Queue defaults to oldest first.
- The oldest item is highlighted and surfaced in a banner.
- Aging, search, filters, and sorting are implemented.
- Custodians can Return to Requestor or Reject Before Release with reasons.
- Release-code generation and requestor payout confirmation are implemented.
- Finance has company-wide read access and is blocked from financial mutations by
  centralized server middleware.

### Administration

- Master Data Admin, Field Definitions, and Company Policy are absent from active navigation.
- Company Directory supports CSV import and filters.
- User Accounts supports role, department, employment-status, and sorting controls.
- Admin Reporting uses compact filters.
- Audit events and sent notifications are merged into System Activity.
- System Activity supports activity/source/role/status/date/search filtering.

## Outstanding Client Requirements

| Requirement | Current implementation | Required decision or change |
|---|---|---|
| Pure PDF/Word export | MOM has Word-compatible `.doc`; PDF helper opens the browser print dialog; Claim Detail still has Print | Implement true exports and remove browser Print |
| Cash-only reimbursement | Cash, GCash, Bank Transfer, and Check remain configured | Restrict reimbursement releases to Cash in UI and server |
| Teams-only internal notifications | Internal events create Email and Teams records | Retain Teams internally; preserve email only for explicit external client CC if approved |
| Filing-limit popup | Next Step blocks and shows a toast | Replace or supplement with the requested explanatory dialog |
| Demo amounts near PHP 1,000 | Many reimbursement seeds remain substantially higher | Center reimbursement examples around PHP 750–1,250 |
| Missing Receipt behavior | Missing Receipt filter and legacy states remain | Remove it or rename it for permitted legacy/import exceptions |
| Company integration | CSV import exists | Define whether true SAP/API/database synchronization is required |
| Weekly approver KPI | Team Reimbursed This Week remains | Resolve the original request to add it versus the later request to remove it |
| Terminology audit | Core dates are improved | Complete payment, release, activity, export, and legacy-status terminology review |

## Confirmed Engineering Findings

### 1. Repository remote was misconfigured during the audit

The reviewed commit was pushed to `latest-sales-reim-30/main`, but the local
`origin` still pointed to `latest-sales-reimburse-2926`. Confirm that `origin`
points to the intended repository before future pushes.

### 2. Frontend routes lack role guards

The sidebar hides role-specific modules, but `App.tsx` registers Approver,
Custodian, Finance, and Admin routes for every logged-in role. Direct navigation
can render out-of-role screens.

Add a role-aware route guard that redirects or displays a proper Forbidden page.
Keep server authorization as the final authority.

### 3. Authentication is prototype-only

The server trusts the caller-provided `X-User-Id` header. There are no passwords,
sessions, validated tokens, or Entra ID claims. Anyone able to call the API can
impersonate a seeded user, including an Admin.

Additionally, `GET /api/users` and `GET /api/admin/settings` do not currently
require an authenticated user.

This must be replaced with real Microsoft Entra ID authentication before production.

### 4. Persistence and attachments are prototype-only

- Business data is stored in module-level arrays and is lost on restart.
- Multiple instances cannot share authoritative state.
- Attachments are stored on local disk.
- Attachment access checks only whether a valid user identity is supplied, not
  whether that identity is authorized for the associated claim.

Persistent database integration and claim-scoped object storage authorization are
production blockers.

### 5. Accessibility remains incomplete

Confirmed source-level issues include:

- The shared Select hides the native arrow with `appearance-none` but does not
  render a replacement chevron.
- The shared Label does not support `htmlFor`.
- Many fields do not have stable label/control associations.
- Claim-type selection cards use click handlers without button semantics or
  keyboard activation.
- Shared and custom modals lack `role="dialog"`, `aria-modal`, focus trapping,
  Escape handling, initial focus, and focus restoration.
- Several icon-only controls do not expose accessible names.
- Validation messages are not consistently connected through `aria-describedby`.
- Failed step validation does not consistently focus the first invalid field.

Use one accessible Modal component and improve the shared Input, Select, and
Label primitives before patching individual pages.

### 6. Responsive verification is incomplete

Many tables have overflow or mobile-card strategies, but the Calendar keeps a
fixed seven-column layout with 100-pixel-tall cells. That design needs a mobile
agenda/list fallback.

The complete application should still be exercised at:

- 360 × 800
- 390 × 844
- 768 × 1024
- 1024 × 768
- 1366 × 768
- 1440 × 900
- 1920 × 1080

### 7. Performance and maintainability

- The build warns about an approximately 770 KB initial JavaScript chunk.
- `AdminDashboard` imports Recharts eagerly, so chart code is not fully isolated
  to the reporting route.
- `server.ts` is over 5,000 lines.
- `src/lib/api.ts` is over 1,200 lines.
- `SubmitClaim.tsx` is approximately 900 lines.
- There is no GitHub Actions workflow.
- There is no production logging, monitoring, error tracking, or health/readiness
  endpoint.
- Running TypeScript and the production build concurrently can race because
  `tsconfig.json` has no explicit source include and build-output exclusion.

### 8. Documentation is stale

The older README and audits contain claims that no longer match the system,
including:

- Every reimbursement requires MOM, despite Transport Reimbursement.
- Review meetings originate from requestor submission.
- The repository has zero tests.
- `PROTOTYPE-AUDIT.md` is the current authoritative audit.

This document is the authoritative audit for commit `35cc544`.

## Recommended Work Order

### Priority 0: Prevent handoff and repository mistakes

1. Confirm/correct the Git remote.
2. Keep this audit and the changelog linked from the README.
3. Add CI for type checking, tests, and production build.

### Priority 1: Close explicit stakeholder gaps

1. Add true PDF/Word export and remove Print.
2. Enforce cash-only reimbursement release.
3. Implement Teams-only internal notifications with an explicit external-CC exception.
4. Resolve the weekly KPI decision.
5. Update reimbursement demo data.
6. Resolve Missing Receipt terminology and behavior.
7. Finish the terminology audit.

### Priority 2: UI quality and acceptance testing

1. Add frontend role guards.
2. Implement the accessible shared Modal.
3. Fix Select and Label primitives.
4. Make claim-type cards keyboard-operable.
5. Add mobile Calendar presentation.
6. Run role-by-role browser testing at all target viewports.
7. Add browser-level tests for the four claim workflows and key filters.

### Priority 3: Production foundation

1. Replace mock identity with Microsoft Entra ID.
2. Wire the existing database schema to persistent Postgres storage.
3. Move attachments to authorized object storage.
4. Add structured logging, monitoring, and health checks.
5. Split the server and large frontend modules by domain.

## Claude Code Starting Instructions

When handing this repository to Claude Code:

1. Start from commit `35cc544` or a descendant on `latest-sales-reim-30/main`.
2. Read this document and `CHANGELOG-AND-FUTURE-WORK.md` first.
3. Treat older audit scorecards as historical only.
4. Do not assume production readiness because the demo workflows pass.
5. Preserve the working reimbursement lifecycle and server-enforced policies.
6. Implement one priority group at a time.
7. Run type checking, tests, and the production build after every logical group.
8. Do not silently change backend contracts while performing frontend UI work.
9. Report browser viewports and workflows actually tested rather than inferred.
