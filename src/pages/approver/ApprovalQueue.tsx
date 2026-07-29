import { useState, useMemo, useEffect, MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { ClaimStatus } from '../../types';
import { formatMoney } from '../../lib/money';
import { ApproverActionButtons } from '../../components/shared/ApproverActionButtons';
import { useAppContext } from '../../components/AppContext';
import { useToast } from '../../components/shared/ToastContext';
import { transferApprover } from '../../lib/api';
import { Pagination } from '../../components/ui/Pagination';

const ITEMS_PER_PAGE = 15;

function getAgingInfo(submittedAt: string | undefined, createdAt: string) {
  const start = new Date(submittedAt || createdAt).getTime();
  const now = new Date().getTime(); // or mock current time
  const days = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  if (days >= 5) return { text: `Waiting ${days} day${days === 1 ? '' : 's'}`, color: 'text-error bg-error-container', raw: days };
  if (days >= 3) return { text: `Waiting ${days} day${days === 1 ? '' : 's'}`, color: 'text-tertiary bg-tertiary-container', raw: days };
  return { text: days === 0 ? 'Today' : `Waiting ${days} day${days === 1 ? '' : 's'}`, color: 'text-outline bg-surface-container', raw: days };
}

export function ApprovalQueue() {
  const navigate = useNavigate();
  const { claims, users, currentUser, delegations, refresh } = useAppContext();
  const { addToast } = useToast();

  const [filter, setFilter] = useState('All');
  const [transferringId, setTransferringId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const handleTransfer = async (claimId: string, e: MouseEvent) => {
    e.stopPropagation();
    setTransferringId(claimId);
    try {
      await transferApprover(claimId);
      await refresh();
      addToast('Claim transferred to the new approver.', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Could not transfer this claim.', 'error');
    } finally {
      setTransferringId(null);
    }
  };

  const pendingClaims = useMemo(() => claims.filter(c => {
    // Reimbursement claims land on 'Pending Approval'; Cash Advances and
    // Liquidations use the server's own 'Submitted' status for the same
    // moment — both belong in this queue.
    const isPending = c.status === ClaimStatus.PENDING_APPROVAL || c.status === ClaimStatus.SUBMITTED;
    if (!isPending) return false;
    const requestor = users.find(u => u.id === c.requestorId);
    if (!requestor) return false;
    
    // Can never approve own claims
    if (c.requestorId === currentUser.id) return false;
    
    // The claim's own routing (claim.approverId, set server-side by
    // current_approver_id) is the source of truth — not the requestor's
    // *live* reportsTo. An org change updates reportsTo immediately but
    // deliberately leaves claim.approverId on the old approver until they
    // transfer it away (that's the whole point of the stale-approval flow
    // below); re-deriving eligibility from live reportsTo would make a
    // stale claim vanish from the one queue it needs to be actionable in.
    const isCurrentApprover = c.approverId === currentUser.id;
    const isDirectReport = requestor.reportsTo === currentUser.id;
    const isDelegate = delegations.some(d =>
      d.delegate_id === currentUser.id &&
      d.approver_id === requestor.reportsTo &&
      d.status === 'Active'
    );

    return isCurrentApprover || isDirectReport || isDelegate;
  }), [claims, currentUser, users, delegations]);

  let displayedClaims = pendingClaims;
  if (filter === 'Advances') displayedClaims = pendingClaims.filter(c => c.type === 'Cash Advance');
  if (filter === 'HighPriority') displayedClaims = pendingClaims.filter(c => c.flaggedHighValue || c.total > 15000);
  if (filter === 'Stale') displayedClaims = pendingClaims.filter(c => c.approverStaleSince);

  const staleClaims = pendingClaims.filter(c => c.approverStaleSince);

  const totalPages = Math.ceil(displayedClaims.length / ITEMS_PER_PAGE);
  const paginatedClaims = displayedClaims.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="font-display text-display text-on-surface">Approval Queue</h1>
          <p className="text-body-md text-outline mt-1">Review and action pending reimbursement claims and advances.</p>
        </div>
      </div>

      {staleClaims.length > 0 && (
        <Card className="border-tertiary bg-tertiary-container/30">
          <CardContent className="p-4 flex items-start gap-4">
            <span className="material-symbols-outlined text-tertiary text-[24px]">warning</span>
            <div>
              <h4 className="font-headline-sm text-on-surface mb-1">Stale Approvals Detected</h4>
              <p className="text-on-surface-variant text-sm mb-2">You have {staleClaims.length} claims that are routed to you, but the requestor's manager has recently changed. Please review or transfer them.</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="border-tertiary text-tertiary" onClick={() => setFilter('Stale')}>Review Stale Claims</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-3 pb-2">
        <button onClick={() => setFilter('All')} className={`px-5 py-2 rounded-full font-label-md transition-colors shadow-sm ${filter === 'All' ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-outline-variant'}`}>All Pending ({pendingClaims.length})</button>
        <button onClick={() => setFilter('HighPriority')} className={`px-5 py-2 rounded-full font-label-md transition-colors shadow-sm ${filter === 'HighPriority' ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-outline-variant'}`}>High Priority</button>
        <button onClick={() => setFilter('Advances')} className={`px-5 py-2 rounded-full font-label-md transition-colors shadow-sm ${filter === 'Advances' ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-outline-variant'}`}>Cash Advances</button>
        {staleClaims.length > 0 && (
          <button onClick={() => setFilter('Stale')} className={`px-5 py-2 rounded-full font-label-md transition-colors shadow-sm ${filter === 'Stale' ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-outline-variant'}`}>Stale ({staleClaims.length})</button>
        )}
      </div>

      <Card>
        <CardHeader className="bg-surface-container-low/50 border-b border-outline-variant">
          <h4 className="font-headline-md text-on-surface">Pending Your Action</h4>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low text-outline font-label-sm uppercase tracking-wider">
              <tr>
                <th className="px-6 py-4">Requestor</th>
                <th className="px-6 py-4">Ref & Type</th>
                <th className="px-6 py-4">Aging</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 text-right">Quick Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {displayedClaims.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-outline">
                    <span className="material-symbols-outlined text-4xl mb-2 opacity-50">task_alt</span>
                    <p className="font-label-md">You're all caught up!</p>
                  </td>
                </tr>
              ) : paginatedClaims.map(claim => {
                const req = users.find(u => u.id === claim.requestorId) || users[0];
                const aging = getAgingInfo(claim.submittedAt, claim.createdAt);
                return (
                  <tr key={claim.id} className={`hover:bg-primary/5 transition-colors group cursor-pointer ${claim.approverStaleSince ? 'bg-tertiary-container/10' : ''}`} onClick={(e) => {
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
                          <p className="font-label-md text-on-surface flex items-center gap-2">
                            {req.name}
                            {claim.approverStaleSince && <span className="material-symbols-outlined text-tertiary text-[16px]" title={claim.approverStaleReason}>warning</span>}
                          </p>
                          <p className="text-body-sm text-outline">{req.department}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-label-md text-on-surface flex items-center gap-2">
                        {claim.ref}
                        {claim.flaggedHighValue && <span className="px-2 py-0.5 rounded text-[12px] uppercase font-bold bg-error-container text-error">High Value</span>}
                      </p>
                      <div className="flex items-center text-outline font-body-sm mt-0.5">
                        <span className="material-symbols-outlined text-[14px] mr-1">receipt_long</span>
                        {claim.type}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                       <span className={`px-2 py-1 rounded-md text-xs font-bold ${aging.color}`}>
                          {aging.text}
                       </span>
                    </td>
                    <td className="px-6 py-4 font-mono-data text-on-surface font-bold">{formatMoney(claim.total)}</td>
                    <td className="px-6 py-4 text-center">
                      <StatusBadge status={claim.status} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end items-center gap-2">
                        {claim.approverStaleSince && claim.pendingTransferTo && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-tertiary text-tertiary gap-1"
                            disabled={transferringId === claim.id}
                            onClick={(e) => handleTransfer(claim.id, e)}
                            title={`Transfer to ${users.find(u => u.id === claim.pendingTransferTo)?.name || 'suggested approver'}`}
                          >
                            {transferringId === claim.id
                              ? <span className="material-symbols-outlined animate-spin text-[16px]">sync</span>
                              : <span className="material-symbols-outlined text-[16px]">swap_horiz</span>}
                            Transfer
                          </Button>
                        )}
                        <ApproverActionButtons claim={claim} />
                        <span className="material-symbols-outlined text-outline ml-2 group-hover:text-primary transition-colors">chevron_right</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
      </Card>
    </div>
  );
}
