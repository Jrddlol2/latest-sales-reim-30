# AI Handoff Context — Sales Reimbursement System

> Paste this file into a new AI coding session before asking it to work on this
> repository. It is a working-context brief, not end-user documentation. The
> current code and tests take precedence if this file ever disagrees with them.

## Your role in this project

You are continuing development of the **Sales Reimbursement System**, an
internal Microgenesis web application for submitting, approving, disbursing,
tracking, and reporting sales-related expenses.

Work carefully in the existing application. Preserve working workflows,
role-based access, and current demo behavior. Do not replace the app with a
new template, mock-only implementation, or unrelated design system.

## Product scope

The system supports:

- Reimbursements, including transport reimbursements.
- Cash advances and liquidations.
- Minutes of Meeting (MOM) and Letter of Agreement (LOA) records.
- Multi-step approval, return-for-revision, delegation, and review-meeting
  flows.
- Custodian disbursement processing and requestor receipt confirmation.
- Receipt records, notifications, support tickets, activity history, and mock
  email/outbox records.
- Finance records, finance analytics, role dashboards, exports, and admin
  reporting/configuration.

## Technology and runtime

- Frontend: React 19, TypeScript, React Router, Tailwind CSS 4, Vite.
- Backend: Express in `server.ts`; Vite is served as middleware in development.
- State boundary: `src/components/AppContext.tsx` loads workspace data and
  exposes mutations to pages.
- API/model adapter: `src/lib/api.ts`. It translates between backend
  snake_case/separate transaction models and the UI's unified camelCase
  `Claim` model. Treat this adapter as a critical compatibility layer.
- Charts: Recharts, shared primitives in `src/components/shared/ChartPrimitives.tsx`.
- Testing: Vitest plus TypeScript checking.

Run locally:

```bash
npm install
npm run dev
# http://127.0.0.1:3000

npm run lint
npm test
npm run build
```

## Current deployment reality — important

This is a functional **demo/prototype**, not a production-ready financial
system.

- Data is held in in-memory arrays in `server.ts`; server restarts lose
  transactions and reseed demo data when demo mode is on.
- Authentication is demo-only. The client identifies the current user with a
  temporary `X-User-Id` path. This is not secure authentication.
- Microsoft Entra sign-in is scaffolded, but no real OIDC callback/session
  adapter is installed yet.
- Current avatars are local demo assets. Microsoft profile photos will require
  a separately approved Microsoft Graph implementation.
- Uploads are local/prototype storage. Real deployment requires durable object
  storage and per-resource authorization.
- Do not represent demo data, mock emails, or placeholder Microsoft sign-in as
  production integrations.

## Authentication and demos

The login page is Microsoft-first visually while real Entra access is pending.
Demo accounts are intentionally available for presentations.

- The login page can launch a selected demo role/account in a **new tab**.
- Identity is stored per tab in `sessionStorage`, allowing simultaneous
  Requestor, Approver, Custodian, Finance, and Administrator tabs.
- Those tabs share the same in-memory backend, so workflow changes become
  visible after refresh, focus, or normal context polling.
- Key config is documented in `.env.example` and
  `docs/microsoft-auth-handoff.md`.
- Do not remove demo access until persistent data and real Entra authentication
  are both implemented and approved.

## Roles and intended boundaries

| Role | Primary responsibility |
| --- | --- |
| Requestor | Creates and tracks their own claims, MOMs, receipts, payouts, and support requests. |
| Approver | Reviews eligible direct-report/delegated work and can submit their own requests. |
| Custodian | Processes approved work, releases payments, and handles disbursement/refund steps. |
| Finance | Read-only downstream financial visibility for approved/completed records, receipts, and analytics. |
| Administrator | Manages users, company/master data, fields, imports, reporting, activity, and demo controls. |

Never treat a hidden button or frontend route guard as security. Real access
rules must remain enforced by the backend too.

## Essential workflow rules

### Reimbursements

Typical lifecycle:

`Draft → Pending Approval → Processing → Ready for Claim → Completed`

- A Requestor creates the claim and submits it for approval.
- The Approver approves, returns it for revision, or rejects it.
- The Custodian processes approved work and issues the release/payment details.
- The **Requestor**, not the Custodian, confirms receipt using the release code
  to complete the reimbursement.
- An Approver cannot approve their own claim.

### Cash advances and liquidations

- Cash advance: `Draft → Submitted → Approved → Released → Liquidated`.
- Liquidation may be returned for revision, reviewed, or closed.
- Refund-due and reimbursement-due outcomes must not be mixed with normal
  reimbursement totals.

### Client CC

When the client-CC option is selected, a client email is required. The system
records client CC awareness and produces notifications for the Requestor and
Approver where appropriate. Current email records are mock/in-app outbox data.

### Finance visibility

Finance is read-only and should see downstream financial records only:

- Approved/completed reimbursement and cash-advance records as appropriate.
- Related receipts and finance analytics.
- No draft, pending-approval, rejected, or other pre-decision work in finance
  metrics/records.

