# Changelog and Future Work

Last updated: July 31, 2026

## Overview

This document summarizes the reimbursement-system changes delivered during the current redesign cycle and records the remaining client requirements. It is intended to be the handoff reference for product review, user acceptance testing, and the next implementation pass.

## Delivered Changes

### Requestor experience

- Replaced the separate cash-advance and reimbursement actions with one **New Claim** entry point.
- Added four selectable workflows:
  - General Reimbursement
  - Transport Reimbursement
  - Cash Advance
  - Liquidation
- Removed the redundant Submit Claim navigation module.
- Reorganized the requestor navigation into Overview, Claims, Meetings, and Account sections.
- Prioritized Recent Requests and the latest Claim Progress Tracker on the dashboard.
- Removed reimbursement analytics charts from the requestor dashboard.
- Renamed Receipt Archive to **Expenses & Receipts**.
- Added compact, expandable filters to My Requests, Minutes & Agreements, and Expenses & Receipts.

### Reimbursement filing

- Reordered General Reimbursement to collect Minutes of Meeting before expense details.
- Added Discussion and Action Items to the full meeting record.
- Added Client Email directly above the **CC client on claim status notifications** checkbox.
- Removed Cost Center, Project Code, and Department from the default MOM form.
- Retained Type of Account with:
  - Existing
  - New Client
  - Dormant
- Clarified labels such as Date of Meeting, Location of Meeting, Date of Purchase, and OR Number.
- Added OR Number to every expense line.
- Added receipt/OR attachment handling per expense line.
- Added multiple expense rows and running claimed totals.
- Added the company-wide reimbursement cap:
  - The requestor may file more than PHP 1,000.
  - The maximum approved and released reimbursement is PHP 1,000 per claim.
- Added the 30-day filing rule:
  - The purchase date starts blank.
  - The user may select an older receipt date.
  - Next Step blocks the workflow when any purchase is more than 30 days before filing.
  - The server independently enforces the same rule.
- Added a full Review & Submit summary showing claimed and maximum reimbursable amounts.

### Transport reimbursement

- Added Transport Reimbursement as a distinct claim type.
- Removed the MOM requirement from the transport workflow.
- Kept receipt and purchase-date requirements.
- Routed transport claims through requestor submission, approver review, custodian processing, and payout confirmation.

### Minutes & Agreements

- Added standalone MOM creation without requiring a reimbursement claim.
- Kept standalone requestor documents private from team approvers.
- Exposed only claim-linked team documents to the assigned approver.
- Added searchable and filterable linked/unlinked and status views.
- Clarified Date of Meeting and Location of Meeting in list and detail views.
- Added a document export that downloads a Word-compatible `.doc` file.
- Displayed the complete MOM inside the claim detail rather than only a summary.
- Positioned expense line items above the complete MOM in claim review.
- Added MOM and claim-review events to the Calendar.

### Approver experience

- Removed Average Response Time and Approval Rate dashboard cards.
- Added Awaiting Approval, Total Pending Amount, Oldest Waiting, and Team Reimbursed This Week KPIs.
- Sorted the Unified Worklist from oldest to newest.
- Added aging indicators and a **View All** link to the Approval Queue.
- Added compact Approval Queue filters and removable active-filter chips.
- Added Approval History alongside Pending Your Action.
- Kept Approve, Return, and Reject actions consistent between the queue and claim detail.
- Moved optional review-meeting scheduling into the approver's Return and Reject decisions.
- Added team-member reimbursement and receipt-supported spending analytics.
- Placed Recent Decisions and Team Member Spending side by side.

### Expenses & Receipts

- Rebuilt Receipt Archive as an expense-centered module.
- Added requestor/team scoping for approvers.
- Added team-member filtering and team analytics.
- Added search across vendor, OR number, claim reference, file, and purpose.
- Added filters for category, status, claim type, requestor, amount, attachment state, and purchase-date range.
- Added sorting and removable active-filter chips.
- Added grid and list views, with list view as the default.
- Added explicit Date of Purchase, Claim/OR, requestor, amount, and attachment columns.

### Custodian experience

- Sorted the Processing Queue from oldest to newest by default.
- Added the oldest queue item banner and row highlight.
- Added queue-aging indicators.
- Added search, department, priority, type, and sort controls.
- Added Return to Requestor and Reject Before Release actions with required reasons.
- Added claim-code generation and payout confirmation flow.
- Added compact filters and sorting to Transaction History.

### Finance experience

- Added the Finance role.
- Added read-only access to financial claims, expenses and receipts, transaction history, and analytics.
- Prevented Finance users from approving, returning, rejecting, processing, or releasing claims.
- Added role-scoped Finance Analytics.

### Administration

- Removed Master Data Admin, Field Definitions, and Company Policy from the active admin navigation.
- Added Company Directory CSV import.
- Added Company Directory filters for industry and contact-detail completeness.
- Added User Account filters for role, department, status, and sorting.
- Redesigned Admin Analytics filters into a compact expandable toolbar.
- Merged audit events and sent notifications into one **System Activity** feed.
- Added filtering by:
  - Client action or system action
  - Audit transition or notification
  - Actor role
  - Resulting status
  - Date range
  - Search text
- Kept notification rows inspectable from the unified feed.

### Analytics and filtering

