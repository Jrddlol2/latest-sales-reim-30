# Hierarchy sync design — simulated Entra ID org-chart sync

Referenced throughout `server.ts` and `src/serverTypes.ts` (by section number, preserved
below) but never written down until now — this documents the actual behavior of that code,
not a design that preceded it.

**There is no real Microsoft Graph/Entra ID connection.** Everything in this doc is a
simulation: an Admin editing a user's manager (`reports_to`) in User Accounts stands in for
what would, in production, be a Graph directory-sync cycle picking up a real promotion,
demotion, or team transfer. See the [O365 target section of
`PROTOTYPE-AUDIT.md`](PROTOTYPE-AUDIT.md#target-integration-office-365--microsoft-entra-id)
for how this maps onto a real sync once Entra ID is wired in.

## §1. Why this exists

A claim's approver is decided once, at submission time, from the requestor's manager
(`reports_to`) at that moment. If the org chart changes while a claim is still pending, the
naive fix — "just re-derive the approver from the live org chart" — would make a claim
vanish out from under the person mid-review, or silently reroute it without anyone being
told. This design keeps a claim with its original approver by default, and makes the
org-change visible and actionable instead.

## §2–3. Initial state and approval authority

Every user seeds with `employment_status: 'Active'`. **Approval authority
(`can_approve_reimbursements`) is derived from headcount, not from role alone** — an
Approver gets it automatically the moment someone reports to them, and loses it
automatically the moment their last direct report leaves (`recalcApprovalAuthority()`,
re-run on every `reports_to` change for the people on both ends of the edge). Only the
`Approver` role can ever hold it; a non-Approver gaining a report (an unusual state) still
doesn't grant it.

An Admin can **override** this via the "Can Approve Reimbursements" checkbox in User
Accounts — that override sticks until the *next* headcount change for that person, at which
point it's re-derived fresh. Moving someone off the `Approver` role strips the flag
immediately and unconditionally (a Requestor/Custodian/Admin can never be left showing
"can approve").

## §5. Stale approvers — detection, transfer, fallback

When an Admin changes a requestor's `reports_to` (`PUT /api/users/:id`), every claim that's
still `Pending Approval` under the requestor's **old** manager is flagged:

- `approver_stale_since` — timestamp the change was detected
- `pending_transfer_to` — the requestor's **new** manager (the suggested handoff target)
- `approver_stale_reason` — a human-readable explanation, shown on the claim

The claim **does not move**. It stays with the old approver, who's emailed and sees a
"Stale Approvals Detected" banner in their Approval Queue (`ApprovalQueue.tsx`) with a
one-click **Transfer** action (`POST /api/claims/:id/transfer-approver`) to hand it to the
suggested new approver — or they can simply keep reviewing it themselves; nothing forces
the handoff.

**7-day fallback:** if nobody transfers a stale claim within `STALE_APPROVER_FALLBACK_DAYS`
(7), it's eligible for escalation to an Admin. There's no real scheduler in this prototype —
an Admin triggers the check manually from the Admin Dashboard ("Run Fallback Check"),
which is `POST /api/admin/run-fallback-check`. It scans every stale, not-yet-escalated
claim, and for anything past the threshold (or every stale claim, if `force: true` is
passed — useful for demoing without waiting a week), marks it `escalated_to_admin` and
emails the admin with the current approver, the suggested new one, and the reason.

## §7. Admin override, any time

An Admin can transfer a claim to any approver at any time via the same
`transfer-approver` endpoint (not just after escalation), or reassign it directly via
`PUT /api/claims/:id/reassign`. Either action clears `approver_stale_since` and
`pending_transfer_to` — the claim is no longer stale, regardless of which path resolved it.

## §8. Authorization is claim-scoped, not role-scoped

A user who's lost approval authority elsewhere in the org (demoted, no longer has direct
reports, even reassigned to a different role) can **still act on a claim already routed to
them** — `POST /api/claims/:id/approve` checks `claim.current_approver_id === user.id` (or
`original_approver_id`, or an active delegation), never the user's *current* live
authority. This is deliberate: revoking authority shouldn't strand a claim mid-review with
nobody able to finish it. The only way a stale claim moves off someone is an explicit
transfer or reassignment (§5, §7).

## The hard rule this all depends on

**No code path may route a claim's approver from anything other than `reports_to` + an
active `ApproverDelegation`.** `Company.default_approver_id` exists for informational
display only (e.g. "usual account owner for this client") and must never be read for
routing — see the comment on that field in `src/serverTypes.ts`. This is the invariant that
makes `reports_to` safe to treat as the eventual source of truth once it's synced from a
real Entra ID manager edge instead of edited by hand.
