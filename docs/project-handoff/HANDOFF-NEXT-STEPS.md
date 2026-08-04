# Handoff — What's Left

Written 2026-08-04, updated 2026-08-04 after a follow-up session that closed
out most of the items this document originally listed (see "Resolved this
session" below) while working with no Microsoft/Google accounts available —
the two auth/email/Teams items in Section 2 are the reason those specific
gaps are still open, not lack of effort. Baseline is green: 70/70 vitest,
`tsc --noEmit` clean, production build succeeds.

Preview this repo with launch config **"new-ui"** (`npm run dev`, port
3000) — the only entry in this repo's `.claude/launch.json`.

---

## Resolved this session

These were previously listed here as open work. Kept as a record of what
changed and why, since the corresponding code comments/tests are the actual
source of truth going forward:

- **Real-PDF client preview** — `MomClientPreviewModal.tsx` now renders the
  literal generated PDF (`buildMomPdfBlob()` → `buildStructuredPdfBlob()` in
  `documentExport.ts`) in an `<iframe>`, not an HTML approximation. Verified
  live: the iframe's `src` is a genuine `blob:` URL whose bytes start with
  `%PDF-1.3` and content-type `application/pdf`.
- **Atomic claim-number generation** — `claims.claim_number` now has a
  `UNIQUE` constraint (`drizzle/0004_skinny_flatman.sql`) and is allocated
  from a Postgres sequence (`claim_number_seq`, `coreLoopRepo.ts`'s
  `nextClaimNumberFromDb()`) whenever `DATABASE_URL` is set, with the old
  in-memory counter kept only as the fully-in-memory-mode fallback. The demo
  seed generator's own numbering is kept in sync via
  `syncClaimNumberSequenceFloor()` so a live-database demo doesn't collide
  seeded and real claim numbers.
- **Historical import is now transactional** — `POST /api/imports` builds
  every row in memory first, then commits the batch + claims + line items +
  history as one Postgres transaction (`persistHistoricalImportBatch()`);
  any failure (e.g. a duplicate claim number hitting the new unique
  constraint) rejects the whole batch instead of reporting success while
  only the in-memory arrays were touched.
- **Upload download authorization** — `/uploads/:filename` no longer serves
  a file to any logged-in user. It resolves the file back to the
  claim/expense-line-item/MOM/liquidation-line-item that references it and
  applies that record's own access rule (`canAccessClaim`/`canAccessMom`/
  `canAccessLiquidation`, now shared with the entities' own detail routes
  instead of being duplicated). A file with no known owner (e.g. uploaded
  but never attached) is treated as not found, not as fetchable by anyone —
  verified this doesn't break the submit flow, which previews a freshly
  picked file from a local blob URL, never this route. Object storage
  migration itself (moving off local disk) is still open — see below.
- **Notification preferences** — `PUT /api/me/notification-prefs` now
  persists via `syncUsersToDb()` (previously mutated the in-memory user
  only). `sendEmail()` gained an `eventKey` option and a `shouldNotify()`
  check, wired into the ~11 call sites that map 1:1 onto Settings >
  Notifications' five categories (submitted/approved/returned/ready/
  delegation); everything else (custodian ops mail, escalations, support
  messages, client CCs) has no matching toggle and is intentionally left
  unconditional. A category only suppresses when *both* in-app and email
  are off, since `sendEmail()` still creates one record backing both
  channels — see the comment on `shouldNotify()` for why a real
  channel-level split needs the notification record model split first.
- **Implicit company creation persists** — `getOrCreateCompany()` (real MOM
  create/update paths) now awaits `persistCompany()` for a newly created
  company. The demo seed generator keeps a separate, deliberately
  non-persisting `getOrCreateCompanyInMemory()` so repeated auto-seeding on
  every dev restart doesn't churn a live database with regenerated demo
  company rows.
- **User/master-data audit history persists** — `addUserHistory()`/
  `addMasterDataHistory()` now call `persistStatusHistoryFireAndForget()`
  (previously write-only into the in-memory array). `historyToRow()`'s
  hardcoded `userId: null` was dropping these rows outright; fixed, plus new
  `loadUserHistoryFromDb()`/`loadMasterDataHistoryFromDb()` boot-time
  loaders (`usersRepo.ts`/`referenceDataRepo.ts`).