- Standardized compact filter behavior across operational and administration screens.
- Kept search and common controls visible.
- Moved secondary filters behind a single Filters button.
- Added removable active-filter chips.
- Displayed Clear All only when criteria are active.
- Reset pagination automatically whenever filters or sorting change.
- Removed requestor dashboard charts.
- Simplified approver analytics to focus on recent decisions and team-member spending.

## Current Validation

The integrated application currently passes:

- TypeScript type checking
- 30 automated tests across five test files
- Production client and server builds

Temporary rendered screenshots under `tmp/` are local artifacts and are intentionally excluded from source control.

## Known Gaps

### Export behavior

- MOM export currently produces only a Word-compatible `.doc`.
- A true PDF export has not been implemented.
- Claim Detail still contains a browser Print action, which conflicts with the later request for export-only behavior.

### Payout method

- Cash-only reimbursement release is not enforced.
- The current configured release methods are Cash, GCash, Bank Transfer, and Check.

### Notification channel

- Internal notifications currently create both Email and Microsoft Teams records.
- The request to forward internal notifications only through Teams has not been implemented.
- External client CC behavior still requires an email-capable channel.

### Demo data

- The reimbursement cap is demonstrated correctly.
- Generated claim values are not yet centered near PHP 1,000; many generated records remain substantially higher.

### Missing receipts

- Reimbursements require receipt attachments in the active submission flow.
- The Expenses & Receipts module still exposes a Missing Receipt filter and legacy/imported missing-receipt states.

### Company integration

- Company Directory supports CSV import.
- Direct SAP or database synchronization has not been implemented.

### Terminology

- Core date labels have been clarified.
- A final copy audit is still needed for payment, release, client/system activity, export, and legacy status terminology.

### Conflicting dashboard direction

- The original requirement requested a weekly team reimbursement total.
- A later direction requested removing the This Week widget.
- The current implementation retains **Team Reimbursed This Week** as a KPI and requires a final product decision.

## Future Work

### Priority 1: Close explicit requirement gaps

1. **Add PDF export and remove Print**
   - Add an Export menu with PDF and Word.
   - Remove browser Print from Claim Detail.
   - Use the same export layout for MOM detail and claim detail.
   - Verify expense line items appear before the complete minutes.

2. **Enforce cash-only reimbursement payouts**
   - Restrict reimbursement release to Cash in the custodian interface.
   - Enforce Cash on the server.
   - Decide whether Cash Advances and liquidation refunds follow the same restriction.
   - Simplify reference-number requirements for physical cash.

3. **Move internal delivery to Teams only**
   - Stop generating internal email records.
   - Retain Teams notification records in System Activity.
   - Preserve external email only when the requestor explicitly selects CC Client.
   - Update notification preferences and wording to match the final channel policy.

4. **Update the demo-data generator**
   - Generate most reimbursements between PHP 750 and PHP 1,250.
   - Include representative values immediately below, exactly at, and above PHP 1,000.
   - Show claimed versus reimbursable versus paid amounts consistently.
   - Keep larger Cash Advance values separate from reimbursement examples.

5. **Resolve Missing Receipt behavior**
   - Remove the Missing Receipt filter if all in-scope records must include receipts.
   - Alternatively, rename it to Legacy/Imported Missing Attachment if historical imports can remain incomplete.
   - Add an import warning and exception reason when missing attachments are permitted.

### Priority 2: Integration and consistency

6. **Confirm the weekly KPI decision**
   - Either retain Team Reimbursed This Week as a compact KPI or remove it completely.
   - Keep Recent Decisions and Team Member Spending side by side in either case.

7. **Complete the terminology audit**
   - Standardize Submitted Date, Date Filed, Date of Purchase, Date of Meeting, Approval Date, Release Date, and Completion Date.
   - Standardize Claim, Request, Reimbursement, Payout, Release, and Refund.
   - Rename Client action if User action or Employee action is more accurate.
   - Remove legacy print, archive, and email terminology.

8. **Define SAP synchronization**
   - Confirm whether the source is SAP OData, an API, a scheduled database extract, or a managed CSV export.
   - Add source identifiers and synchronization timestamps.
   - Define matching and conflict-resolution rules.
   - Retain CSV import as a controlled fallback.

### Priority 3: Scale and operational hardening

9. **Optimize System Activity**
   - Use the dedicated server-side unified activity endpoint in all environments.
   - Keep search, filtering, sorting, and pagination server-side.
   - Add event-source counts and export if required by audit users.

10. **Add acceptance and role-permission tests**
    - Add browser-level tests for the four New Claim workflows.
    - Add tests for the 30-day Next Step block and server rejection.
    - Add tests for the PHP 1,000 cap through approval, release, and confirmation.
    - Add tests proving standalone MOM privacy.
    - Add tests proving Finance cannot mutate records.
    - Add tests for custodian Return and Reject.

11. **Accessibility and responsive review**
    - Verify keyboard navigation across filters, tables, dialogs, and the claim stepper.
    - Add missing accessible names and error associations.
    - Review large tables on smaller laptop and mobile widths.

## Product Decisions Needed

Before the next implementation pass, the client should confirm:

1. Whether Team Reimbursed This Week should remain.
2. Whether cash-only applies only to reimbursements or also to advances and refunds.
3. Whether external client CC email is the sole allowed email exception.
4. Whether historical records may exist without receipt attachments.
5. Whether Company Directory requires true SAP synchronization or only controlled CSV import.
6. Whether PDF and Word export are required for MOM only or for both MOM and claim detail.

