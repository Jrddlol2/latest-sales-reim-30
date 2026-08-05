# Sales Reimbursement — Production Readiness Pass

Companion to `AUDIT.md`. The audit covers *things that are broken or fake*; this covers
*what has to change to run this for real*. Today the system is an excellent prototype:
a polished React UI on an in-memory Express backend with mock auth. Nothing here is a
bug — it's the gap between "works in a demo" and "safe to put in front of employees and
finance."

Organized by tier:

| Tier | Meaning | Count |
|---|---|---|
| **P0** | Ship blockers — the system is unsafe/unusable in production without these | 5 |
| **P1** | Hardening — required for a real, multi-user deployment | 8 |
| **P2** | Product & quality bar — expected polish, not load-bearing | 10 |

---

## P0 — Ship blockers

### 1. Real authentication (replace `X-User-Id` header trust)
**Today:** every request authenticates by an `X-User-Id` header the client sets freely.
Anyone can be anyone — including Admin — by changing one string. This is fine for a demo,
catastrophic in production.
**Do:** real sessions behind SSO. The old system's docs already target Entra ID
(`docs/hierarchy-sync-design.md`); wire OIDC/SAML, issue a signed session, and derive the
user server-side from the session — never from a client header. Every route's `getUser`
becomes "read the authenticated principal," not "trust the caller."

### 2. Remove the dev role-switcher
**Today:** the top bar has a dropdown that lets the logged-in user instantly become
Requestor / Approver / Custodian / Admin. It's the demo's best feature and production's
worst nightmare — a one-click privilege escalation.
**Do:** delete it (`components/layout/Topbar.tsx`); role comes from the authenticated
account only. Keep a gated version behind an env flag for local dev if useful.

### 3. Persistent database
**Today:** all state lives in module-level arrays (`let claims = []`, …). A restart, a
crash, or a second server instance = total data loss and no shared state. The `reset`
endpoint literally empties everything.
**Do:** move to a real datastore. The type layer already anticipates it (the comments
reference Prisma-backed models). Introduce a schema, migrations, and a data-access layer;
swap the in-memory arrays for repository calls behind the existing route handlers so the
API surface doesn't change.

### 4. Real file storage with per-resource access control
**Today:** uploads land in a local `uploads/` folder and are served by a route that only
checks *that a user is logged in* — not that they're allowed to see *that* file. The
server code itself flags this as a temporary gate pending real auth.
**Do:** store attachments in object storage (S3/Azure Blob) with private ACLs and
short-lived signed URLs; enforce that the requester owns or is authorized for the claim
the receipt belongs to. Local disk doesn't survive multi-instance or ephemeral hosting.

### 5. Secrets & environment config
**Today:** config is ad hoc; there's a `@google/genai` dependency (an API-key surface)
and a `.env.example`.
**Do:** a real config story — all secrets from the environment/secret manager, nothing in
the repo, per-environment (dev/stage/prod) config, and a documented required-vars list.
Fail fast on startup if a required secret is missing.

---

## P1 — Hardening

### 6. Currency is inconsistent — UI says `$`, backend says `PHP`
**Today:** the entire frontend formats money as `$` (USD) — `${claim.total.toFixed(2)}`
everywhere — while the entire backend operates in **PHP** (every email says
"PHP 33,956"). The same amount is labeled two different currencies depending on where you
look. For a finance system this is a real integrity problem.
**Do:** pick the real currency, store it explicitly, and format through one helper
(`Intl.NumberFormat` with the correct locale/currency). Never hardcode a symbol in JSX.

### 7. HTTP security middleware
**Today:** the Express app has no `helmet`, no CORS policy, no rate limiting, and no JSON
body-size limit (only file uploads are capped, at 10 MB). 
**Do:** add `helmet` for headers, a locked-down CORS origin allow-list, rate limiting on
auth and mutation routes, a sane `express.json({ limit })`, and consistent server-side
input validation/sanitization on every write route.

### 8. Pagination & server-side filtering
**Today:** `loadWorkspace` pulls *everything* on first load and after *every* mutation —
in the demo that's ~357 claims, ~1,851 emails, ~2,830 audit rows across 13 endpoints. The
Audit Log fetches all 2,830 and slices to 500 in the browser; System Emails fetches all
1,851. At real volumes this is unusable.
**Do:** paginate and filter server-side (Audit Log, System Emails, Claims lists first);
load per-page, push search/filter/date-range to query params.

### 9. React error boundaries
**Today:** the app is just `<StrictMode><App/></StrictMode>` — one thrown error in any
page white-screens the whole application with no recovery.
**Do:** wrap routes in an error boundary that shows a recoverable fallback and reports the
error; consider a per-route boundary so one bad page doesn't kill the shell.

