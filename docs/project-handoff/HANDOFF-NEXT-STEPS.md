# Handoff — What's Left

Written 2026-08-04, updated 2026-08-04 after a follow-up session that closed
out most of the items this document originally listed (see "Resolved this
session" below) while working with no Microsoft/Google accounts available —
the two auth/email/Teams items in Section 2 are the reason those specific
gaps are still open, not lack of effort. Updated across three sessions on
2026-08-05 (see "Resolved 2026-08-05", "(continued)", and "(batch 3)"
below): test-suite hermeticity + dynamic-field validation + migration
tooling; unlisted-company dedup + pending-review queue; then rate limiting,
health/readiness endpoints, self-hosted fonts + CSP, structured request
logging, server-side financial-fallback gating, a shared FilterBar
component replacing three independently-built filter UIs, a terminology
pass, and the `jspdf` critical CVE fix. Baseline is green: 87/87 vitest (up
from 70 at the start of 2026-08-05), `tsc --noEmit` clean, production build
succeeds, `npm audit` down to 6 (0 critical, 2 high, 4 moderate dev-only).

**Preview launch config gotcha:** this repo's own `.claude/launch.json` names
its one entry **"new-ui"**, but if this repo sits inside a parent workspace
that *also* has its own `.claude/launch.json` (as it did during 2026-08-05's
sessions — `D:\Sales-Reimbursement-NewUI\` above this repo), a same-named
`"new-ui"` entry there can silently take precedence and serve a *different,
older* copy of this app instead. If a preview looks stale or shows an
unexpected old UI, check for a shadowing config in a parent directory before
assuming the code regressed — this cost real debugging time on 2026-08-05.
In that environment, the working config name was **"latest-30"**.

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
- ~~Row-Level Security (RLS) is off on every Supabase table.~~ **Corrected
  2026-08-05 — this was never actually true.** Checked directly via the live
  `DATABASE_URL` connection: RLS is **on** for every table (`pg_tables.
  rowsecurity = true` across the board — Supabase's default for new tables),
  just with **zero policies** defined, which functionally means default-deny
  for any role without `BYPASSRLS`. The app's own Postgres connection
  (`postgres` role) has `BYPASSRLS = true`, so this is invisible to the
  app's own read/write path either way — it only matters if something else
  ever connects with a different Supabase role (e.g. the client-side
  Supabase SDK with an `anon`/`authenticated` key), which nothing in this
  codebase does today. Not an active gap; worth revisiting if that changes.
- ~~Shared FilterBar component.~~ **Resolved 2026-08-05** — see "Resolved
  2026-08-05 (batch 3)" below.
- **Full label/button-verb consistency audit.** Only one terminology fix
  ("MOM" → "Minutes of Meeting record" in Settings.tsx) has been done; a
  broader pass across the ~40 files using `<Button>`/`<Label>` is still
  open if wanted.

## Resolved 2026-08-05

- **Test suite was silently writing into the live database.** `server.ts`'s
  `import 'dotenv/config'` meant any local `.env` with a real `DATABASE_URL`
  got picked up by the vitest run too — the route/workflow smoke tests
  (`core-loop.smoke.test.ts`, `workflow-guards.test.ts`) exist to exercise
  the in-memory server, not Postgres, but were POSTing real claims into
  whatever database happened to be configured. This also meant the suite
  failed outright (15/70) whenever that database was missing a migration —
  which it was: the connected Supabase database had never had
  `drizzle/0004_skinny_flatman.sql` applied, so `nextClaimNumberFromDb()`'s
  `nextval('claim_number_seq')` hit Postgres error `42P01` (undefined
  relation). Fixed with `test/setup.ts` (wired into `vitest.config.ts`),
  which forces `DATABASE_URL=''` before any test file's dynamic
  `import('../server')` runs — dotenv only fills *undefined* keys, so an
  already-set empty string survives `import 'dotenv/config'`. Suite is now
  hermetic and dropped from 144s to ~4-7s.
  **Note:** this only fixed the *test* path being pointed at an unmigrated
  database — the live Supabase database itself still lacks migration 0004,
  so claim creation will still 500 there until `npm run db:migrate` is run
  against it (see "Resolved 2026-08-05" migration-pipeline item below).
- **`DynamicFieldRenderer.tsx`'s standing `// TODO: validation not enforced
  yet`** — closed. Added `src/lib/dynamicFieldValidation.ts`, a shared
  validator enforcing required-ness, `number`/`date` type correctness, and
  the `min`/`max`/`minLength`/`maxLength`/`pattern` constraints that already
  existed on `FieldDefinition.validation` but were never read anywhere.
  Wired into both `SubmitClaim.tsx` call sites (claim fields, MoM fields)
  and newly added to `CreateMom.tsx`, which previously had **no** dynamic
  custom-field validation at all — a real gap relative to SubmitClaim, not
  just a copy-paste omission. 8 new unit tests
  (`src/lib/dynamicFieldValidation.test.ts`); one caught a genuine bug
  during development — `Date` silently rolls over impossible days
  (`2026-02-30` → March 2) instead of erroring, fixed with an explicit
  round-trip check on the parsed year/month/day.
- **Migration pipeline.** `npm run db:migrate` (`src/db/migrate.ts`) now
  applies the reviewed SQL files under `drizzle/` via Drizzle's own
  `migrate()` runner (tracked in a `drizzle.__drizzle_migrations` table, so
  re-running is a no-op). Workflow going forward: edit `schema.ts` → `npm
  run db:generate` (writes a new numbered file, review it like any other
  diff) → `npm run db:migrate` (applies pending files in order). `db:push`
  is left available for fast local iteration but is no longer the
  release-pipeline path. **Not yet run against the connected Supabase
  database** — deliberately, since it mutates live shared data; someone
  with ownership of that database should run it (it will apply
  `0004_skinny_flatman.sql`, among any later files).

---

## Resolved 2026-08-05 (continued) — unlisted-company flow

**The ask:** the "Client / Company" field on MoM/claim forms only offered a
directory `<Select>` (or, in `SubmitClaim.tsx`, a directory-vs-free-text
toggle), and the server auto-created a company on an unmatched name with only
exact case-insensitive dedup — "Meralco" / "Meralco Inc." / "MERALCO" would
each become a separate directory row with nothing to catch it. Requested:
let a requestor add a genuinely-new company without turning every submission
into admin busywork, while actually solving the duplicate problem.

**What shipped:**
- `src/lib/companyMatch.ts` — normalizes a name (lowercase, strips
  punctuation and legal suffixes like "Inc"/"Corp"/"Ltd") and scores
  similarity via Levenshtein distance + a containment bonus. Two tiers:
  `findExactMatch` (≥0.92 — "this is the same company, differently typed")
  and `findSimilarCompanies` (0.55–0.92 — "did you mean?" suggestions).
  9 unit tests (`companyMatch.test.ts`).
- `src/components/shared/CompanyPicker.tsx` — replaces the old
  Select/toggle in both `CreateMom.tsx` and `SubmitClaim.tsx` (one component,
  two forms, no more parallel implementations to keep in sync). Always an
  editable text field; live-suggests "Use existing: X" for a near-exact
  match or a "Did you mean?" list for weaker matches, and shows an
  informational "will be added as a new company, flagged for admin review"
  note when nothing matches. Selecting a suggestion snaps the field to the
  real record (same object each form's existing `applyCompanyDefaults`/
  `selectCompany` already used to prefill location/contact) — this is a UX
  nudge, not a hard block; an unmatched name still goes through.
- **`pending_review` + `created_by` on `companies`** (`schema.ts`, migration
  `drizzle/0005_bored_colonel_america.sql` — **not yet applied to the live
  DB**, same status as 0004, see "Migration pipeline" above). `server.ts`'s
  `getOrCreateCompany(name, userId)` now sets both on auto-create; the
  company is immediately usable (pushed into `companies` before the MoM/claim
  save returns) — nothing about the requestor's submission waits on a review
  happening. Admin-created companies (`POST /api/companies`) default
  `pending_review: false`; editing any other field on a pending company via
  `PUT /api/companies/:id` auto-clears the flag (an edit is itself a review),
  and there's also an explicit toggle for "looks fine as-is, just clear it."
- **`CompanyDirectory.tsx`** — a "N pending review" chip next to the page
  title (click to filter), a "Pending review" badge per row, a review-status
  filter, and a one-click "Mark reviewed" button beside "Edit" for pending
  rows.
- **Verified live, end-to-end** (not just unit tests): typed "Creativ Agency"
  (typo) into the MoM form → got "Use existing: Creative Agency" → selected
  it → field snapped to the real record. Typed "Zenith Industrial Supply"
  (genuinely new) → saved the MoM successfully → confirmed via `GET
  /api/companies` it was created with `pending_review: true, created_by:
  "u13"` → confirmed it appeared in Company Directory with the badge and
  under the pending filter → clicked "Mark reviewed" → confirmed
  `pending_review: false` persisted after a fresh fetch.
- **Caught during this session:** `npm run dev` runs plain `tsx server.ts`
  with no `--watch` — unlike the Vite-served frontend, **`server.ts` edits
  need a manual dev-server restart** to take effect; the first attempt to
  verify this feature silently ran against a stale server process and the
  new company was never created. Worth remembering for any future
  `server.ts` change verified against a long-running preview session.

---

## Resolved 2026-08-05 (batch 3) — operational hardening + shared FilterBar

A third 2026-08-05 session, working through the "what can we do right now"
list from the production-readiness audit (the P0 auth/storage items and the
`react-router-dom` CVE stayed out of scope — see below for why):

- **Rate limiting** — `express-rate-limit`, two tiers: a 30-per-15-min limiter
  on `/api/auth/*` (the identity-attempt surface, including the mock
  `X-User-Id` path and the future Entra hand-off), and a 300-per-15-min
  limiter on every other `/api` write (GET/HEAD/OPTIONS pass through
  unlimited). **Caught during verification:** the auth limiter's first cut
  counted `/api/auth/config` — a public, side-effect-free capability read the
  frontend fetches on *every single page load* — which meant normal
  navigation could exhaust the limit and lock a user out of loading pages at
  all. Fixed with an explicit `skip` for that one route; verified by
  navigating repeatedly and confirming no more 429s.
- **Health/readiness endpoints** — `GET /healthz` (liveness) and
  `GET /readyz` (liveness + a real `select 1` round-trip against Postgres
  when `DATABASE_URL` is set, not just "is the env var present"). Both
  top-level (not under `/api`), unauthenticated, and registered before the
  rate limiters so a monitoring probe is never throttled.
- **Self-hosted fonts + CSP enabled** — replaced the three Google Fonts CDN
  `<link>` tags in `index.html` with `@fontsource-variable/hanken-grotesk`,
  `@fontsource-variable/jetbrains-mono`, and
  `@fontsource/material-symbols-outlined` (static 400-weight cut only — the
  app's own CSS only ever uses one fixed point on that font's variable axes,
  never a range), imported in `main.tsx`. **Two non-obvious fixes needed
  beyond just swapping the font source:** (1) the self-hosted variable-font
  packages register under different family names (`'Hanken Grotesk
  Variable'`, not `'Hanken Grotesk'`) — `index.css`'s `--font-hanken`/
  `--font-mono` tokens needed updating to match; (2) Google's Material
  Symbols CDN response used to bundle the `.material-symbols-outlined {
  font-family: ... }` rule itself alongside the `@font-face` — self-hosting
  the font alone silently dropped that binding, so icons would have rendered
  as literal text ("close", "add", ...) instead of glyphs until it was added
  explicitly to `index.css`. With no external font origin left, `helmet`'s
  `contentSecurityPolicy` is now on (`server.ts`) — `'self'`-only for
  fonts/scripts/style/connect in production, with `'unsafe-inline'`/
  `'unsafe-eval'`/`ws:` allowed only when `NODE_ENV !== 'production'` (Vite's
  dev-mode HMR client needs them; the built app doesn't). Verified live: no
  CSP-violation console errors, font files serving 200 from `localhost`
  rather than Google's CDN, computed `font-family` resolving correctly, icon
  glyphs rendering (not literal text).
- **Structured request logging** — `pino` + `pino-http`, mounted before
  `helmet`/`cors` so even a request they'd reject still gets a correlation
  ID. Every request gets an `X-Request-Id` (reused from an inbound
  `X-Request-Id` header if the caller already set one) and a structured
  JSON start/finish log line; pretty-printed via `pino-pretty` in dev,
  plain JSON in production. **Scope note:** this adds request-level tracing
  — it does not retrofit the ~70 existing `console.log`/`console.error`
  call sites elsewhere in `server.ts` (mock-transport debug output, `[db]`
  persistence-failure warnings) onto the structured logger. That's a
  separable, much larger follow-up if wanted, using the same `logger`
  export. `test/setup.ts` now also sets `LOG_LEVEL=silent` — pino-http's
  per-request access log was flooding test output otherwise.
- **Server-side financial-fallback gating** — `buildAnalyticsRecords()`'s
  claim branch (`server.ts`) now only infers a plausible capped
  `approvedAmount`/`paidAmount` for a legacy record missing the real field
  when `demoModeEnabled` is true, matching `src/lib/api.ts`'s
  `fromServerClaim()`. In production it now falls back to `0` instead of a
  made-up number. `AnalyticsRecord.approvedAmount`/`paidAmount` stay
  non-optional numbers (unlike the frontend `Claim` type) since they're
  summed directly into dashboard/report totals and a CSV export's
  `.toFixed(2)` — switching to `undefined` would need every summation site
  and the CSV formatter updated too, which is why this was previously left
  unaddressed. Scoped precisely to the one branch actually flagged; the
  Cash Advance branch's similar-shaped `paidAmount` fallback has different
  semantics (no real `approved_amount`-equivalent field exists on cash
  advances at all) and wasn't touched.
- **Shared `FilterBar` component** — `src/components/shared/FilterBar.tsx`
  replaces three independently-built (but structurally identical) search +
  quick-filter + "More filters" popover + active-chips UIs in
  `ClaimsList.tsx`, `MOMs.tsx`, and `Receipts.tsx` — the refactor flagged as
  its own focused pass in earlier sessions (see "Carried over" below, now
  resolved). Each page keeps its own filter *dimensions* via a config array
  (`quickFilters`/`advancedFilters`, typed as `select`/`dateRange`/
  `numberRange` specs) — the component only owns the shared shell.
  `popoverExtra` is a slot for Receipts' one-click "Quick views" preset
  buttons (Missing receipts, This month, ...), which set several filters at
  once and don't fit the single-field-per-spec shape. Verified live on all
  three pages: quick filters, popover fields, chips, badge counts, and (on
  Receipts specifically) a "Quick views" preset button all confirmed
  working end-to-end, not just typechecking. MOMs' filter panel changed
  from an inline toggle-panel to the same floating popover ClaimsList/
  Receipts use — a deliberate visual unification, not a regression (same
  filter dimensions and behavior underneath).
- **Terminology pass** — found and fixed one real mismatch introduced by
  this session's own new code: `CompanyPicker.tsx`'s "will be added... 
  flagged for admin review" vs. Company Directory's consistent "Pending
  review" badge/filter wording for the exact same state — aligned to match.
- **`jspdf` critical CVE fixed** — `3.0.3` → `4.2.1` (forward upgrade, not a
  downgrade). The codebase only uses jsPDF's stable core text-drawing API
  (`setFont`, `text`, `splitTextToSize`, `output('blob')`, ...), unaffected
  by the 4.x hardening changes. Verified live: triggered a real "Export PDF"
  click, inspected the actual blob bytes — valid `%PDF-1.3` header, correct
  `application/pdf` MIME type.
- **`react-router-dom`'s high CVE deliberately left alone.** The
  advisory (`GHSA-qwww-vcr4-c8h2`) is a React-Server-Components-*mode*
  CSRF bypass; this app is a plain Vite SPA with zero RSC usage anywhere,
  so the actual exposure is very likely nil. The only available "fix" is a
  7-minor-version *downgrade* (`7.18.2` → `7.11.0` — nothing above the
  vulnerable range has been published yet), which is real regression risk
  for a threat model that doesn't apply here. Flagged for a product-owner
  decision rather than acted on unilaterally.
- **Not done this session, needs your decision:**
  - **Live database migration + a data-quality problem it surfaced.**
    Attempted `npm run db:migrate` against the connected Supabase database
    (explicit go-ahead given) and found the live `claims` table has **252 of
    254 rows with duplicate `claim_number` values** (one number shared by up
    to 36 separate rows) — almost certainly demo-seed pollution accumulated
    across many dev-server restarts, since writes persist to Postgres
    regardless of `DEMO_MODE`. This blocks migration 0004's `UNIQUE`
    constraint outright (Postgres refuses to add a unique constraint over
    existing duplicates). A direct raw-SQL attempt to apply just the safe
    parts (the sequence + the `companies` columns from 0005) was also
    blocked by Claude Code's own auto-mode safety classifier for being raw
    DDL against live shared data outside the sanctioned migration tooling.
    **Nothing was applied.** Someone with authority over that database needs
    to decide how to handle the duplicates (delete the pollution,
    investigate further, or something else) before `db:migrate` can
    complete cleanly.
  - **`DEMO_MODE=false` not flipped.** The live database's reference data is
    nearly empty — `field_definitions` has 1 row (demo mode seeds 6+), and
    all six master-data catalogs (branches, business units, cost centers,
    departments, project codes, vendors) have **0 rows**. Flipping
    `DEMO_MODE=false` today would boot the app with empty Category/Type of
    Account/cost-center/department dropdowns — a real functional
    regression, not just a cosmetic one, since `FieldDefinitionsAdmin`'s
    options editor and every `DynamicFieldRenderer` consumer depend on that
    data existing. Needs real reference data seeded into the live database
    first.

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
