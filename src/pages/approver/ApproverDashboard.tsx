import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { useAppContext } from '../../components/AppContext';
import { ClaimStatus, DelegationStatus } from '../../types';
import { formatMoney } from '../../lib/money';
import { formatDate, formatDateTime, formatLongDate } from '../../lib/date';
import { claimTypeIcon, getClaimAgingInfo } from '../../lib/claimWorkflow';
import { TeamMemberSpending } from '../../components/shared/TeamAnalytics';

const DECISION_STATUSES: string[] = [ClaimStatus.APPROVED, ClaimStatus.REJECTED, ClaimStatus.RETURNED];
const PENDING_STATUSES: string[] = [ClaimStatus.PENDING_APPROVAL, ClaimStatus.SUBMITTED];
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function ApproverDashboard() {
  const navigate = useNavigate();
  const { currentUser, claims, users, lineItems, statusHistory, delegations } = useAppContext();
  const [typeFilter, setTypeFilter] = useState<'All' | 'Reimbursement' | 'Cash Advance' | 'Liquidation'>('All');

  const nameOf = (id: string) => users.find(u => u.id === id)?.name || 'someone';

  // Active delegations touching this approver, in both directions:
  //  - outgoing: I've handed my approvals to someone while I'm out
  //  - covering: someone handed theirs to me
  const outgoingDelegation = useMemo(
    () => delegations.find(d => d.approver_id === currentUser.id && d.status === DelegationStatus.ACTIVE),
    [delegations, currentUser.id]
  );
  const coveringDelegations = useMemo(
    () => delegations.filter(d => d.delegate_id === currentUser.id && d.status === DelegationStatus.ACTIVE),
    [delegations, currentUser.id]
  );

  // Mirrors ApprovalQueue.tsx's own scoping: claims actually assigned to this
  // approver and still awaiting their decision.
  const myPending = useMemo(() => claims
    .filter(claim => {
      if (!PENDING_STATUSES.includes(claim.status) || claim.requestorId === currentUser.id) return false;
      const requestor = users.find(user => user.id === claim.requestorId);
      const isDelegate = coveringDelegations.some(delegation =>
        delegation.approver_id === requestor?.reportsTo
      );
      return claim.approverId === currentUser.id || requestor?.reportsTo === currentUser.id || isDelegate;
    })
    .sort((a, b) =>
      new Date(a.submittedAt || a.createdAt).getTime() -
      new Date(b.submittedAt || b.createdAt).getTime()
    ),
    [claims, currentUser.id, users, coveringDelegations]
  );

  const displayedClaims = typeFilter === 'All' ? myPending : myPending.filter(c => c.type === typeFilter);

  const totalPendingAmount = useMemo(
    () => myPending.reduce((acc, c) => acc + c.total, 0),
    [myPending]
  );

  // This approver's own decisions, most recent first.
  const myDecisions = useMemo(
    () => statusHistory
      .filter(h => h.changedBy === currentUser.id && DECISION_STATUSES.includes(h.newStatus))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [statusHistory, currentUser.id]
  );

  const teamMembers = useMemo(
    () => users.filter(user => user.reportsTo === currentUser.id),
    [users, currentUser.id]
  );
  const teamMemberIds = useMemo(() => new Set(teamMembers.map(member => member.id)), [teamMembers]);
  const oneWeekAgo = Date.now() - ONE_WEEK_MS;
  const teamReimbursedThisWeek = claims
    .filter(claim =>
      teamMemberIds.has(claim.requestorId) &&
      (claim.type === 'Reimbursement' || claim.type === 'Transport Reimbursement') &&
      claim.paidAmount > 0 &&
      Boolean(claim.paidAt) &&
      new Date(claim.paidAt!).getTime() >= oneWeekAgo
    )
    .reduce((sum, claim) => sum + claim.paidAmount, 0);
  const oldestPending = myPending[0];
  const oldestPendingAging = oldestPending
    ? getClaimAgingInfo(oldestPending.submittedAt, oldestPending.createdAt)
    : null;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="mb-8">
        <h3 className="font-display text-display text-on-surface">Welcome back, {currentUser.name.split(' ')[0]}</h3>
        <div className="flex items-center text-outline mt-1">
          <span className="material-symbols-outlined text-[18px] mr-2">calendar_today</span>
          <p className="font-label-md text-label-md">{formatLongDate(new Date())}</p>
        </div>
      </div>

      {/* Delegation status — surfaces active hand-offs in both directions so an
          approver always knows their approvals are being routed elsewhere (or
          that they're currently receiving someone else's). */}
      {outgoingDelegation && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-card border border-tertiary/40 bg-tertiary-container/30">
          <span className="material-symbols-outlined text-tertiary flex-shrink-0">forward_to_inbox</span>
          <p className="flex-1 font-label-md text-on-surface">
            You're delegating your approvals to <strong>{nameOf(outgoingDelegation.delegate_id)}</strong>
            {' '}until <strong>{outgoingDelegation.end_date}</strong>. New claims route to them automatically.
          </p>
          <Button size="sm" variant="outline" className="flex-shrink-0" onClick={() => navigate('/settings?tab=delegation')}>Manage</Button>
        </div>
      )}
      {coveringDelegations.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-card border border-primary/30 bg-primary-container/20">
          <span className="material-symbols-outlined text-primary flex-shrink-0">supervisor_account</span>
          <p className="flex-1 font-label-md text-on-surface">
            You're currently covering approvals for{' '}
            <strong>{coveringDelegations.map(d => nameOf(d.approver_id)).join(', ')}</strong>. Their claims appear in your queue.
          </p>
          <Button size="sm" variant="outline" className="flex-shrink-0" onClick={() => navigate('/settings?tab=delegation')}>Manage</Button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-surface-container-lowest p-6 border border-outline-variant rounded-card shadow-sm">
          <p className="font-label-sm text-outline uppercase mb-2">Awaiting Approval</p>
          <p className="font-headline-lg text-on-surface">{myPending.length}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 border border-outline-variant rounded-card shadow-sm">
          <p className="font-label-sm text-outline uppercase mb-2">Total Pending Amount</p>
          <p className="font-headline-lg text-on-surface">{formatMoney(totalPendingAmount)}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 border border-outline-variant rounded-card shadow-sm">
          <p className="font-label-sm text-outline uppercase mb-2">Oldest Waiting</p>
          <p className="font-headline-lg text-on-surface">{oldestPendingAging?.text || '—'}</p>
          <p className="text-[12px] text-outline mt-1">{oldestPending?.ref || 'Queue is clear'}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 border border-outline-variant rounded-card shadow-sm">
          <p className="font-label-sm text-outline uppercase mb-2">Team Reimbursed This Week</p>
          <p className="font-headline-lg text-primary">{formatMoney(teamReimbursedThisWeek)}</p>
          <p className="text-[12px] text-outline mt-1">Actual reimbursement payouts</p>
        </div>
      </div>

      {/* flex-wrap (not overflow-x-auto) so the active pill's shadow-md never
          gets clipped: setting overflow-x forces overflow-y to auto too,
          which crops any box-shadow that extends past the scroll box. */}
      <div className="flex flex-wrap items-center gap-3 py-2">
        {(['All', 'Reimbursement', 'Cash Advance', 'Liquidation'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={`px-5 py-2 rounded-full font-label-md transition-colors focus:ring-2 focus:ring-primary outline-none whitespace-nowrap ${typeFilter === t ? 'bg-primary text-white shadow-md' : 'bg-surface-container-high text-on-surface-variant hover:bg-outline-variant'}`}
          >
            {t === 'All' ? 'All Requests' : t === 'Reimbursement' ? 'Claims' : t === 'Cash Advance' ? 'Cash Advances' : 'Liquidations'}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="bg-surface-container-low/50">
          <div>
            <h4 className="font-headline-md text-on-surface">Unified Worklist</h4>
            <p className="text-xs text-outline mt-1">Oldest requests are shown first.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-label-sm text-outline">{displayedClaims.length} of {myPending.length}</span>
            <Button size="sm" variant="outline" className="gap-1" onClick={() => navigate('/approvals')}>
              View All <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </Button>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low text-outline font-label-sm uppercase tracking-wider">
              <tr>
                <th className="px-6 py-4">Requestor</th>
                <th className="px-6 py-4">Ref &amp; Type</th>
                <th className="px-6 py-4">Submitted</th>
                <th className="px-6 py-4">Aging</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {displayedClaims.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-outline">
                    <span className="material-symbols-outlined text-4xl mb-2 opacity-50">task_alt</span>
                    <p className="font-label-md">You're all caught up!</p>
                  </td>
                </tr>
              ) : displayedClaims.slice(0, 8).map(claim => {
                const req = users.find(u => u.id === claim.requestorId) || users[0];
                const aging = getClaimAgingInfo(claim.submittedAt, claim.createdAt);
                return (
                  <tr key={claim.id} className="hover:bg-primary-fixed/20 transition-colors group cursor-pointer" onClick={(e) => {
                    if (!(e.target as HTMLElement).closest('button')) {
                      navigate(`/claims/${claim.id}`);
                    }
                  }}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {req.avatarUrl ? (
                          <img src={req.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover" loading="lazy" width="40" height="40" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center font-bold text-on-secondary-container">{req.name.split(' ').map(n=>n[0]).join('')}</div>
                        )}
                        <div>
                          <p className="font-label-md text-on-surface">{req.name}</p>
                          <p className="text-body-sm text-outline">{req.department}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-mono-data font-bold text-on-surface">{claim.ref}</p>
                        <div className="flex items-center text-on-surface-variant font-body-sm mt-0.5">
                          <span className="material-symbols-outlined text-[18px] mr-2 text-primary">{claimTypeIcon(claim.type)}</span>
                          {claim.type}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-on-surface-variant whitespace-nowrap">
                      {formatDate(claim.submittedAt || claim.createdAt)}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2 py-1 rounded-md text-xs font-bold whitespace-nowrap ${aging.color}`}>{aging.text}</span>
                    </td>
                    <td className="px-6 py-4 font-mono-data text-on-surface font-bold">{formatMoney(claim.total)}</td>
                    <td className="px-6 py-4 text-center">
                      <StatusBadge status={claim.status} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => navigate('/approvals')}>Review</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
        <Card className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h4 className="font-headline-md text-on-surface">Recent Decisions</h4>
            <span className="material-symbols-outlined text-outline">history</span>
          </div>
          {myDecisions.length === 0 ? (
            <p className="text-body-sm text-outline">No decisions recorded yet.</p>
          ) : (
            <div className="space-y-6">
              {myDecisions.slice(0, 4).map((h, i) => {
                const claim = claims.find(c => c.id === h.claimId);
                const dotColor = h.newStatus === ClaimStatus.APPROVED ? 'bg-primary' : h.newStatus === ClaimStatus.REJECTED ? 'bg-error' : 'bg-tertiary';
                return (
                  <div key={h.id} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className={`w-2 h-2 rounded-full ${dotColor}`}></div>
                      {i < Math.min(myDecisions.length, 4) - 1 && <div className="w-[1px] flex-1 bg-outline-variant my-1"></div>}
                    </div>
                    <div className="pb-2">
                      <p className="font-label-md text-on-surface">{claim ? `${claim.ref} — ${h.newStatus}` : h.newStatus}</p>
                      {h.comment && <p className="text-body-sm text-outline">{h.comment}</p>}
                      <p className="text-[12px] text-outline mt-1">{formatDateTime(h.timestamp)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <TeamMemberSpending members={teamMembers} claims={claims} lineItems={lineItems} />
      </div>
    </div>
  );
}