### 10. Real email/notification transport
**Today:** emails are `console.log('--- MOCK EMAIL TRANSPORT ---')`. The templates are
production-quality (SharePoint-style); the delivery is not.
**Do:** wire a real transport (SMTP or Microsoft Graph, matching the SharePoint framing),
with retry/queueing and a suppression/bounce story. The in-app outbox stays as the audit
copy.

### 11. Turn on TypeScript strict mode
**Today:** `tsconfig.json` has no `strict` flag. During the backend port a reference to a
non-existent property compiled cleanly — exactly the class of bug strict mode catches.
**Do:** enable `strict` (at least `strictNullChecks` + `noImplicitAny`), fix the fallout,
and keep `tsc --noEmit` green in CI.

### 12. Automated tests + CI
**Today:** the new app has no tests (only a `lint` script). The original system shipped a
Playwright e2e spec that wasn't carried over.
**Do:** e2e coverage for the core loop (submit → approve → disburse) and the role-gated
paths; unit tests for the model adapter in `lib/api.ts` (the snake↔camel + status mapping
is exactly where silent drift happens); run both in CI on every push.

### 13. Data validation & concurrency
**Today:** in-memory mutation has no transactions and no optimistic-concurrency guard —
two custodians acting on the same claim can race.
**Do:** once on a DB, wrap multi-step writes (submit = upload + MOM + claim) in
transactions, add version/`updated_at` checks so a stale edit is rejected rather than
silently overwriting, and centralize validation so the client and server agree.

---

## P2 — Product & quality bar

### 14. Optimistic UI / targeted refetch
Every mutation currently calls the full `loadWorkspace` (all 13 endpoints). Refetch only
what changed, or update locally and reconcile — the app will feel far snappier and cut
server load.

### 15. Live queue counts & notifications
Sidebar badge counts and the notification bell only update on manual refresh or
navigation. Add polling (or SSE/WebSocket) so a new approval or email shows up without a
reload.

### 16. Accessibility pass
Icon-only buttons (filter, more-options, notification bell) lack accessible labels; audit
focus-visible states, keyboard navigation of modals/menus, and color contrast on the
status chips. Target WCAG AA.

### 17. Standardize empty / loading / error states
Most pages handle these well; a few (dashboards) don't. Define one pattern (skeleton,
empty illustration, ret/error card) and apply it everywhere so the app feels coherent.

### 18. Bulk actions
Approvers and custodians act one row at a time. Add multi-select for approve/return and
mark-ready — a real reviewer clearing a backlog will want it.

### 19. Observability
No structured logging, error tracking, or health endpoints. Add request logging with
correlation IDs, an error tracker (e.g. Sentry), and `/healthz` + `/readyz` for the
platform (`render.yaml` is present but there's nothing for it to probe).

### 20. Prune & self-host dependencies
`@google/genai` and the `@fontsource/*` packages appear unused in the new UI. Fonts are
loaded from the Google Fonts CDN at runtime (`index.html`) — a third-party request on
every page load (privacy + offline + reliability). Self-host the fonts and drop unused
deps.

### 21. Real PDF/print export
"Export PDF" on a claim calls `window.print()`; the CSV "Export Report" buttons on the
custodian dashboard emit placeholder strings. Generate proper documents (server-side PDF
for claims; real CSV from live data).

### 22. Responsive / mobile QA
The layout has mobile handling (collapsible sidebar) but the dense tables and multi-column
forms need a real pass on small screens — horizontal scroll containers, stacked layouts,
touch targets.

### 23. Consistent money & date formatting
Beyond currency (#6): dates are formatted with raw `toLocaleString()` in some places and
`toLocaleDateString()` in others, and timezones aren't pinned. Centralize date/number
formatting so the whole app reads consistently.

---

## Definition of done for a production launch

**Minimum to go live:** all of P0, plus from P1 — currency (#6), security middleware (#7),
error boundaries (#9), real email (#10), and a smoke-level e2e suite (#12). Everything
else can follow in fast-follow releases.

**Suggested sequencing:**
1. **Foundation** — auth (#1), remove role switcher (#2), database (#3). Nothing else is
   trustworthy until these land.
2. **Safety** — file storage (#4), secrets (#5), security middleware (#7), error
   boundaries (#9).
3. **Correctness** — currency (#6), validation/concurrency (#13), strict mode (#11), tests
   (#12).
4. **Scale & polish** — pagination (#8), real email (#10), then the P2 quality items.