- **Delegation expiry now persists, and stale-approver escalation is no
  longer purely manual** — `syncDelegationStatuses()` now fire-and-forget
  persists a flipped-to-Expired delegation (previously only mutated the
  in-memory array). An hourly in-process scheduler
  (`setInterval`, skipped under `VERCEL=1` so it doesn't leak into the test
  harness) now also runs both jobs automatically; the Admin Dashboard's
  manual "Run Fallback Check" button still works (now a thin wrapper around
  the same shared `runStaleApproverFallbackCheck()`) for demoing without
  waiting on the schedule.
- **Frontend financial fallback gated on demo mode** — `fromServerClaim()`
  in `src/lib/api.ts` only infers a capped display amount for a legacy
  record missing `approved_amount`/`paid_amount` when `demoModeEnabled` is
  true (threaded through from `/api/auth/config` via `loadWorkspace()`).
  Production mode now leaves the value `undefined`/`0` instead of inventing
  a plausible-looking number. The equivalent server-side inference in
  `buildAnalyticsRecords()` (financial-records/analytics endpoint) is
  **not** gated the same way yet — its fields are non-optional numbers
  summed directly into dashboard/report totals, so switching it needs those
  summation sites audited first; left a comment pointing at this doc.
- **MOMs list filter parity with Claims** — `MOMs.tsx` already had the same
  search/filter-popover/chip pattern as `ClaimsList.tsx`, just fewer
  dimensions. Added document-type, client, location, and meeting-date-range
  filters so it matches. Note: this is parity via matching, independently
  implemented filter UIs, not a shared extracted component — Receipts.tsx's
  filter logic is deeply coupled to its own data model (claim/expense
  cross-references) and wasn't touched; building one true shared FilterBar
  across all three list views is still a larger, unstarted refactor if that
  level of unification is wanted.
- **One terminology fix** — `Settings.tsx`'s demo-data description used the
  bare "MOM" abbreviation while every other item in that same list spells
  things out in plain English; changed to "Minutes of Meeting record" to
  match. Checked "Type of Account" phrasing and found it already consistent
  everywhere (form label, exports, previews all agree) — no change needed
  there. This was a light, targeted pass, not the full copy audit the
  original ask described; a broader button-verb/label consistency review
  is still open if wanted.

---

## 1. Backend email/Teams sending doesn't exist yet — needed before "Send to client" is real

**Still the biggest gap, and still blocked on accounts this environment
doesn't have.** `sendEmail()` in `server.ts` is **fully mocked**: it never
contacts any real service. It just pushes a record into an in-memory
`emails` array (or `teamsMessages` if the recipient resolves to an internal
user), which is only ever displayed back inside this app's own UI (System
Emails page / notifications). Clicking "Send to client" today does **not**
deliver anything to a real inbox — for anyone, demo or production — and it
doesn't attach a PDF at all currently, even though the export buttons sit
right next to it (the PDF preview/export side of this is now fixed — see
"Resolved this session" above — only the delivery side remains).

Confirmed via `.env.example` — there are no email- or Teams-provider
variables defined anywhere (only Supabase and Microsoft Entra/auth are
wired up, and that Entra wiring isn't live yet either — see
`docs/project-handoff/MICROSOFT-AUTH-HANDOFF.md`).

