# User Manual — Sales Reimbursement System

This is a how-to-use guide, written for the people who work in the app day to day —
Requestors, Approvers, Custodians, Finance viewers, and Admins. If you're a developer looking for the
technical architecture, see [`PROJECT-README.md`](PROJECT-README.md) instead.

> **Note on signing in:** this system doesn't have passwords yet — you sign in by picking
> your account from a list. See [Signing in](#signing-in) below. Everything else in this
> manual describes the real, intended workflow.

---

## Contents

- [Signing in](#signing-in)
- [Getting around](#getting-around)
- [For Requestors](#for-requestors)
  - [Submitting a reimbursement](#submitting-a-reimbursement)
  - [Requesting a cash advance](#requesting-a-cash-advance)
  - [Liquidating a cash advance](#liquidating-a-cash-advance)
  - [Tracking your requests](#tracking-your-requests)
  - [Getting paid](#getting-paid)
  - [If a claim is returned to you](#if-a-claim-is-returned-to-you)
  - [Scheduling your review meeting](#scheduling-your-review-meeting)
- [For Approvers](#for-approvers)
  - [Reviewing a request](#reviewing-a-request)
  - [Handling a stale approval](#handling-a-stale-approval)
  - [Delegating your approvals](#delegating-your-approvals)
- [For Custodians](#for-custodians)
  - [Processing an approved claim](#processing-an-approved-claim)
  - [Collecting a liquidation refund](#collecting-a-liquidation-refund)
- [For Finance](#for-finance)
- [For Admins](#for-admins)
- [Everyone: notifications, support, settings](#everyone-notifications-support-settings)
- [FAQ](#faq)

---

## Signing in

Open the app and you'll see a list of accounts grouped by role (Requestor, Approver,
Custodian, Finance, Admin). Click your name to sign in — no password is needed in this version of
the system. To switch to a different account, click **Sign out** in the top-right corner
of any page; that returns you to the account list.

## Getting around

The left sidebar is your main navigation, and it only shows what's relevant to your role —
a Requestor doesn't see admin screens, a Custodian doesn't see the approval queue, and so
on. Across the top of every page you'll find:

- A **search box** for claims, IDs, and purposes.
- A **bell icon** — your notifications, with a red badge showing how many are unread.
- A **help icon** — takes you to Support.
- Your **name, role, and photo** on the far right, with **Sign out** next to it.

Some sidebar items carry a small number badge — that's a live count (pending approvals
waiting on you, items in your processing queue, unread notifications, and so on).

---

## For Requestors

### Submitting a reimbursement

Click **Submit Claim** in the sidebar, then **Reimbursement**. The wizard has four steps,
in this order:

1. **Minutes of Meeting** — who you met with (pick from the company directory or type a
   new one), the purpose, location, one or more contact persons with designations, one or
   more client-copy email recipients, and a discussion summary. You can
   either fill this in directly or upload an existing MOM document. Depending on how your
   admin has configured the form, you may see a few extra fields here (account type,
   category, department, and so on).
2. **Details & Items** — your expense line items: date, category, vendor, payment method,
   amount, and a receipt/OR photo or PDF for each one. Every line needs a receipt before
   you can submit.
3. **Schedule Review** — pick a date and time for a short review meeting with your
   approver. This gets sent to them to confirm.
4. **Review & Submit** — a summary of everything above. Check it, then hit **Submit**.

You can click **Save Draft** at any point to come back to it later — drafts show up in
**My Requests** with a Draft status and aren't visible to your approver yet.

Once submitted, your claim moves to **Pending Approval** and the system creates a mock
internal notification for your approver. External email and Teams delivery are not yet
connected.

### Working with Minutes & Agreements

The **Minutes & Agreements** area supports both Minutes of Meeting (MoM) and Letter of
Agreement (LOA) records. You can:

- Add multiple client contact people and record each person's designation.
- Add multiple client email recipients for the client copy.
- Preview and export separate internal and client copies. The client copy omits
  internal-only fields such as Type of Account.
- Edit a saved record at any time, including after it has been marked completed, so a
  client-requested correction can be recorded.

The preview now renders the literal generated PDF, not an HTML approximation
(fixed 2026-08-04). Remaining prototype limitation: **Send to client** still
records a mock outbox event and marks the record completed; it does not yet
deliver a real email or attach the PDF — that's blocked on a real Gmail/Teams
integration, see `docs/project-handoff/HANDOFF-NEXT-STEPS.md`.

### Requesting a cash advance

**Submit Claim → Cash Advance.** Just an amount and a purpose — no meeting or expense
lines needed, since you haven't spent anything yet. Once your approver approves it and the
custodian releases the funds, its status becomes **Released**, meaning the money is with
you and a liquidation is expected once you've spent it.

### Liquidating a cash advance

**Submit Claim → Liquidation.** Pick the cash advance you're settling, then add your
actual expense line items the same way as a reimbursement (date, category, vendor, amount,
receipt for each). The system calculates the difference automatically:

- **Settled** — you spent exactly what was advanced.
- **Refund Due** — you spent less; you owe the difference back, and the custodian will
  collect it.
- **Reimbursement Due** — you spent more; the difference is raised as a follow-up
  reimbursement claim automatically.

### Tracking your requests

**My Requests** lists everything you've submitted — reimbursements, advances, and
liquidations together — with search and a status filter. Click any row to open its full
detail page, including its complete status history and (for reimbursements) the linked
Minutes of Meeting.

### Getting paid

Once a claim reaches **Ready for Claim**, the custodian has released it and issued a
release code. Go to **Payouts** — you'll see every claim waiting on you, with the amount
and payment method. Click **Enter Code to Claim**, type in the code the custodian gave
you, and confirm. This is the one step only *you* can do — it's an anti-fraud check that
proves the payout actually reached you, not just that the custodian says it did.

### If a claim is returned to you

If an approver sends a reimbursement back for revision (status **Returned for
Revision**), open it from **My Requests** and click **Revise & Resubmit** at the top.
Fix whatever the approver flagged (their comment is shown on the claim), then resubmit —
it goes straight back into their queue.

### Scheduling your review meeting

If your approver declines the review-meeting time you originally proposed, you'll see it
under **Calendar** marked "Reschedule requested," along with their reason. Open it and
propose a new date/time.

---

## For Approvers

You get everything a Requestor gets (you submit your own expenses too) plus an
**Approvals** queue.

### Reviewing a request

**Approvals** shows everything routed to you — your direct reports' reimbursements, cash
advances, and liquidations. Filter by All / High Priority / Cash Advances, or click into
any row for the full detail (line items, receipts, the linked MOM). From there you can:

- **Approve** — moves it to processing/release.
- **Reject** — requires a comment explaining why; ends the claim.
- **Return** — requires a comment; sends it back to the requestor to fix and resubmit
  (reimbursements only).

You'll also be asked to **confirm or decline** the review meeting the requestor proposed
when they submitted — that happens from **Calendar**, not the approval queue itself.

### Handling a stale approval

Occasionally you'll see a **"Stale Approvals Detected"** banner at the top of your queue.
This means one of your direct reports' claims still needs your review, but that
requestor's manager has since changed (an org-chart update) — the system deliberately
leaves the claim with you rather than silently moving it. You can either keep reviewing it
yourself, or click **Transfer** to hand it to the suggested new approver.

### Delegating your approvals

Going on leave? Go to **Settings → Delegation** and request coverage: pick another
approver and a date range. Once they accept, any claim that would route to you
automatically routes to them instead for that window — you don't need to do anything else.
You'll see delegations you've requested and delegations you're covering for someone else
in the same tab; if someone asks you to cover for them, you'll see it there too, with
Accept/Decline buttons.

### Reviewing team receipts

In **Receipt Archive**, Approvers can review eligible team receipts using the standard
search, amount, category, status, date, and quick-view filters. Results can also be
grouped by **Team Member** or by **Client** to make reconciliation and follow-up easier.

---

## For Custodians

You handle disbursement — releasing approved money and confirming refunds.

### Processing an approved claim

**Processing Queue** lists every claim an approver has cleared. Filter by All / In Audit /
Cash Advances / Liquidations. For each one:

1. **Generate a Claim Code** (also called a release code) — a short code you'll give the
   requestor separately (in person, by chat, however your office does it).
2. Pick the **payment method** (Cash, GCash, Bank Transfer, Check — your admin controls
   this list) and mark it **Ready for Claim**.

The requestor then confirms receipt themselves using that code (see
[Getting paid](#getting-paid) above) — that's what actually completes the claim, not a
custodian action. **Ready to Claim** is your view of what's still waiting on the
requestor's confirmation.

**Transaction History** shows every completed payout with its date, method, and reference.
**Analytics** gives you a dashboard view of your queue's shape and throughput.

### Collecting a liquidation refund

When a liquidation comes through with **Refund Due**, it lands in your queue the same way
— review it, collect the difference from the requestor by whatever means your office uses,
then mark it closed.

---

## For Finance

Finance is a view-only role with company-wide visibility from approval onward. Drafts, submitted requests, pending approvals, pre-Finance rejections, and unreviewed liquidations are intentionally excluded.
Use **Financial Records** to filter claims, cash advances, and liquidations by type, status,
client, location, or submitted date. **Receipt Archive** provides receipt totals plus
requestor, category, and date filters. **Transaction History** shows finalized activity,
while **Analytics** provides expenditure, department, client, category, and workflow views.

Finance users cannot create or edit claims, approve or return requests, process
disbursements, generate release codes, or change administrative configuration. Personal
Minutes & Agreements remain private unless they are linked to a submitted claim.

---

## For Admins

Everything below lives under the Admin section of the sidebar:

| Screen | What you do there |
|---|---|
| **User Accounts** | Manage every account — role, department, manager (org chart), employment status, and (for Approvers) whether they can approve reimbursements. Changing someone's manager triggers the org-change handling described for Approvers above. |
| **Master Data Admin** | Maintain the six shared catalogs: Departments, Cost Centers, Business Units, Branches, Project Codes, Vendors. Anything marked inactive stops appearing as a choice in forms but stays on old records. |
| **Field Definitions** | Add or edit the extra fields that appear on the Minutes of Meeting and Claim forms — label, input type, required/optional, which claim types it applies to, and whether it pulls its options from one of the Master Data catalogs. |
| **Company Directory** | The client/company list requestors pick from when filling a MOM, with address and contact info that auto-fills the meeting details. |
| **Historical Import** | Prototype CSV import for past claims. It currently reports success after adding records to process memory; imported batches and claims are not yet durable across a restart. Do not use it for a real migration until the transactional backend is completed. |
| **Admin Reporting** | Charts and CSV export of claims across the whole org. |
| **Audit Log** | A searchable activity feed. Core workflow history and user/master-data audit events both persist (fixed 2026-08-04); real identity and delivery are still prototype-level, so it's not yet a complete production audit ledger. |
| **System Emails** | The current process's mock email and Teams outbox—not a live inbox or durable provider log. It is searchable and has unread state, but neither delivery nor restart persistence is implemented. |

Stale-approver escalation now also runs automatically on an hourly schedule
(fixed 2026-08-04); the Admin Dashboard's **"Run Fallback Check"** button is
still available as a manual trigger — useful for demoing without waiting on
the schedule — for escalating any claim that's been stuck in a stale-approver
state for too long without anyone transferring it — see
[Handling a stale approval](#handling-a-stale-approval).

---

## Everyone: notifications, support, settings

- **Notifications** — mock email/Teams events addressed to you in the current process;
  click the bell in the top bar for a quick preview, or open the full page.
- **Support** — open a ticket if something's wrong or you need help. Set a priority, link
  it to a specific claim if relevant, and reply in the thread once it's open. Admins see
  and can respond to everyone's tickets; you only see your own.
- **Settings** — your read-only directory profile, notification preferences,
  delegation (Approvers only—see above), and an honest placeholder for future account
  security. Notification preferences now persist across restarts and control
  whether the submitted/approved/returned/ready/delegation categories create
  a notification at all (fixed 2026-08-04) — muting a category suppresses it
  only when both its toggles are off, since one record still backs both the
  in-app and "email" views.
- **Receipt Archive** — every receipt you're authorized to view, with search, quick views,
  and detailed category/status/date/amount filters. Approvers also have team/client
  grouping.
- **Calendar** — your upcoming review meetings, month view.

## FAQ

**I can't find "Export PDF" — where did it go?**
The "Print" button on a claim's detail page opens your browser's print dialog rather than
generating a formatted PDF. Use your browser's "Save as PDF" print destination if you need
a file.

**Why can't I approve my own claim?**
By design — a requestor can never be the approver of their own expense, even if they
technically have approval authority. This is enforced by the system, not just hidden in
the UI.

**My claim's approver seems out of date — is that a bug?**
Not necessarily — see [Handling a stale approval](#handling-a-stale-approval). If your
manager changed recently, your claim intentionally stays with your old approver until
they (or an admin) hand it off.

**The custodian says they released my payment, but I don't see it as complete.**
That's expected — a payout isn't complete until *you* enter the release code on the
**Payouts** page. Ask your custodian for the code if you don't have it yet.

**Amounts show as ₱ (Philippine Pesos) — is that right?**
Yes, this system is modeled in PHP throughout.
