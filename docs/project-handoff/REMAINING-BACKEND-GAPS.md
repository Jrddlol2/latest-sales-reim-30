# Remaining mock representations and backend gaps

**Audit date:** 2026-08-04
**Updated:** 2026-08-04 (follow-up session — see "Resolved since this audit"
below; original findings below that are kept for what's still open)
**Repository baseline:** `33ad22b` (`main`)
**Scope:** Current UI and server behavior that represents a production capability but is still mocked, process-local, non-durable, or dependent on a future external integration.

## Executive summary

The core reimbursement domains are no longer mock-only. Claims, MOMs, cash
advances, liquidations, approvals, review meetings, delegations, support,
reference data, and system settings have Postgres write-through repositories and
boot-time loading when `DEMO_MODE=false`.

A follow-up session (no Microsoft/Google accounts available in that
environment) closed six of the original findings below: historical imports,
notification preferences, implicit company creation, user/master-data audit
history, delegation-expiry persistence + scheduled stale-approver escalation,
and atomic claim-number generation. It also gated the frontend's legacy-record
financial-amount fallback behind demo mode and fixed the `/uploads/:filename`
authorization gap. See "Resolved since this audit" for specifics.

**What's still genuinely open:** real identity (Entra), external email/Teams
delivery, durable and authorized *file storage* (the authorization check on
top of it is now fixed, the storage location itself is not), and a handful of
smaller items below. All of the identity/delivery work is blocked on external
accounts (Microsoft tenant, Google Workspace) that weren't available to the
session that did the rest of this work — not on remaining engineering effort.

## Resolved since this audit

| Area | What changed |
|---|---|
| Human-readable claim numbers | `claims.claim_number` now has a `UNIQUE` constraint; a Postgres sequence (`claim_number_seq`) allocates it atomically when `DATABASE_URL` is set. In-memory counter kept only as the no-database fallback. |
| Historical imports | `POST /api/imports` now builds every row first, then commits batch + claims + line items + history as one transaction (`persistHistoricalImportBatch`). A failure rejects the whole batch. |
| File download authorization | `/uploads/:filename` resolves the file to its owning claim/expense-line-item/MOM/liquidation-line-item and applies that record's own access rule instead of accepting any logged-in user. |
| Notification preferences | `PUT /api/me/notification-prefs` persists via `syncUsersToDb()`. `sendEmail()` now takes an `eventKey` and checks `shouldNotify()` for the 5 categories Settings > Notifications exposes. |
| Automatically created companies | `getOrCreateCompany()` (real MOM create/update paths) now persists a newly created company; the demo seed generator uses a separate non-persisting variant. |
| User/master-data audit history | `addUserHistory()`/`addMasterDataHistory()` now persist (previously write-only into the in-memory array); the row mapper's hardcoded `userId: null` was dropping these rows outright. |
| Scheduled lifecycle work | Delegation expiry now persists when it flips (previously in-memory only). An hourly in-process scheduler runs delegation-expiry sync and stale-approver escalation automatically; the manual admin trigger still works alongside it. |
| Client PDF preview | `MomClientPreviewModal.tsx` renders the literal generated PDF (`buildStructuredPdfBlob`) in an iframe instead of an HTML approximation. Delivery still doesn't attach it — see the email/Teams item below, still open. |
| Financial display fallbacks (frontend) | `fromServerClaim()` only infers a capped display amount for a legacy record when `demoModeEnabled` is true; production leaves it unset instead of inventing a number. The server-side analytics equivalent (`buildAnalyticsRecords`) is **not** yet gated the same way — see below. |

## Prioritized findings (still open)

| Priority | Area | Current representation | Backend required |
|---|---|---|---|
| P0 | Authentication and identity | Microsoft sign-in terminates at a `501` placeholder. Protected routes trust the client-controlled `X-User-Id` header. | Microsoft Entra OIDC, validated server-side sessions, secure cookies, logout/expiry handling, and authoritative route authorization. **Blocked on an Entra tenant/app registration.** |
| P0 | Email and Microsoft Teams | `sendEmail()` only appends records to the in-memory `emails` or `teamsMessages` arrays (now gated by per-category preferences, but still not delivered anywhere real). No message reaches an external inbox or Teams chat. | Real Gmail/SMTP and Microsoft Graph delivery, queueing/retry behavior, delivery status, and an audit trail of attempts. **Blocked on Google Workspace/Gmail and the Entra app registration.** |
| P0 | File storage location | Uploads are written to local disk, or an ephemeral temporary directory on Vercel. Download *authorization* is now fixed (see above); the storage location itself is not. | Private object storage (Supabase Storage / S3), attachment metadata, retention, and cleanup. |
| P1 | Financial display fallbacks (server-side) | `buildAnalyticsRecords()`'s claim branch infers `approvedAmount`/`paidAmount` from the reimbursement cap when the real field is absent, unconditionally (not gated on demo mode like the frontend equivalent now is). | `AnalyticsRecord.approvedAmount`/`paidAmount` are non-optional numbers summed directly into dashboard/report totals — gating this needs those summation sites audited for how to represent an incomplete record first, not a one-line change. |
| P2 | System-wide filter unification | MOMs and Claims list views now have matching filter dimensions (search, status/type, client, location, date range), but as independently implemented, duplicated UI — not a shared component. Receipts' filter logic remains the richest and most deeply coupled to its own data model. | A true shared `FilterBar` component, if that level of unification is wanted, is a larger refactor touching all three list views (and Receipts' filter logic would need to be generalized first). |
| P2 | Terminology/copy consistency | One confirmed inconsistency (bare "MOM" in a Settings description) was fixed. No further inconsistencies were found in a light pass (e.g. "Type of Account" phrasing is already consistent everywhere). | A broader button-verb/label consistency audit across the app, if wanted — not blocked on anything, just unstarted beyond the light pass. |

