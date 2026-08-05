# Approved post-meeting change request

This document records the decisions confirmed after reviewing the client notes
and the earlier proposed plan. It is the implementation baseline for the
current prototype.

## Confirmed workflow decisions

- Standalone MOMs are private to their creator. An approver can see a
  reportee's MOM only after it is linked to a submitted reimbursement.
- MOMs use the structured form; uploaded MOM documents are removed.
- MOM delivery is addressed internally to the approver. The external client is
  copied only when **CC client** is checked.
- MOM records can be exported to PDF (through the browser's Save as PDF flow)
  and Word using a neutral layout until a formal company template is supplied.
- Transport Reimbursement is a separate submission choice. It skips MOM,
  fixes line-item category to Transportation, and still requires receipts and
  normal approver routing.
- Review meetings are removed from normal submission. An approver may schedule
  one when returning a claim. Rejection is final.
- Claims may be filed for any amount. The whole-claim payout is capped at
  PHP 1,000; the full claimed amount and capped reimbursable amount are both
  retained and displayed.
- Category limits no longer block submission.
- Payout is Cash only for now. The release-code verification flow remains.
- Workflow communications are represented as Microsoft Teams prototype logs;
  in-app notifications remain. External MOM communication is the only email.
- Finance is a distinct view-only role with company reporting, receipt, claim,
  and system-activity access.
- A custodian return goes directly to the requestor. Resubmission goes through
  approver review again. Custodian rejection is permanent.
- Approver worklists include requestor, type, submission date, amount, and age
  filters, and default to oldest first.
- "This week" means Monday through the current day and is scoped to the
  approver's direct team.
- Missing Receipts is removed because receipts are required.
- Calendar content is client MOM meeting dates plus optional review meetings.

## Deferred

SAP Company Directory import is deferred until a real export sample and column
contract are available. No guessed importer mapping should be introduced.

## Branding

The export layout intentionally remains neutral. A supplied company logo can
be added later without changing the MOM data or export workflow.
