# Sales Reimbursement System — Full System Audit

**Audit date:** August 3, 2026  
**Reviewed commit:** `020d8e1`  
**Repository:** `https://github.com/Jrddlol2/latest-sales-reim-30`  
**Branch:** `main`

## Executive summary

The Sales Reimbursement System is a strong, presentation-ready prototype with functional role-based workflows, coherent desktop UI, useful financial reporting, and a healthy automated baseline.

It is not production-ready for real employee, client, receipt, or financial data.

| Area | Rating | Verdict |
|---|---:|---|
| Demo readiness | 9/10 | Ready for stakeholder presentations |
| UI/UX | 8/10 | Clean and coherent at desktop sizes |
| Feature completeness | 8/10 | Major workflows are implemented |
| Workflow integrity | 6.5/10 | Core happy paths work, but reimbursement transitions need stronger enforcement |
| Automated testing | 7/10 | 61 passing tests; browser E2E and negative cases are missing |
| Maintainability | 6/10 | Understandable, but central files are oversized |
| Security | 3/10 | Prototype identity and attachment authorization are unsuitable for production |
| Production readiness | 3/10 | Authentication, persistence, storage, and operational controls remain blockers |

The repository was clean when audited, and the Git remote correctly pointed to the intended repository.

## Validation results

All standard checks passed:

- TypeScript: passed
- Production build: passed
- Automated tests: **61/61 passed across 9 test files**
- CI runs type-checking, tests, and the production build through `.github/workflows/ci.yml`

Live UI checks confirmed:

- Microsoft-first login and role-based demo launcher
- Requestor dashboard
- Approver queue
- Custodian dashboard and analytics
- Finance approved records, receipts, analytics, and CSV export
- Admin dashboard and reporting
- Client-side role guard preventing a Requestor from opening Admin Reporting
- No application-originated browser console errors during representative checks
- Finance records showed only approved-onward statuses
- Finance tables correctly separated `Expense Total` and `Reimbursed`

The in-app browser verified the login at 1280×720 and the main Finance and Custodian surfaces around 1351×768. A dedicated 1920×1080 acceptance pass is still recommended.

## What works well

- Role navigation is clear and appropriately differentiated.
- Demo accounts use tab-scoped sessions, making multi-role live presentations practical.
- Frontend role protection is implemented in `src/App.tsx`.
- Finance is centrally blocked from financial mutations and receives approved-onward records only.
- Cash Advance and Liquidation endpoints generally enforce valid source statuses.
- Expense totals and reimbursed amounts are meaningfully separated.
- Finance analytics use useful accounting concepts: claimed, approved, paid, and outstanding.
- CSV financial export is present.
- Receipt search and filtering cover useful financial fields.
- Client-CC awareness is tested for the Requestor and Approver.
- The 30-day filing rule, ₱1,000 reimbursement cap, assigned-approver authority, cash-only reimbursement release, and incorrect release-code rejection have automated coverage.
- The current `README.md` and `docs/AI-HANDOFF-CONTEXT.md` provide a substantially better handoff than the older documentation.

## Prioritized findings

