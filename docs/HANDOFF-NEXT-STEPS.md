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

## 2. Backend email sending doesn't exist yet — needed before "Send to client" is real

**This is the bigger gap.** `sendEmail()` in `server.ts` (~line 346) is
**fully mocked**: it never contacts any mail provider. It just pushes a
record into an in-memory `emails` array (or `teamsMessages` if the recipient
is an internal user), which is only ever displayed back inside this app's
own UI (System Emails page / notifications). Clicking "Send to client" today
does **not** deliver anything to a real inbox — for anyone, demo or
production — and it doesn't attach a PDF at all currently, even though the
export buttons sit right next to it.

Confirmed via `.env.example` — there are no email-provider variables
defined anywhere (only Supabase and Microsoft Entra/auth are wired up).

**What needs to happen for real sending:**

1. **Pick a transactional email provider** — SendGrid, AWS SES, Postmark, or
   Mailgun (all support attachments via API); or SMTP relay via Nodemailer if
   there's already a company mail server. Recommend SendGrid or Postmark for
   the simplest API + attachment support.
2. **Add credentials as env vars**, e.g. `SENDGRID_API_KEY` (or
   `SMTP_HOST`/`PORT`/`USER`/`PASS`), and document them in `.env.example`
   next to the existing Supabase/Microsoft vars.
3. **Domain verification (SPF/DKIM/DMARC)** with the provider so mail to
   real client addresses doesn't get spam-filtered or rejected outright.
   This is a DNS-level task for whoever owns the sending domain
   (`mgenesis.com` per the mock `From:` addresses in `server.ts`) — not a
   code change, needs to happen with IT/domain admin.
4. **Extend `sendEmail()`** to actually call the provider's API/SMTP, and to
   accept an attachment (filename + bytes/base64 + mime type) — it currently
   only takes a subject/body string.
5. **Fix the "From" address.** Today `fromLabel` is spoofed as whichever
   internal user clicked send (`${user.name} <${user.email}>`) — real
   providers require sending *from* a verified domain address. Switch to a
   fixed sender (e.g. `noreply@mgenesis.com`) with `Reply-To` set to the
   actual user, not a per-user From.
6. **Error handling.** Provider calls can fail or rate-limit. Decide: should
   `POST /api/moms/:id/send` roll back `mom.status` to `Draft` on failure,
   retry, or queue for later? Right now the route always marks the MoM
   `Completed` regardless of whether the (mocked) send "succeeded."
7. **Where does the PDF attachment come from at send time?** Two options:
   - Client generates the PDF (jsPDF, browser-side) and uploads it via the
     existing `/api/upload` endpoint right before calling
     `sendMomToClient()`; server reads that file and attaches it.
   - PDF generation moves server-side (e.g. `pdfkit`, `puppeteer`, or
     `@react-pdf/renderer`) so the attachment never needs a browser round
     trip. Heavier change, but avoids a dependency on the client having
     already generated the file.
   Recommend the first option — smaller diff, reuses what's already built.
8. **Storage durability note (Vercel):** this app deploys on Vercel
   (`vercel.json`), and file uploads currently write to local disk via
   multer (`server.ts` ~line 495, `/uploads/:filename`). Vercel's filesystem
   is ephemeral per invocation — this is a **pre-existing** issue for receipt
   uploads too, not something this session introduced, but it becomes more
   pressing if generated PDFs are expected to survive between the upload
   call and the send call in a serverless environment. If it's not already
   biting receipts in production, it's worth confirming request-scoped
   persistence is enough, or moving to real object storage (Supabase
   Storage / S3) if not.

---

## 3. Carried over from earlier in this project — not started

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
