# Remaining mock representations and backend gaps

**Audit date:** 2026-08-04  
**Repository baseline:** `33ad22b` (`main`)  
**Scope:** Current UI and server behavior that represents a production capability but is still mocked, process-local, non-durable, or dependent on a future external integration.

## Executive summary

The core reimbursement domains are no longer mock-only. Claims, MOMs, cash
advances, liquidations, approvals, review meetings, delegations, support,
reference data, and system settings have Postgres write-through repositories and
boot-time loading when `DEMO_MODE=false`.

The largest remaining gaps are real identity, external email/Teams delivery,
durable and authorized file storage, historical-import persistence, and atomic
claim-number generation. Several smaller surfaces also look complete in the UI
but only update process memory or infer values in the browser.

## Prioritized findings

| Priority | Area | Current representation | Backend required |
|---|---|---|---|
| P0 | Authentication and identity | Microsoft sign-in terminates at a `501` placeholder. Protected routes trust the client-controlled `X-User-Id` header. | Microsoft Entra OIDC, validated server-side sessions, secure cookies, logout/expiry handling, and authoritative route authorization. |
| P0 | Email and Microsoft Teams | `sendEmail()` only appends records to the in-memory `emails` or `teamsMessages` arrays. No message reaches an external inbox or Teams chat. | Real Gmail/SMTP and Microsoft Graph delivery, queueing/retry behavior, delivery status, and an audit trail of attempts. |
| P0 | Historical imports | The UI reports a successful import, but the route only adds batches, claims, expenses, and history to in-memory arrays. | A transactional import service that persists the batch and all imported rows, validates duplicates, and supports rollback or compensation. |
| P0 | File storage and access | Uploads are written to local disk, or an ephemeral temporary directory on Vercel. Downloads accept a spoofable `?uid=` identity and do not authorize access against the owning record. | Private object storage, attachment metadata, record-level authorization, safe download URLs, retention, and cleanup. |
| P0 | Human-readable claim numbers | Claim references use a process-local counter that resets on restart. The database column has no uniqueness constraint. | A PostgreSQL sequence or transactionally locked counter, plus a unique constraint on `claims.claim_number`. |
| P1 | Notification preferences | The Settings page reports that preferences were saved, but the route only mutates the current in-memory user. Notification creation does not consult those preferences. | Persist preferences and enforce event/channel choices in the notification dispatcher. |
| P1 | Administrative audit history | User and master-data changes appear in the runtime activity feed but are not written through by the history repository. | Persist and reload user- and master-data-scoped history entries with all entity identifiers intact. |
| P1 | Automatically created companies | Entering a new company while creating or editing a MOM adds it to the process-local company directory, but that implicit creation is not persisted. | Move get-or-create behavior into an async repository operation, ideally within the MOM/claim transaction. |
| P1 | Scheduled lifecycle work | Stale-approver escalation is triggered manually by an Admin. Delegation expiration is calculated lazily during reads and is not durably written when it changes. | A durable scheduler or job queue with idempotent escalation and expiration jobs. |
| P2 | Client PDF preview and delivery | The preview says it is exactly what the client receives, but it is an HTML approximation. The send route does not attach the generated PDF. | One canonical PDF builder used by preview, download, and backend delivery; attach those exact bytes to the outbound email. |
| P2 | Financial display fallbacks | When approved or paid values are missing, the frontend infers them using the reimbursement cap. | Require authoritative financial amounts from the backend and expose missing/inconsistent values rather than inventing them in the UI. |

## Detailed evidence and recommendations

### 1. Authentication, directory data, and organizational synchronization

Evidence:

- `server.ts:685` implements `/api/auth/microsoft/start`, but returns `501`
  even when the Microsoft environment variables are present.
- `server.ts:775` derives identity from `X-User-Id`.
- `src/lib/api.ts:27` stores the selected demo identity as `mockUserId` in
  browser `sessionStorage`.
- `server.ts:302` generates fake Entra object IDs for seeded users.
- `server.ts:1559` describes Admin edits to `reports_to` as a simulated Entra
  hierarchy sync.
- `server.ts:3233` exposes an Admin action that stands in for a scheduled
  stale-approver escalation job.