**Client says: client-facing mail should go out as real email (Gmail);
internal notifications should go through Microsoft Teams.** Convenient
detail — `sendEmail()`'s existing branch (`if (recipient) → teamsMessages,
else → emails`) is *already shaped* exactly like this split, and now also
carries the `eventKey`-based preference check described above. The fix
isn't a redesign, it's replacing each mocked branch with a real
integration.

### 1a. Client emails → real email via Gmail

Two ways to stand this up, in order of recommendation:

1. **Gmail API with a Google Workspace service account (domain-wide
   delegation).** Requires: a Google Cloud project, a service account with
   the `gmail.send` scope, and a Workspace admin granting domain-wide
   delegation so the service account can send *as* a real mailbox (e.g.
   `noreply@mgenesis.com` or whichever address the client wants email to
   come from). This is the right answer if the company has Google Workspace
   — it supports attachments natively (MIME multipart), doesn't hit Gmail's
   consumer sending limits as hard, and doesn't depend on a fragile personal
   App Password.
2. **Nodemailer + a Gmail account's App Password (SMTP).** Much faster to
   stand up (no Google Cloud project, no admin consent flow) but only
   really works for a single sending mailbox, requires 2FA + an App
   Password on that account, and Gmail's ~500 messages/day sending limit
   applies. Fine as a stop-gap or for a small volume of client sends; not a
   long-term answer if volume grows.

   Whichever is chosen, both need env vars (e.g. `GMAIL_SENDER_EMAIL` +
   either `GOOGLE_SERVICE_ACCOUNT_JSON`/`GOOGLE_APPLICATION_CREDENTIALS`, or
   `GMAIL_APP_PASSWORD` for the Nodemailer route), documented in
   `.env.example`.
3. **Confirm the from-address is something Gmail is authoritative for** —
   if the plan is to send *as* `@mgenesis.com` rather than a literal
   `@gmail.com` mailbox, that domain still needs SPF/DKIM records set up
   for Gmail/Workspace's sending IPs (Google handles most of this
   automatically once Workspace is confirmed for the domain, but it's worth
   verifying, not assuming). DNS-level, needs the domain owner/IT.
4. Attachments: this is where the real PDF from `buildMomPdfBlob()` (now
   the single source of truth for PDF bytes — see "Resolved this session")
   gets attached — base64-encode the PDF bytes into the MIME message (Gmail
   API) or pass as a Nodemailer `attachments` entry.

### 1b. Internal notifications → Microsoft Teams

1. **Reuse the Microsoft Entra app registration that's already planned for
   auth** (`MICROSOFT_TENANT_ID`/`CLIENT_ID`/`CLIENT_SECRET` already exist
   in `.env.example`, per `docs/project-handoff/MICROSOFT-AUTH-HANDOFF.md`)
   rather than standing up a second, unrelated Azure integration. Extend
   that same app registration's Graph API permissions to include
   chat-sending scope (e.g. `Chat.ReadWrite` / `ChatMessage.Send`), which
   needs a tenant admin to grant consent.
2. **Two Graph API shapes, pick based on what's needed:**
   - **Incoming Webhook to a Teams channel** — simplest to set up (no Graph
     auth needed beyond the webhook URL itself), but can only post to a
     fixed channel, not DM a specific user. Fine for broadcast-style
     notices, not for "notify this one approver."
   - **Graph API `chatMessage` to a 1:1 or group chat** — can target a
     specific internal user (matches what `teamsMessages` already models:
     `recipient_id` per message), but needs the app registration to have
     been granted the right delegated/application permission and (for
     application permissions) admin consent.
   Given `teamsMessages` already carries a `recipient_id`, the Graph
   `chatMessage` route is the one that actually matches current behavior —
   the webhook route would be a behavior change (channel post instead of a
   personal notification).
3. Since this reuses the Entra app registration, this work is naturally
   sequenced *after* (or alongside) the auth cutover — same app
   registration, just a different Graph scope.

### 1c. Shared groundwork for both

1. **Extend `sendEmail()`** to be `async`, branch into the two real
   integrations above instead of pushing to the mock arrays, and accept an
   attachment (filename + bytes + mime type) — it currently only takes a
   subject/body string (plus the `eventKey` preference option added this
   session).
2. **Error handling.** Provider calls can fail or rate-limit. Decide:
   should `POST /api/moms/:id/send` roll back `mom.status` to `Draft` on
   failure, retry, or queue for later? Right now the route always marks the
   MoM `Completed` regardless of whether the (mocked) send "succeeded" —
   that assumption breaks the moment sending can actually fail.
3. **Where does the PDF attachment come from at send time?** With
   `buildMomPdfBlob()` now returning bytes directly (see "Resolved this
   session"), two options:
   - Client generates the PDF blob and uploads it via the existing
     `/api/upload` endpoint right before calling `sendMomToClient()`;
     server reads that file and attaches it to the Gmail send.
   - PDF generation moves server-side (e.g. `pdfkit`, `puppeteer`, or
     `@react-pdf/renderer`) so the attachment never needs a browser round
     trip. Heavier change, but avoids depending on the client having
     already generated the file.
   Recommend the first option — smaller diff, reuses what's already built.
4. **Storage durability note:** this repository contains Vercel
   configuration, but the current in-memory read-cache architecture must
   not be deployed to Vercel serverless. File uploads currently write to
   local disk via multer (`server.ts`, `/uploads/:filename` — now with
   per-resource read authorization, see "Resolved this session," but still
   local-disk storage). Vercel's filesystem is ephemeral per invocation —
   this is a **pre-existing** issue for receipt uploads too, and becomes
   more pressing if generated PDFs are expected to survive between the
   upload call and the send call in a serverless environment. Moving to
   real object storage (Supabase Storage / S3) is still open.
5. Keep the mocked `emails`/`teamsMessages` arrays as an **audit trail**
   even once real sending exists — record what was actually sent (or
   attempted) alongside the real provider call, so System Emails/
   notifications still shows an accurate history instead of going dark.

---

## 2. Carried over — not started

- **Private object storage for uploads.** Files still live on local disk
  (or ephemeral `/tmp` on Vercel). This session fixed *who may download* a
  given file (see "Resolved this session"); moving the files themselves to
  Supabase Storage/S3 with signed URLs and record-level authorization is
  still open, and matters more once serverless deployment or PDF-attachment
  delivery (Section 1) is in play.
- **Migration pipeline.** Schema changes still apply via `drizzle-kit push`
  (live diff against the database) rather than reviewed `drizzle-kit
  generate` + an explicit `migrate()` step. `drizzle/0004_skinny_flatman.sql`
  (this session's claim-number-sequence migration) is the first migration
  file that's actually current with `schema.ts`; earlier drift between the
  migrations folder and the live-pushed schema was caught and folded into
  that same generated file.
- **Row-Level Security (RLS)** is off on every Supabase table. Low risk
  today but worth enabling with default-deny policies as defense-in-depth —
  needs Supabase dashboard access this environment doesn't have.
- **Broader filter/terminology polish.** See "Resolved this session" above
  for what specifically closed (MOMs parity, one terminology fix) versus
  what's still open (a true shared FilterBar component; a full label/
  button-verb consistency audit).
- **`DynamicFieldRenderer.tsx`'s text/number/date inputs have a standing
  `// TODO: validation not enforced yet`** — dropdown and textarea fields
  get basic error-state styling from the parent form's `errors` prop, but
  nothing in this component itself validates a custom field's value against
  its type/required-ness. Pre-existing, unrelated to this session's changes.