## Detailed evidence and recommendations

### 1. Authentication, directory data, and organizational synchronization

Evidence:

- `server.ts`'s `/api/auth/microsoft/start` returns `501` even when the Microsoft environment variables are present.
- `getUser()` derives identity from `X-User-Id`.
- `src/lib/api.ts` stores the selected demo identity as `mockUserId` in
  browser `sessionStorage`.
- `server.ts` generates fake Entra object IDs for seeded users.
- Admin edits to `reports_to` are described as a simulated Entra hierarchy sync (`docs/project-handoff/HIERARCHY-SYNC-DESIGN.md`).
- The Admin Dashboard's "Run Fallback Check" (now also running automatically on an hourly schedule — see "Resolved since this audit") stands in for a scheduled stale-approver escalation job that a real Entra sync would trigger.

Production work:

1. Implement authorization-code OIDC with PKCE, state, nonce, issuer/audience
   validation, and tenant validation.
2. Store sessions server-side and use `HttpOnly`, `Secure`, `SameSite` cookies.
3. Resolve the validated Entra `oid` to the internal user record and remove
   `X-User-Id` and demo login in production.
4. Decide whether organization hierarchy comes from Microsoft Graph, an HRIS,
   or an administered internal source, then run synchronization as a durable
   scheduled job (the in-process scheduler added this session for
   delegation-expiry/stale-approver-escalation is a template for this, but a
   real Graph sync is a separate, larger integration).
5. Fetch and proxy/cache Microsoft profile photos only after the required Graph
   permission is approved.

### 2. External email and Teams delivery

Evidence:

- `sendEmail()` in `server.ts` defines a mock transport, now with an optional `eventKey` parameter that checks `shouldNotify()` before creating a record — but the record itself still only ever lands in the in-memory `emails`/`teamsMessages` arrays.
- Internal recipients are appended to `teamsMessages`; external recipients are
  appended to `emails`.
- `server.ts` explicitly logs `MOCK TEAMS` or `MOCK EMAIL TRANSPORT`.
- MOM completion invokes the mock sender.
- `MomDetail.tsx` displays a successful "Client copy sent" toast after that call.

Recommended design: see `docs/project-handoff/HANDOFF-NEXT-STEPS.md` sections
1a–1c for the full write-up (Gmail API vs. Nodemailer/SMTP, Teams Graph API
shape, attachment plumbing now that `buildMomPdfBlob()` returns bytes
directly, outbox/queue design, and the storage-durability note for
attachments on Vercel).

### 3. Historical import — RESOLVED

Was: `POST /api/imports` created an import batch and imported records only in
in-memory arrays, never calling `persistClaim()`/`persistExpenseLineItems()`
or a repository for `import_batches`, despite `src/db/schema.ts` already
defining that table.

