# Handoff — What's Left

Written 2026-08-04 after a session that shipped: multi-recipient CC on MoM,
edit-anytime MoM, client-copy export/preview (omits Type of Account), grouped
approver receipts (by team member / by client), and multiple contact persons
with designations. Baseline is green: 67/67 vitest, `tsc --noEmit` clean.

Preview this repo with launch config **"latest-30"** (`npm run dev`, port
3000) — NOT "latest" (stale sibling clone) or "new-ui" (older `app/` copy).

---

## 1. "Preview client copy" should show the real PDF, not an HTML mock-up

**Current state:** `src/components/shared/MomClientPreviewModal.tsx` renders
the client-facing fields as HTML (`<dl>`/`<dt>`/`<dd>` rows) — a close visual
approximation of the document, not the literal file. Meanwhile "Export → PDF
for client" generates an actual PDF via `jsPDF` in
`src/lib/documentExport.ts` (`exportStructuredPdf`), and the client asked
specifically to preview *the PDF that gets sent*, since only the PDF copy is
emailed.

**What to do:**
1. Refactor `exportStructuredPdf()` in `src/lib/documentExport.ts` so PDF
   *generation* is separable from *saving to disk*. Right now it ends with
   `pdf.save(...)`. Add something like `buildStructuredPdfBlob(...)` that
   returns the `Blob` (via jsPDF's `pdf.output('blob')`), and have the
   existing save-to-disk export call that + trigger the download, so there's
   one source of truth for PDF bytes.
2. In `MomClientPreviewModal.tsx`, generate that blob from
   `momSections(mom, 'client')` (already the single source of truth for what
   the client sees — reuse it, don't duplicate field-filtering logic), turn
   it into an object URL (`URL.createObjectURL`), and render it in an
   `<iframe src={blobUrl}>` (or `<embed type="application/pdf">`) instead of
   the current HTML rows. Revoke the URL on modal close/unmount to avoid
   leaking memory.
3. Regenerate the blob whenever the underlying `mom` prop changes (e.g. user
   edits the form live in `CreateMom.tsx`'s preview) — don't memoize past
   that.
4. This also affects **"Send to client"** — see below, since sending needs
   this same PDF attached, not just previewed.

---

## 2. Backend email/Teams sending doesn't exist yet — needed before "Send to client" is real

**This is the bigger gap.** `sendEmail()` in `server.ts` (~line 346) is
**fully mocked**: it never contacts any real service. It just pushes a
record into an in-memory `emails` array (or `teamsMessages` if the recipient
resolves to an internal user), which is only ever displayed back inside this
app's own UI (System Emails page / notifications). Clicking "Send to client"
today does **not** deliver anything to a real inbox — for anyone, demo or
production — and it doesn't attach a PDF at all currently, even though the
export buttons sit right next to it.

Confirmed via `.env.example` — there are no email- or Teams-provider
variables defined anywhere (only Supabase and Microsoft Entra/auth are
wired up, and that Entra wiring isn't live yet either — see
`docs/microsoft-auth-handoff.md`).

**Client says: client-facing mail should go out as real email (Gmail);
internal notifications should go through Microsoft Teams.** Convenient
detail — `sendEmail()`'s existing branch (`if (recipient) → teamsMessages,
else → emails`) is *already shaped* exactly like this split. The fix isn't
a redesign, it's replacing each mocked branch with a real integration.

### 2a. Client emails → real email via Gmail

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
4. Attachments: this is where the real PDF from item 1 above gets attached
   — base64-encode the PDF bytes into the MIME message (Gmail API) or pass
   as a Nodemailer `attachments` entry.

### 2b. Internal notifications → Microsoft Teams

1. **Reuse the Microsoft Entra app registration that's already planned for
   auth** (`MICROSOFT_TENANT_ID`/`CLIENT_ID`/`CLIENT_SECRET` already exist
   in `.env.example`, per `docs/microsoft-auth-handoff.md`) rather than
   standing up a second, unrelated Azure integration. Extend that same app
   registration's Graph API permissions to include chat-sending scope
   (e.g. `Chat.ReadWrite` / `ChatMessage.Send`), which needs a tenant admin
   to grant consent.
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
   sequenced *after* (or alongside) `docs/microsoft-auth-handoff.md`'s
   auth cutover — same app registration, just a different Graph scope.

### 2c. Shared groundwork for both

1. **Extend `sendEmail()`** to be `async`, branch into the two real
   integrations above instead of pushing to the mock arrays, and accept an
   attachment (filename + bytes + mime type) — it currently only takes a
   subject/body string.
2. **Error handling.** Provider calls can fail or rate-limit. Decide:
   should `POST /api/moms/:id/send` roll back `mom.status` to `Draft` on
   failure, retry, or queue for later? Right now the route always marks the
   MoM `Completed` regardless of whether the (mocked) send "succeeded" —
   that assumption breaks the moment sending can actually fail.
3. **Where does the PDF attachment come from at send time?** Two options:
   - Client generates the PDF (jsPDF, browser-side) and uploads it via the
     existing `/api/upload` endpoint right before calling
     `sendMomToClient()`; server reads that file and attaches it to the
     Gmail send.
   - PDF generation moves server-side (e.g. `pdfkit`, `puppeteer`, or
     `@react-pdf/renderer`) so the attachment never needs a browser round
     trip. Heavier change, but avoids depending on the client having
     already generated the file.
   Recommend the first option — smaller diff, reuses what's already built
   in item 1 above.
4. **Storage durability note:** this repository contains Vercel configuration,
   but the current in-memory read-cache architecture must not be deployed to
   Vercel serverless. File uploads currently write to local disk via
   multer (`server.ts` ~line 495, `/uploads/:filename`). Vercel's
   filesystem is ephemeral per invocation — this is a **pre-existing**
   issue for receipt uploads too, not something this session introduced,
   but it becomes more pressing if generated PDFs are expected to survive
   between the upload call and the send call in a serverless environment.
   If it's not already biting receipts in production, it's worth
   confirming request-scoped persistence is enough, or moving to real
   object storage (Supabase Storage / S3) if not.
5. Keep the mocked `emails`/`teamsMessages` arrays as an **audit trail**
   even once real sending exists — record what was actually sent (or
   attempted) alongside the real provider call, so System Emails/
   notifications still shows an accurate history instead of going dark.

---

## 3. Claim/reference number generation is NOT collision-safe — needs an atomic backend counter

**Confirmed bug, not hypothetical.** The internal `claims.id` is a
`uuidv4()` — fine, effectively collision-free, no action needed there. The
problem is the *human-facing* `claim_number` (e.g. `REIM-2026-000123`),
generated at `server.ts:2476`:

```ts
const numStr = String(claimCounter++).padStart(6, '0');
const claimNumber = `REIM-${year}-${numStr}`;
```

`claimCounter` (`server.ts:132`, `let claimCounter = 123`) is a **plain
in-memory JS variable**, not a database sequence. That means:

1. **It resets to `123` on every fresh process start.** Boot-time loading
   from Postgres (`loadCoreLoopFromDb`, used when `DEMO_MODE=false`) loads
   existing claims but never re-derives `claimCounter` from what's already
   in the database — so a restart can immediately hand out a `claim_number`
   that collides with one already persisted.
2. **It isn't safe on Vercel serverless**, even though this repository still
   contains `vercel.json`. Separate invocations can run in separate
   instances with independent memory, and concurrent requests aren't
   coordinated — two claims submitted around the same time can receive the
   same `claimCounter` value and therefore the same `claim_number`.
3. **There's no database-level backstop either** — `claims.claimNumber` in
   `src/db/schema.ts:158` has no `.unique()` constraint, so even if the
   generation logic produces a duplicate, Postgres will happily store it.

**What to do:**

1. **Make claim-number generation atomic at the database layer**, not in
   application memory. Best fit given the existing Postgres setup: a native
   **`CREATE SEQUENCE`** (e.g. `claim_number_seq`), called via
   `nextval('claim_number_seq')` as part of the same insert. Sequences are
   atomic under concurrent access by Postgres's own guarantee — no
   application-level locking needed, and it survives restarts since it
   lives in the database, not process memory. This needs a small Drizzle
   migration.
   - If avoiding a new Postgres feature for some reason: a single-row
     `counters` table incremented inside a transaction with
     `SELECT ... FOR UPDATE` (row lock) gives the same atomicity guarantee
     with a bit more application code. Either is fine — the sequence is
     simpler.
   - **Do not** implement this as `SELECT MAX(claim_number) FROM claims`
     followed by `+1` in application code — that's a classic
     read-then-write race that looks fine in testing and fails under real
     concurrent traffic.
2. **Add the missing `UNIQUE` constraint** on `claims.claimNumber` in
   `src/db/schema.ts` regardless of the above — a hard backstop so a future
   bug in the generation logic produces a loud database error instead of a
   silent duplicate that two people can then both believe is "their" claim
   reference.
3. **Keep a JS-counter fallback only for the fully in-memory mode** (no
   `DATABASE_URL` set — README calls this out as a supported "no
   persistence" mode for local/demo use). Single-process in-memory mode has
   no concurrency or durability requirement, so the existing counter
   pattern is fine *there* — just gate it: use the Postgres sequence when
   `DATABASE_URL` is configured, fall back to the current in-memory counter
   otherwise.
4. **Audit for the same pattern elsewhere** — a quick search
   (`grep -n "^let .*[Cc]ounter" server.ts`) currently turns up only
   `claimCounter`, so this is contained to one place today. Worth
   re-running that grep after other changes land, since it's an easy
   pattern to reintroduce by copy-paste. (Cash Advance/Liquidation
   references — `CADV-`/`LIQ-` — are derived from `id.slice(0, 6)`, not a
   counter, so they aren't exposed to this exact race; a slice collision
   would only be a cosmetic display clash since the real `id` underneath
   stays unique, not a data-integrity issue, but it's worth a similar
   uniqueness check if this gets a general identifier-hardening pass.)

---

## 4. Carried over from earlier in this project — not started

- **Filters, system-wide.** Client asked to improve filters across the whole
  system. Receipts (`src/pages/shared/Receipts.tsx`) already has a rich
  filter popover with chips and quick-views; `MOMs.tsx` and the claims list
  are much barer by comparison. Suggested approach: extract a shared
  FilterBar/chip-list component and apply it consistently across all list
  views (Receipts, MOMs, Claims, admin lists).
- **Terminology & description cleanup.** A consistency pass over labels and
  helper text — e.g. "MOM" vs "Minutes of Meeting" vs "meeting record" are
  used inconsistently, "Type of Account" phrasing, button verbs. Best done
  last, after the filter unification and PDF/email work land, since new UI
  from those tasks will also need the same pass.

---

## Building blocks already in place (reuse, don't duplicate)

- `momSections(mom, 'client' | 'internal')` in `src/lib/momExport.ts` — the
  single source of truth for which fields the client sees vs. the internal
  copy (currently only Type of Account is hidden from the client).
- `src/components/shared/MomClientPreviewModal.tsx` — shared by
  `MomDetail.tsx`, `CreateMom.tsx`, and `SubmitClaim.tsx`. Fix it once here
  and all three call sites get the real-PDF preview.
- `src/lib/momContacts.ts` — multi-contact-person serialization
  (`serializeContacts`/`parseContacts`/`contactsFromMom`), packed into the
  existing `contact_person` text column, no schema change.
- `src/components/shared/ContactPersonsField.tsx` — repeatable Name +
  Designation rows, used in both MoM forms.
- `sendEmail()`'s existing `if (recipient) → teamsMessages, else → emails`
  branch in `server.ts` (~line 346) already matches the client-Gmail /
  internal-Teams split — reuse the branch, replace what each side does.
- `.env.example` already has `MICROSOFT_TENANT_ID`/`CLIENT_ID`/
  `CLIENT_SECRET` placeholders — the Teams integration should extend that
  same Entra app registration's Graph scope rather than creating a second
  Azure app.