| Severity | Finding | Impact | Recommendation |
|---|---|---|---|
| Critical | Identity is trusted through `X-User-Id` | Anyone who can call the API can impersonate another demo user, including an Administrator | Replace it with Microsoft Entra authorization-code flow, validated server sessions, and server-derived identity |
| Critical | Runtime data is stored in arrays | Every restart or cold start loses transactions; multiple instances cannot share state | Complete the PostgreSQL/Drizzle migration before using real data |
| Critical | Current dependency audit reports one critical and two high vulnerabilities | `jspdf` and `react-router` are within affected version ranges | Perform targeted upgrades and regression testing; do not blindly run `npm audit fix --force` |
| High | Reimbursement approval lacks a current-status check | A completed, rejected, returned, or already-approved reimbursement can potentially be approved again through the API | Require `Pending Approval` before any Approve, Return, or Reject mutation |
| High | Custodian claim-code and ready-for-claim endpoints lack transition guards | A Custodian can potentially issue a code or mark an inappropriate record ready out of sequence | Require `Processing`, validate custodian assignment if introduced, and make transitions idempotent |
| High | Release codes use `Math.random()` and have no expiry or attempt throttling | Codes are not cryptographically generated, arbitrary custom codes are accepted, and confirmation attempts are unlimited | Use `crypto.randomBytes`, fixed server validation, expiry, hashed storage, regeneration invalidation, and throttling |
| High | Attachment access is not claim-scoped | Any authenticated identity that knows a filename and user ID can retrieve another claim’s receipt or MOM file | Move files to private object storage and authorize every download against the linked record |
| High | Claim submission is a non-transactional sequence of uploads, MOM creation, and claim creation | A later failure can leave orphaned uploads or MOM records | Implement a database transaction and upload cleanup or compensation |
| Medium | Every page loads a large workspace through approximately 15 requests | Full users, claims, advances, liquidations, settings, companies, support, and other collections are loaded even when not needed | Introduce route-level queries, pagination, caching, and server-side filtering |
| Medium | All authenticated roles receive the complete user collection and Admin settings | This exposes more personnel and configuration data than most roles need | Return minimal directory projections and restrict settings to Admin or a public policy projection |
| Medium | Profile editing displays success without persisting changes | Change Photo and Save Changes create misleading success messages | Disable them with an honest Microsoft-managed explanation or implement actual persistence |
| Medium | CSP is disabled and operational controls are absent | Production deployment lacks CSP, rate limiting, structured logging, monitoring, and health checks | Add these after the final hosting and authentication architecture is selected |
| Medium | Important negative workflow cases lack automated coverage | The test suite validates happy paths but misses replay and out-of-order financial actions | Add a server-side transition-matrix test suite |
| Low | Documentation has competing source-of-truth files | Older audits contain findings that have since been fixed | Archive or clearly mark older audits as historical |
| Low | Major files are oversized | `server.ts` is 6,198 lines, `src/lib/api.ts` is 1,395, and `SubmitClaim.tsx` is 1,071 | Split by domain after production contracts stabilize |

The highest-risk workflow problem is visible around the reimbursement approval mutation and the Custodian claim-code and ready-for-claim mutations in `server.ts`. Cash Advance and Liquidation already demonstrate the correct pattern by explicitly checking their source statuses.

## Role-by-role audit

### Requestor

Strengths:

- Clear dashboard and New Claim entry point
- Reimbursement, Transport Reimbursement, Cash Advance, and Liquidation
- Multiple expense rows and receipts
- MOM and client-contact flow
- Payout confirmation and status tracking
- Search, notifications, support, and settings

Remaining work:

- Make submission transactional.
- Persist or disable the fake profile-editing actions.
- Add complete keyboard and screen-reader testing for the multi-step claim form.

### Approver

Strengths:

- Oldest-first approval queue
- Quick actions and history
- Return and reject reasons
- Review meeting scheduling
- Delegation and approver-transfer support
- Team-oriented dashboards

Remaining work:

- Enforce `Pending Approval` on the server before decisions.
- Add double-submit and replay protection.
- Test completed, rejected, and returned claims being acted on again.

### Custodian

Strengths:

- Processing, ready-to-claim, transaction history, and analytics
- Return and reject-before-release behavior
- Cash-only reimbursement enforcement
- Release-code flow

Remaining work:

- Restrict claim-code generation and ready-for-claim to `Processing`.
- Harden release codes.
- Clarify exactly when `paid_at` should be recorded: physical release, ready-for-claim, or Requestor confirmation.

### Finance

Strengths:

- Correct read-only role
- Approved-onward company-wide visibility
- Receipts and paid/completed history
- Finance-specific analytics
- CSV export
- Correct separation of expense, approved, paid, and outstanding values

The selected chart types are appropriate:

- Time-series for monthly obligations and releases
- Horizontal bars for category, department, and Requestor comparisons
- Status counts for operational distribution
- Drill-down table beneath the charts

Remaining work:

- Validate every metric definition with the Finance owner.
- Export the metric contract alongside reports.
- Add server pagination before production-scale data.

### Administrator

Strengths:

- Users, companies, imports, reporting, system activity, and demo-data controls
- Demo seed and reset surfaces are gated by demo mode
- Historical CSV import is functional rather than simulated

Remaining work:

- Move configuration and imports to persistent storage.
- Restrict Admin settings responses.
- Add import preview, duplicate handling, rollback, and durable batch logs.
- Connect organization data to the approved Entra or HR source.