Now: the route builds every claim/expense/history row in memory first, then
(when `DATABASE_URL` is set) commits the batch row + every claim + every
expense line item + every history entry as one Postgres transaction via
`persistHistoricalImportBatch()` in `coreLoopRepo.ts`. Any failure — most
notably a duplicate `claim_number` now hitting the new unique constraint —
rolls back the whole batch and returns a 500 instead of reporting success
while the batch only existed in-memory. In fully in-memory mode (no
`DATABASE_URL`), the function no-ops and the route falls back to its
previous in-memory-only behavior, matching every other domain's pattern.

### 4. Upload storage and attachment authorization — PARTIALLY RESOLVED

Evidence (storage location — still open):

- `server.ts` selects a local `uploads` directory or the operating system's
  temporary directory.

Evidence (authorization — resolved):

- `/uploads/:filename` previously served an attachment to any known user ID
  supplied through a header or `?uid=` query string, without verifying the
  requester could access the claim/MOM/liquidation owning that filename.
- Now, the route resolves the filename back to whichever claim (`receipt_url`),
  expense line item (`receipt_url`, via its parent claim), MOM (`file_url`), or
  liquidation line item (`receipt_url`, via its parent liquidation) references
  it, and applies that record's own access predicate
  (`canAccessClaim`/`canAccessMom`/`canAccessLiquidation` — now shared with
  each entity's own detail route rather than duplicated logic). A file with no
  resolvable owner is treated as not found. Verified live: owner/approver/
  admin get 200 with correct content, an unrelated authenticated user gets
  403, no identity gets 401.

Still open: move attachments to private object storage. Store an attachment
record with the owner entity, uploader, media type, size, storage key,
checksum, and timestamps. Every download should authorize the authenticated
user against the linked business record before streaming the file or issuing
a short-lived signed URL — the authorization *rule* now exists and is
reusable; it just needs to be pointed at object-storage URLs instead of local
disk paths once that migration happens.

### 5. Claim-number generation — RESOLVED

Was: `server.ts` initialized `claimCounter` to `123` as a process-local `let`,
incremented at two call sites to create `REIM-YYYY-NNNNNN` references, with no
`.unique()` constraint on `claims.claim_number`.

Now: a Postgres sequence (`claim_number_seq`, `drizzle/0004_skinny_flatman.sql`)
backs `nextClaimNumberFromDb()` in `coreLoopRepo.ts`, used via a shared
`generateClaimNumber()` helper whenever `isDbConfigured()`. The in-memory
counter remains as the fallback for the fully in-memory (no `DATABASE_URL`)
mode only. `claims.claim_number` now has a `UNIQUE` constraint as a hard
backstop. The demo seed generator's own numbering range is synced past the
real sequence's floor (`syncClaimNumberSequenceFloor()`) after seeding and on
admin reset, so a live-database demo doesn't hand out a claim number that
collides with (or trails) the seeded, in-memory-only demo data.

### 6. Notification preferences — RESOLVED

Was: `Settings.tsx` reported "Notification preferences saved" but the route
only assigned `user.notification_prefs = req.body` without persisting the
changed user, and `sendEmail()` never checked `notification_prefs`.

Now: the route persists via `syncUsersToDb()`. `sendEmail()` accepts an
`opts.eventKey` and checks a new `shouldNotify()` function before creating a
record; wired into the claim submitted/resubmitted, approved, returned, ready,
and all four delegation-lifecycle `sendEmail()` calls — the exact five
categories Settings > Notifications exposes. A category is only suppressed
when both toggles are off, since one delivery record still backs both
channels (see `shouldNotify()`'s doc comment for the architectural reason a
finer split isn't implemented yet). Everything without a matching UI
category (custodian ops mail, escalation-to-admin, support messages, client
CCs, cash-advance/liquidation lifecycle emails) is intentionally left
unconditional, exactly as before — gating those would mean guessing at a
category the UI doesn't actually expose.

### 7. Audit events — RESOLVED (user/master-data); claim/CA/liquidation history was already durable

Was: `server.ts` pushed user-change and master-data-change history directly
into `statusHistories` without ever persisting them; `coreLoopRepo.ts`'s
history row mapper hardcoded `userId: null` and didn't map `master_data_key`/
`master_data_id` even if a caller tried to persist one.

Now: `historyToRow()` maps `user_id`, `master_data_key`, and `master_data_id`
correctly. `addUserHistory()`/`addMasterDataHistory()` call
`persistStatusHistoryFireAndForget()` like every other history helper already
did. New `loadUserHistoryFromDb()` (`usersRepo.ts`) and
`loadMasterDataHistoryFromDb()` (`referenceDataRepo.ts`) reload these on boot
when `DATABASE_URL` is set, following the same per-domain-repo pattern
`cashAdvanceRepo.ts`/`workflowExtrasRepo.ts` already used for cash-advance/
liquidation/delegation history against the same shared table.

### 8. Implicit company creation — RESOLVED

Was: `getOrCreateCompany()` only pushed a newly-created company into the
in-memory `companies` array; MOM create/update routes never called
`persistCompany()` for it.

Now: `getOrCreateCompany()` is `async` and persists a newly created company
via `persistCompany()`, awaited from both the MOM create and update routes.
The demo seed generator was switched to a separate, deliberately
non-persisting `getOrCreateCompanyInMemory()` (same lookup-or-create logic,
no DB write) so repeated auto-seeding on every dev restart doesn't write
regenerated demo company rows to a live database — seeded companies were
never persisted before this change either; that invariant is preserved on
purpose, not accidentally.

### 9. Scheduled status changes — RESOLVED (delegation expiry persistence + automatic escalation); still process-local in the sense that it's an in-process timer, not an external job queue

Was: `syncDelegationStatuses()` expired delegations while another request
happened to read or use them, but never called `persistDelegation()`, so the
status flip didn't survive a restart. Stale-approver fallback escalation
required an Admin to manually click "Run Fallback Check."

Now: `syncDelegationStatuses()` fire-and-forget persists a flipped-to-Expired
delegation. The escalation logic was factored into a shared
`runStaleApproverFallbackCheck()`, called both by the still-available manual
admin route and by a new hourly `setInterval` (skipped when `VERCEL=1`, the
signal both the test harness and an actual Vercel deploy set, since a
setInterval has no meaning across serverless invocations and would otherwise
leak one live interval per test file). Both jobs are idempotent, so
re-running on every tick is safe. This is a pragmatic in-process middle
ground, not a database-backed job queue with idempotency keys — that's still
the "real" answer for a genuinely distributed/serverless deployment, per the
original recommendation below.

### 10. Client preview and delivery — PREVIEW RESOLVED, DELIVERY STILL OPEN

Was: the preview said it was exactly what the client receives, but rendered
HTML rows/paragraphs, not PDF bytes. `documentExport.ts` saved the generated
PDF directly without exposing a reusable Blob.

Now: `buildStructuredPdfBlob()` in `documentExport.ts` returns the PDF as a
`Blob` (via jsPDF's `pdf.output('blob')`); `exportStructuredPdf()` (disk
download) and the new `buildMomPdfBlob()` (preview) both call it, so there's
one source of truth for PDF bytes. `MomClientPreviewModal.tsx` renders that
blob in an `<iframe>`, regenerating it whenever the `mom` prop changes and
revoking the object URL on unmount. Verified live: the iframe's `src` is a
`blob:` URL whose fetched bytes start with `%PDF-1.3`.

Still open: the send route (`src/lib/api.ts`'s MOM send call) still sends an
empty JSON request — attaching the actual PDF bytes to a real outbound email
is blocked on the email/Teams delivery work in Section 2 above, which is
itself blocked on external accounts.

### 11. Frontend financial fallbacks — RESOLVED (frontend); server-side analytics equivalent still open

Was: `src/lib/api.ts`'s `fromServerClaim()` unconditionally calculated
`fallbackApprovedAmount` with `Math.min(claimedAmount, 1000)` and substituted
it whenever `approved_amount`/`paid_amount` was absent for a sufficiently
advanced status — in both demo and (hypothetically) production.

Now: `fromServerClaim(c, demoModeEnabled)` only applies that inference when
`demoModeEnabled` is true, threaded through from `/api/auth/config` via
`loadWorkspace()`. Defaults to `false` (no inference) when the caller doesn't
know the mode yet, since failing toward "flag it" is safer than failing
toward "silently invent a number." Covered by 3 new tests in `api.test.ts`.

Still open: `server.ts`'s `buildAnalyticsRecords()` (financial-records/
analytics endpoint) has the exact same kind of inference for its claim
branch, **not yet gated the same way**. Left un-gated deliberately this
session: `AnalyticsRecord.approvedAmount`/`paidAmount` are non-optional
`number` fields summed directly into dashboard/report totals (in this same
function and in `src/lib/analytics.ts`), so switching the branch to
`0`/`undefined` in production would zero out real reporting totals instead
of just leaving one claim's own display blank. Needs those summation sites
audited for how to represent an "incomplete record" before this is a safe
change — flagged with a comment at the code site pointing back to this
document.

## Intentionally demo-only behavior that does not need immediate replacement

The following are appropriate while `DEMO_MODE=true`, provided they remain
strictly unavailable in production:

- The role/account launcher and tab-scoped demo identities.
- Randomized year-of-data generation and Admin seed/reset controls.
- Form autofill buttons and generated sample receipt images.
- Seeded users, companies, master data, avatars, and transaction history —
  including the seed generator's own non-persisting `getOrCreateCompanyInMemory()`
  path (see item 8 above), which is a deliberate, not accidental, exception
  to "implicit company creation now persists."

These controls should remain for presentations. The production configuration
must set `DEMO_MODE=false`, `AUTH_MODE=microsoft`,
`ENABLE_DEMO_LOGIN=false`, `VITE_ENABLE_DEMO_LOGIN=false`, and
`AUTO_SEED=false`.

## Related backend hardening

These items are not mock representations, but should be completed alongside
the backend work above:

- Wrap multi-record claim/MOM/expense writes in database transactions. (The
  historical-import route now does this — item 3 above — as one example;
  the original per-route sequential-awaited-upserts pattern elsewhere, e.g.
  claim submission's persistClaim → persistExpenseLineItems → persistMom,
  is unchanged.)
- Add expiry, hashing, regeneration invalidation, and attempt throttling for
  release codes.
- Replace `drizzle-kit push` with reviewed, ordered migrations in the release
  pipeline. (`drizzle/0004_skinny_flatman.sql`, added this session, is
  actually current with `schema.ts` — earlier drift between the migrations
  folder and the live-pushed schema was caught and folded into that file —
  but the underlying `db:push` workflow itself wasn't changed.)
- Add structured logging, health/readiness endpoints, rate limiting, monitoring,
  alerting, backup/restore tests, and retention policies.
- Keep the current app on one persistent Node process until routes read from the
  database per request or use a safe shared-cache design. The current in-memory
  read cache is not compatible with Vercel serverless or multiple application
  instances. (The new scheduled-job `setInterval` reinforces this constraint —
  it's explicitly skipped under `VERCEL=1` rather than adapted to run there.)

## Recommended implementation order

1. Entra authentication and server sessions. **(blocked on an Entra tenant)**
2. Private object storage and attachment authorization. (Authorization rule
   now exists — item 4 above — storage migration itself still open.)
3. Durable notification outbox plus Gmail and Teams delivery. **(blocked on
   Google Workspace/Gmail and the Entra app registration)**
4. ~~Transactional historical import.~~ Done this session.
5. ~~Atomic claim-number generation and uniqueness constraint.~~ Done this session.
6. ~~Notification-preference enforcement~~ (done) ~~and complete audit
   persistence~~ (done — user/master-data history).
7. ~~Durable scheduled jobs for hierarchy escalation and delegation
   expiration.~~ Done this session, as an in-process scheduler — a real
   database-backed job queue is still the "correct" answer for a genuinely
   distributed deployment.
8. ~~Exact PDF preview~~ (done) ~~/attachment flow~~ (still blocked on Section
   2's delivery work) ~~and removal of frontend financial fallbacks~~ (done
   for the frontend; server-side analytics equivalent still open — item 11
   above).

## Validation baseline

The repository was clean at `33ad22b` before this document was added. The
following checks passed against that baseline:

- `npm run lint`
- `npm test` — 67 tests across 10 files
- `npm run build`

After the follow-up session's changes (this update), the same three checks
pass with **70 tests across 10 files** (3 new tests covering the
demo-mode-gated financial fallback).