Production work:

1. Implement authorization-code OIDC with PKCE, state, nonce, issuer/audience
   validation, and tenant validation.
2. Store sessions server-side and use `HttpOnly`, `Secure`, `SameSite` cookies.
3. Resolve the validated Entra `oid` to the internal user record and remove
   `X-User-Id` and demo login in production.
4. Decide whether organization hierarchy comes from Microsoft Graph, an HRIS,
   or an administered internal source, then run synchronization as a durable
   scheduled job.
5. Fetch and proxy/cache Microsoft profile photos only after the required Graph
   permission is approved.

### 2. External email and Teams delivery

Evidence:

- `server.ts:346` defines `sendEmail()` as a mock transport.
- Internal recipients are appended to `teamsMessages`; external recipients are
  appended to `emails`.
- `server.ts:430` explicitly logs `MOCK TEAMS` or `MOCK EMAIL TRANSPORT`.
- `server.ts:2223` marks a MOM completed and invokes the mock sender.
- `src/pages/shared/MomDetail.tsx:83` displays a successful "Client copy sent"
  toast after that call.

Recommended design:

- Deliver client mail through an approved Gmail/Google Workspace integration or
  SMTP provider.
- Deliver internal notifications through Microsoft Graph when per-user Teams
  messages are required. A channel webhook is only suitable if notifications
  are intentionally broadcast to one fixed channel.
- Use a durable outbox/queue. Record `pending`, `sent`, `failed`, provider ID,
  attempt count, and the last error.
- Make MOM completion and delivery state explicit. A provider failure must not
  silently count as successful delivery.
- Retain in-app notification history, but base it on persisted delivery events
  rather than the current process-local arrays.

### 3. Historical import is not durable

Evidence:

- `server.ts:6594` creates an import batch and imported records only in arrays.
- The route does not call `persistClaim()`, `persistExpenseLineItems()`, or a
  repository for `import_batches`.
- `src/db/schema.ts:235` already defines the `import_batches` table, but no
  repository currently uses it.
- `src/pages/admin/HistoricalImport.tsx:112` tells the Admin that the import
  completed successfully.

This is higher risk than a cosmetic mock because the imported claims appear
real until the process restarts. Implement the import as one database
transaction: insert the batch, validate and insert claims and line items, insert
history, then commit. A failed row should either reject the whole batch or be
recorded through an explicit partial-import policy.

### 4. Upload storage and attachment authorization

Evidence:

- `server.ts:480` selects a local `uploads` directory or the operating system's
  temporary directory.
- `server.ts:714` serves attachments when any known user ID is supplied through
  a header or `?uid=` query string.
- The route does not verify that the user may access the claim, MOM, receipt, or
  liquidation owning that filename.

Move attachments to private object storage. Store an attachment record with the
owner entity, uploader, media type, size, storage key, checksum, and timestamps.
Every download should authorize the authenticated user against the linked
business record before streaming the file or issuing a short-lived signed URL.

### 5. Claim-number generation is process-local

Evidence:

- `server.ts:132` initializes `claimCounter` to `123`.
- `server.ts:2476` increments it to create `REIM-YYYY-NNNNNN` references.
- `src/db/schema.ts:158` defines `claim_number` without `.unique()`.

Use a database sequence or a row locked inside a transaction. Do not use
`SELECT MAX(...) + 1`, because concurrent requests can still receive the same
number. Add a database uniqueness constraint as a final integrity backstop.

### 6. Notification preferences are represented but not enforced

Evidence:

- `src/pages/shared/Settings.tsx:407` reports "Notification preferences saved".
- `server.ts:1969` only assigns `user.notification_prefs = req.body` and does
  not persist the changed user.
- `sendEmail()` never checks `notification_prefs`, so disabling a channel has no
  effect on subsequent notification creation.

Persist the preferences through the users repository, define the event-to-
preference mapping centrally, and enforce it before enqueueing in-app, email, or
Teams messages.

### 7. Some audit events remain process-local

Evidence:

- `server.ts:849` pushes user-change history directly into `statusHistories`.
- `server.ts:880` does the same for master-data changes.
- `src/db/coreLoopRepo.ts:280` maps persisted history, but sets `userId: null`
  and does not map `master_data_key` or `master_data_id`.