## Workflow audit

### Reimbursement

The happy path is functional and covered by automated tests:

1. Requestor files a reimbursement with expenses and receipts.
2. The designated Approver approves, returns, or rejects it.
3. A Custodian processes the approved reimbursement.
4. The Custodian generates a release code and marks it ready.
5. The Requestor confirms receipt using the code.

The primary defect is that the reimbursement-specific approval and Custodian routes do not enforce their expected source statuses. This permits potential replay and out-of-order mutations through direct API calls.

### Cash Advance

Cash Advance submission, approval, release, and history mapping are functional. The server correctly restricts decisions to `Submitted` advances and releases to `Approved` advances.

### Liquidation

Liquidation submission, return, review, settled closure, refund-due handling, and reimbursement-due handling are implemented. The review endpoint correctly limits actions to `Submitted` liquidations.

### MOM and client CC

Standalone and claim-linked MOM records are implemented. Client contact details and client-CC awareness notifications are present. Current email records are mock or in-app outbox data rather than external delivery.

## UI/UX audit

The visual system is consistent and substantially less template-driven than earlier versions:

- Login hierarchy is clear and Microsoft sign-in remains primary.
- The blue-forward login layout looks branded rather than generic.
- Animated background elements are decorative and do not interfere with legibility.
- Sidebar navigation changes sensibly by role.
- Sign out is appropriately contained in the profile menu.
- Tables use meaningful status badges and aligned financial columns.
- Filters are compact enough for the primary desktop targets.
- Finance and Admin analytics expose source records beneath visual summaries.

Remaining UX work:

- Complete 1920×1080 role-by-role verification.
- Run a formal keyboard and screen-reader pass.
- Replace misleading success-only profile controls.
- Verify all modal focus behavior and Escape handling.
- Test empty, loading, error, and very large dataset states in the browser.

## Production blockers

The following must be completed before a real deployment:

1. PostgreSQL persistence and database transactions
2. Microsoft Entra OIDC and signed server sessions
3. Removal of `X-User-Id` and URL-based `uid` attachment access
4. Private object storage with record-level authorization
5. Dependency vulnerability remediation
6. Strict workflow transition enforcement
7. Secure release-code implementation
8. Real notification delivery and retry handling
9. Rate limiting, CSP, structured logs, monitoring, and health/readiness endpoints
10. Backup, restore, retention, and audit-log policy
11. Staging UAT with sanitized production-like data
12. Privacy and security review for receipts and employee information

Microsoft profile photos are not automatic. They require approved Microsoft Graph permission and an authenticated backend proxy or cache, as documented in `docs/microsoft-auth-handoff.md`.

## Recommended roadmap

### P0 — Immediate risk reduction

1. Patch the vulnerable dependencies.
2. Add a formal reimbursement transition matrix.
3. Enforce status guards on approval, claim-code, and ready-for-claim endpoints.
4. Harden release codes.
5. Add regression tests for replay and out-of-order actions.

### P1 — Production foundation

1. Migrate all arrays to PostgreSQL.
2. Make claim creation atomic.
3. Implement Entra authentication and server sessions.
4. Move attachments to private object storage.
5. Add attachment ACLs and operational security controls.

### P2 — Product and UX completion

1. Replace fake profile saves.
2. Add real notification delivery.
3. Add pagination and server-side search.
4. Complete accessibility and keyboard testing.
5. Verify 1366×768 and 1920×1080 across all roles.
6. Archive stale documentation.

## Required test additions

- Re-approving an already approved or completed claim
- Returning or rejecting a non-pending claim
- Issuing a claim code for a non-processing claim
- Marking a rejected or draft claim ready for payout
- Release-code expiry, regeneration, and brute-force throttling
- Attachment access by unrelated Requestor, Approver, Finance, and Custodian accounts
- Partial failure during upload, MOM, and claim creation
- Concurrent approval and release actions
- Entra callback, session, logout, and expiry behavior
- Finance scope and export consistency
- Browser E2E for all five roles
- Automated accessibility scan and keyboard-only flows
- Load testing with at least 10,000 financial records

## Final verdict

Continue using the system for demonstrations and stakeholder review. Do not load real financial documents or employee data until the P0 and P1 work is complete.