---

## Building blocks already in place (reuse, don't duplicate)

- `momSections(mom, 'client' | 'internal')` in `src/lib/momExport.ts` — the
  single source of truth for which fields the client sees vs. the internal
  copy (currently only Type of Account is hidden from the client).
- `buildMomPdfBlob(mom, audience)` in `src/lib/momExport.ts` and
  `buildStructuredPdfBlob(...)` in `src/lib/documentExport.ts` — the single
  source of truth for PDF *bytes*, shared by the on-screen preview, the
  local download, and (once wired up) the outbound email attachment.
- `src/components/shared/MomClientPreviewModal.tsx` — shared by
  `MomDetail.tsx`, `CreateMom.tsx`, and `SubmitClaim.tsx`.
- `src/lib/momContacts.ts` — multi-contact-person serialization
  (`serializeContacts`/`parseContacts`/`contactsFromMom`), packed into the
  existing `contact_person` text column, no schema change.
- `src/components/shared/ContactPersonsField.tsx` — repeatable Name +
  Designation rows, used in both MoM forms.
- `sendEmail()`'s existing `if (recipient) → teamsMessages, else → emails`
  branch in `server.ts`, now also gated by `shouldNotify()`/`eventKey` —
  reuse the branch, replace what each side does.
- `canAccessClaim`/`canAccessMom`/`canAccessLiquidation` in `server.ts` —
  the shared access predicates behind both each entity's own detail route
  and the `/uploads/:filename` gate. Reuse these for any new per-resource
  authorization check rather than re-deriving the rules.
- `.env.example` already has `MICROSOFT_TENANT_ID`/`CLIENT_ID`/
  `CLIENT_SECRET` placeholders — the Teams integration should extend that
  same Entra app registration's Graph scope rather than creating a second
  Azure app.