As a result, these entries can appear in Admin activity during the current
process but disappear after restart. Extend the repository mapper and persistence
guard to support user and master-data history, then verify those entries against
the real database.

### 8. Implicit company creation is not persisted

Evidence:

- `server.ts:208` defines a synchronous `getOrCreateCompany()` that only pushes
  into the `companies` array.
- `server.ts:2162` and `server.ts:2196` call it from MOM create/update paths
  without calling `persistCompany()` for a newly created company.

Return the created/existing company from an async repository operation and
persist it before completing the MOM write. A transaction should cover both
records when company creation and MOM creation occur together.

### 9. Scheduled status changes are simulated or lazy

Evidence:

- `server.ts:1511` expires delegations while another request happens to read or
  use them.
- That status mutation does not call `persistDelegation()`.
- `server.ts:3233` requires an Admin request to run stale-approver fallback
  escalation.

Use a scheduler/job worker with idempotency keys and database-backed job state.
The same transition functions may still be called defensively on reads, but the
scheduled path must persist the status and history.

### 10. Client preview is not the delivered PDF

Evidence:

- `src/components/shared/MomClientPreviewModal.tsx:26` says the preview is
  exactly what the client receives.
- The component renders HTML rows and paragraphs rather than PDF bytes.
- `src/lib/documentExport.ts:134` saves the generated PDF directly and does not
  expose a reusable Blob for preview or attachment.
- `src/lib/api.ts:1074` sends only an empty JSON request to the MOM send route.

Refactor PDF generation into a function returning a Blob or byte buffer. Reuse
the exact output for the embedded preview, local download, and outbound email
attachment.

### 11. Frontend financial fallbacks can hide incomplete backend data

Evidence:

- `src/lib/api.ts:316` calculates `fallbackApprovedAmount` with
  `Math.min(claimedAmount, 1000)`.
- The adapter substitutes that value when `approved_amount` or `paid_amount` is
  absent for a sufficiently advanced status.

The fallback is useful for legacy demo records, but it should not silently
invent production financial values. In production mode, return authoritative
amounts from the API and treat an absent amount as an incomplete/inconsistent
record requiring investigation.

## Intentionally demo-only behavior that does not need immediate replacement

The following are appropriate while `DEMO_MODE=true`, provided they remain
strictly unavailable in production:

- The role/account launcher and tab-scoped demo identities.
- Randomized year-of-data generation and Admin seed/reset controls.
- Form autofill buttons and generated sample receipt images.
- Seeded users, companies, master data, avatars, and transaction history.

These controls should remain for presentations. The production configuration
must set `DEMO_MODE=false`, `AUTH_MODE=microsoft`,
`ENABLE_DEMO_LOGIN=false`, `VITE_ENABLE_DEMO_LOGIN=false`, and
`AUTO_SEED=false`.

## Related backend hardening

These items are not mock representations, but should be completed alongside
the backend work above:

- Wrap multi-record claim/MOM/expense writes in database transactions.
- Add expiry, hashing, regeneration invalidation, and attempt throttling for
  release codes.
- Replace `drizzle-kit push` with reviewed, ordered migrations in the release
  pipeline.
- Add structured logging, health/readiness endpoints, rate limiting, monitoring,
  alerting, backup/restore tests, and retention policies.
- Keep the current app on one persistent Node process until routes read from the
  database per request or use a safe shared-cache design. The current in-memory
  read cache is not compatible with Vercel serverless or multiple application
  instances.

## Recommended implementation order

1. Entra authentication and server sessions.
2. Private object storage and attachment authorization.
3. Durable notification outbox plus Gmail and Teams delivery.
4. Transactional historical import.
5. Atomic claim-number generation and uniqueness constraint.
6. Notification-preference enforcement and complete audit persistence.
7. Durable scheduled jobs for hierarchy escalation and delegation expiration.
8. Exact PDF preview/attachment flow and removal of frontend financial fallbacks.

## Validation baseline

The repository was clean at `33ad22b` before this document was added. The
following checks passed against that baseline:

- `npm run lint`
- `npm test` — 67 tests across 10 files
- `npm run build`