For exact metric definitions, use `docs/ANALYTICS-METRIC-CONTRACT.md`.

## Current UI and design direction

- The primary desktop targets are **1366×768** and **1920×1080**.
- Keep the interface professional, compact, and usable at 1366×768. Avoid tall
  filter bars, oversized action groups, and vague labels.
- Use Microgenesis branding and a restrained blue palette.
- The current login page has a Microsoft-first action, collapsible demo access,
  a blue-forward 60/40 desktop composition, and slow frosted background-orb
  animation. Honor `prefers-reduced-motion`.
- Global search is role-filtered and intentionally tolerant of partial, fuzzy,
  token, and abbreviation matches.
- Sign out belongs in the profile menu, not as a large standalone top-bar
  action.

## Key files and ownership map

| Area | Start here |
| --- | --- |
| Routes and frontend role guards | `src/App.tsx` |
| Workspace state and refresh behavior | `src/components/AppContext.tsx` |
| Server routes, in-memory data, backend role checks | `server.ts` |
| Server/UI model translation | `src/lib/api.ts` |
| Login/demo launcher | `src/pages/Login.tsx` |
| Sidebar/top bar/search/profile | `src/components/layout/` |
| Fuzzy search behavior | `src/lib/globalSearch.ts`, `src/components/layout/GlobalSearch.tsx` |
| Claim workflow helpers | `src/lib/claimWorkflow.ts` |
| Finance CSV export | `src/lib/financialRecordsCsv.ts` |
| Chart standards/theme | `src/lib/chartTheme.ts`, `src/components/shared/ChartPrimitives.tsx` |
| Shared workflow pages | `src/pages/shared/` |
| Role-specific pages | `src/pages/requestor/`, `src/pages/approver/`, `src/pages/custodian/`, `src/pages/finance/` |
| Admin pages | `src/pages/admin/` |
| Styling and animation rules | `src/index.css` |

## Recent completed work

The current codebase already includes these improvements:

- Finance records constrained to the appropriate approved/completed financial
  scope, with receipts, analytics, and CSV export.
- Clear separation of expense/receipt total versus reimbursed amount in request
  lists and dashboards.
- Compact analytics filter toolbar and shared finance-grade chart primitives.
- MOM action/attachment cleanup, improved client-contact field placement, and
  Word-compatible document export.
- Client CC awareness notifications for requestors and approvers.
- Role-based demo login in new tabs, Microsoft Entra configuration handoff
  scaffolding, profile-menu sign out, Microgenesis favicon/branding, and global
  fuzzy search.
- Blue-forward, animated, accessibility-aware login visual refresh.

## Known production work still required

Do not claim these are already finished:

1. PostgreSQL/Drizzle persistence and migration execution.
2. Microsoft Entra OIDC authorization-code flow, server sessions, callback
   validation, and removal of `X-User-Id` identity trust.
3. Real email/notification delivery and durable file storage.
4. Production authorization/security review, audit retention, and UAT against
   approved policy rules.
5. Microsoft Graph profile-photo integration only if IT approves the required
   permissions and data handling.

## Safe working rules for another AI

1. Inspect existing code before modifying it; do not assume old documents or
   screenshots are current.
2. Keep changes scoped. Preserve demo-mode behavior unless the task explicitly
   changes it.
3. Update backend checks when changing a sensitive workflow or role boundary;
   frontend changes alone are insufficient.
4. Preserve the distinction between claimed, approved, paid, and reimbursed
   amounts. Do not double-count cash advances and liquidations.
5. Treat the adapter in `src/lib/api.ts` as a high-risk seam. Update tests when
   changing mappings, statuses, or API shapes.
6. Run `npm run lint`, relevant `npm test` coverage, and `npm run build` after
   meaningful changes. Exercise the relevant role flow in the browser.
7. Do not reset or reseed demo data unless explicitly asked; it can erase the
   current in-memory presentation state.
8. Do not push, deploy, alter real credentials, or claim production readiness
   without explicit user authorization.

## Recommended continuation prompt

```text
Read docs/AI-HANDOFF-CONTEXT.md first. You are continuing the existing Sales
Reimbursement System in this repository. Preserve the React + Express demo
architecture, role boundaries, server/UI adapter, and current workflows.

Before coding, inspect the relevant current files and state your implementation
scope. Do not replace working features with mocks or change demo/production
boundaries without approval. Verify changes with TypeScript, tests, build, and
the relevant role flow. Report clearly what is implemented, what remains
prototype-only, and do not push unless asked.
```

## Related references

- `README.md` — full technical and operational documentation.
- `docs/USER-MANUAL.md` — role-by-role usage guidance.
- `docs/ANALYTICS-METRIC-CONTRACT.md` — authoritative financial metric rules.
- `docs/microsoft-auth-handoff.md` — IT requirements and safe Entra next steps.
- `docs/production-cutover.md` — deployment preparation.
- `docs/ROADMAP.md` and `docs/CHANGELOG-AND-FUTURE-WORK.md` — planned/future work.
