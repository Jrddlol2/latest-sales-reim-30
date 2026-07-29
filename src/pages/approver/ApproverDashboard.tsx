import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { useAppContext } from '../../components/AppContext';
import { ClaimStatus } from '../../types';
import { formatMoney } from '../../lib/money';
import { formatDateTime, formatLongDate } from '../../lib/date';

const DECISION_STATUSES: string[] = [ClaimStatus.APPROVED, ClaimStatus.REJECTED, ClaimStatus.RETURNED];
const PENDING_STATUSES: string[] = [ClaimStatus.PENDING_APPROVAL, ClaimStatus.SUBMITTED];
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function ApproverDashboard() {
  const navigate = useNavigate();
  const { currentUser, claims, users, statusHistory } = useAppContext();
  const [typeFilter, setTypeFilter] = useState<'All' | 'Reimbursement' | 'Cash Advance' | 'Liquidation'>('All');

  // Mirrors ApprovalQueue.tsx's own scoping: claims actually assigned to this
  // approver and still awaiting their decision.
  const myPending = useMemo(
    () => claims.filter(c => c.approverId === currentUser.id && PENDING_STATUSES.includes(c.status)),
    [claims, currentUser.id]
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

  const decisionsThisWeek = useMemo(
    () => myDecisions.filter(h => Date.now() - new Date(h.timestamp).getTime() <= ONE_WEEK_MS).length,
    [myDecisions]
  );

  const approvalRate = useMemo(() => {
    const approved = myDecisions.filter(h => h.newStatus === ClaimStatus.APPROVED).length;
    const decided = myDecisions.filter(h => h.newStatus === ClaimStatus.APPROVED || h.newStatus === ClaimStatus.REJECTED).length;
    return decided === 0 ? null : Math.round((approved / decided) * 100);
  }, [myDecisions]);

  // Average time between a claim entering this approver's queue and their
  // decision on it, computed from the claim's own history entries.
  const avgResponseHours = useMemo(() => {
    const byClaim = new Map<string, typeof statusHistory>();
    statusHistory.forEach(h => {
      if (!byClaim.has(h.claimId)) byClaim.set(h.claimId, []);
      byClaim.get(h.claimId)!.push(h);
    });
    const durationsMs: number[] = [];
    myDecisions.forEach(decision => {
      const entries = (byClaim.get(decision.claimId) || []).slice().sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const submitted = entries.find(e => PENDING_STATUSES.includes(e.newStatus));
      if (submitted) {
        const ms = new Date(decision.timestamp).getTime() - new Date(submitted.timestamp).getTime();
        if (ms > 0) durationsMs.push(ms);
      }
    });
    if (durationsMs.length === 0) return null;
    return durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length / (1000 * 60 * 60);
  }, [myDecisions, statusHistory]);

  const exportWorklist = () => {
    const rows = [
      ['Ref', 'Requestor', 'Type', 'Amount', 'Status'],
      ...myPending.map(c => {
        const req = users.find(u => u.id === c.requestorId);
        return [c.ref, req?.name || '', c.type, c.total.toFixed(2), c.status];
      }),
    ];
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `approval-worklist-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="mb-8">
        <h3 className="font-display text-display text-on-surface">Welcome back, {currentUser.name.split(' ')[0]}</h3>
        <div className="flex items-center text-outline mt-1">
          <span className="material-symbols-outlined text-[18px] mr-2">calendar_today</span>
          <p className="font-label-md text-label-md">{formatLongDate(new Date())}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-surface-container-lowest p-6 border border-outline-variant rounded-card shadow-sm">
          <p className="font-label-sm text-outline uppercase mb-2">Awaiting Approval</p>
          <p className="font-headline-lg text-on-surface">{myPending.length}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 border border-outline-variant rounded-card shadow-sm">
          <p className="font-label-sm text-outline uppercase mb-2">Total Pending Amount</p>
          <p className="font-headline-lg text-on-surface">{formatMoney(totalPendingAmount)}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 border border-outline-variant rounded-card shadow-sm">
          <p className="font-label-sm text-outline uppercase mb-2">Avg. Response Time</p>
          <p className="font-headline-lg text-on-surface">{avgResponseHours === null ? '—' : `${avgResponseHours.toFixed(1)} hrs`}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 border border-outline-variant rounded-card shadow-sm">
          <p className="font-label-sm text-outline uppercase mb-2">Approval Rate</p>
          <p className="font-headline-lg text-on-surface">{approvalRate === null ? '—' : `${approvalRate}%`}</p>
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
          <h4 className="font-headline-md text-on-surface">Unified Worklist</h4>
          <span className="font-label-sm text-outline">{displayedClaims.length} of {myPending.length}</span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low text-outline font-label-sm uppercase tracking-wider">
              <tr>
                <th className="px-6 py-4">Requestor</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {displayedClaims.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-outline">
                    <span className="material-symbols-outlined text-4xl mb-2 opacity-50">task_alt</span>
                    <p className="font-label-md">You're all caught up!</p>
                  </td>
                </tr>
              ) : displayedClaims.map(claim => {
                const req = users.find(u => u.id === claim.requestorId) || users[0];
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
                      <div className="flex items-center text-on-surface-variant font-label-md">
                        <span className="material-symbols-outlined text-[18px] mr-2 text-primary">receipt_long</span>
                        {claim.type}
                      </div>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="lg:col-span-2 p-6">
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
        <Card className="relative overflow-hidden p-6 flex flex-col justify-between">
          <div className="z-10 relative">
            <h4 className="font-headline-md text-on-surface mb-2">This Week</h4>
            <p className="text-body-sm text-outline mb-6">Your activity over the last 7 days</p>
            <div className="space-y-4">
              <div className="flex justify-between items-baseline">
                <span className="font-label-sm text-on-surface-variant">Decisions Made</span>
                <span className="font-headline-md text-primary">{decisionsThisWeek}</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="font-label-sm text-on-surface-variant">Approval Rate</span>
                <span className="font-headline-md text-tertiary">{approvalRate === null ? '—' : `${approvalRate}%`}</span>
              </div>
            </div>
          </div>
          <div className="mt-8 pt-6 border-t border-outline-variant z-10">
            <Button variant="outline" className="w-full gap-2 text-primary border-primary hover:bg-primary hover:text-white focus:ring-2 focus:ring-primary outline-none" onClick={exportWorklist}>
              <span className="material-symbols-outlined text-[18px]">download</span> Export Worklist
            </Button>
          </div>
          <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-primary/5 rounded-full blur-3xl"></div>
        </Card>
      </div>
    </div>
  );
}
