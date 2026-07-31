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
import { claimTypeIcon, getClaimAgingInfo } from '../../lib/claimWorkflow';
import { formatDate } from '../../lib/date';
import { Input, Label, Select } from '../../components/ui/Input';

const ITEMS_PER_PAGE = 15;

export function ApprovalQueue() {
  const navigate = useNavigate();
  const { claims, users, currentUser, delegations, statusHistory, refresh } = useAppContext();
  const { addToast } = useToast();

  const [filter, setFilter] = useState('All');
  const [view, setView] = useState<'pending' | 'history'>('pending');
  const [showFilters, setShowFilters] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortOrder, setSortOrder] = useState<'oldest' | 'newest' | 'amount'>('oldest');
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

  const approvalHistory = useMemo(() => statusHistory
    .filter(entry =>
      entry.changedBy === currentUser.id &&
      [ClaimStatus.APPROVED, ClaimStatus.REJECTED, ClaimStatus.RETURNED].includes(entry.newStatus as ClaimStatus)
    )
    .map(entry => ({ entry, claim: claims.find(claim => claim.id === entry.claimId) }))
    .filter((record): record is { entry: typeof statusHistory[number]; claim: typeof claims[number] } => Boolean(record.claim))
    .sort((a, b) => new Date(b.entry.timestamp).getTime() - new Date(a.entry.timestamp).getTime()),
    [statusHistory, claims, currentUser.id]
  );

  const staleClaims = pendingClaims.filter(c => c.approverStaleSince);
  const departments = useMemo(
    () => Array.from(new Set(
      pendingClaims
        .map(claim => users.find(user => user.id === claim.requestorId)?.department)
        .filter((department): department is string => Boolean(department))
    )).sort(),
    [pendingClaims, users]
  );

  const displayedClaims = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const filtered = pendingClaims.filter(claim => {
      const requestor = users.find(user => user.id === claim.requestorId);
      if (filter === 'Advances' && claim.type !== 'Cash Advance') return false;
      if (filter === 'HighPriority' && !(claim.flaggedHighValue || claim.total > 15000)) return false;
      if (filter === 'Stale' && !claim.approverStaleSince) return false;
      if (selectedDepartment && requestor?.department !== selectedDepartment) return false;
      if (q && ![claim.ref, claim.purpose, requestor?.name]
        .filter(Boolean)
        .some(value => value!.toLowerCase().includes(q))) return false;

      const submitted = new Date(claim.submittedAt || claim.createdAt).getTime();
      if (dateFrom && submitted < new Date(`${dateFrom}T00:00:00`).getTime()) return false;
      if (dateTo && submitted > new Date(`${dateTo}T23:59:59`).getTime()) return false;
      return true;
    });

    return filtered.sort((a, b) => {
      if (sortOrder === 'amount') return b.total - a.total;
      const aTime = new Date(a.submittedAt || a.createdAt).getTime();
      const bTime = new Date(b.submittedAt || b.createdAt).getTime();
      return sortOrder === 'newest' ? bTime - aTime : aTime - bTime;
    });
  }, [pendingClaims, users, filter, searchTerm, selectedDepartment, dateFrom, dateTo, sortOrder]);

  const displayedHistory = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return approvalHistory.filter(({ entry, claim }) => {
      const requestor = users.find(user => user.id === claim.requestorId);
      if (selectedDepartment && requestor?.department !== selectedDepartment) return false;
      if (q && ![claim.ref, claim.purpose, requestor?.name, entry.comment]
        .filter(Boolean)
        .some(value => value!.toLowerCase().includes(q))) return false;
      const decidedAt = new Date(entry.timestamp).getTime();
      if (dateFrom && decidedAt < new Date(`${dateFrom}T00:00:00`).getTime()) return false;
      if (dateTo && decidedAt > new Date(`${dateTo}T23:59:59`).getTime()) return false;
      return true;
    }).sort((a, b) => {
      if (sortOrder === 'amount') return b.claim.total - a.claim.total;
      const aTime = new Date(a.entry.timestamp).getTime();
      const bTime = new Date(b.entry.timestamp).getTime();
      return sortOrder === 'oldest' ? aTime - bTime : bTime - aTime;
    });
  }, [approvalHistory, users, searchTerm, selectedDepartment, dateFrom, dateTo, sortOrder]);

  const displayedRecords = view === 'pending' ? displayedClaims : displayedHistory;
  const hasAdvancedFilters = Boolean(selectedDepartment || dateFrom || dateTo);
  const clearFilters = () => {
    setSearchTerm('');
    setSelectedDepartment('');
    setDateFrom('');
    setDateTo('');
    setSortOrder(view === 'pending' ? 'oldest' : 'newest');
  };

  const totalPages = Math.ceil(displayedRecords.length / ITEMS_PER_PAGE);
  const paginatedClaims = displayedClaims.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
  const paginatedHistory = displayedHistory.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  useEffect(() => {
    setCurrentPage(1);
  }, [view, filter, searchTerm, selectedDepartment, dateFrom, dateTo, sortOrder]);

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

      <div className="flex flex-wrap items-center gap-3 pb-2">
        <button onClick={() => { setView('pending'); setFilter('All'); }} className={`px-5 py-2 rounded-full font-label-md transition-colors shadow-sm ${view === 'pending' && filter === 'All' ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-outline-variant'}`}>All Pending ({pendingClaims.length})</button>
        <button onClick={() => { setView('history'); setFilter('All'); setSortOrder('newest'); }} className={`px-5 py-2 rounded-full font-label-md transition-colors shadow-sm ${view === 'history' ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-outline-variant'}`}>Approval History ({approvalHistory.length})</button>
        {view === 'pending' && <>
          <button onClick={() => setFilter('HighPriority')} className={`px-5 py-2 rounded-full font-label-md transition-colors shadow-sm ${filter === 'HighPriority' ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-outline-variant'}`}>High Priority</button>
          <button onClick={() => setFilter('Advances')} className={`px-5 py-2 rounded-full font-label-md transition-colors shadow-sm ${filter === 'Advances' ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-outline-variant'}`}>Cash Advances</button>
          {staleClaims.length > 0 && (
            <button onClick={() => setFilter('Stale')} className={`px-5 py-2 rounded-full font-label-md transition-colors shadow-sm ${filter === 'Stale' ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-outline-variant'}`}>Stale ({staleClaims.length})</button>
          )}
        </>}
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[240px] flex-1 max-w-xl">
            <Input
              value={searchTerm}
              onChange={event => setSearchTerm(event.target.value)}
              placeholder={view === 'pending' ? 'Search pending requests...' : 'Search approval history...'}
              aria-label={view === 'pending' ? 'Search pending requests' : 'Search approval history'}
            />
          </div>
          <Button variant="outline" className="gap-2" onClick={() => setShowFilters(open => !open)} aria-expanded={showFilters}>
            <span className="material-symbols-outlined text-[18px]">filter_list</span>
            Filters{hasAdvancedFilters ? ' (active)' : ''}
          </Button>
          <Select className="w-40" aria-label="Sort order" value={sortOrder} onChange={event => setSortOrder(event.target.value as typeof sortOrder)}>
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
            <option value="amount">Highest amount</option>
          </Select>
          {(searchTerm || hasAdvancedFilters || (view === 'pending' ? sortOrder !== 'oldest' : sortOrder !== 'newest')) && (
            <button className="text-xs font-semibold text-primary hover:underline" onClick={clearFilters}>Clear all</button>
          )}
        </div>
        {showFilters && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-outline-variant pt-4">
            <div>
              <Label>Department</Label>
              <Select value={selectedDepartment} onChange={event => setSelectedDepartment(event.target.value)}>
                <option value="">All Departments</option>
                {departments.map(department => <option key={department}>{department}</option>)}
              </Select>
            </div>
            <div>
              <Label>{view === 'pending' ? 'Submitted from' : 'Decided from'}</Label>
              <Input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} />
            </div>
            <div>
              <Label>{view === 'pending' ? 'Submitted to' : 'Decided to'}</Label>
              <Input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} />
            </div>
          </div>
        )}
        {hasAdvancedFilters && (
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedDepartment && <button onClick={() => setSelectedDepartment('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">{selectedDepartment}<span className="material-symbols-outlined text-[14px]">close</span></button>}
            {dateFrom && <button onClick={() => setDateFrom('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">From {dateFrom}<span className="material-symbols-outlined text-[14px]">close</span></button>}
            {dateTo && <button onClick={() => setDateTo('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">To {dateTo}<span className="material-symbols-outlined text-[14px]">close</span></button>}
          </div>
        )}
        <p className="text-xs text-outline mt-3">
          Showing {displayedRecords.length} {view === 'pending' ? `of ${pendingClaims.length} pending requests` : `of ${approvalHistory.length} approval decisions`}.
        </p>
      </Card>

      {view === 'pending' ? (
      <Card>
        <CardHeader className="bg-surface-container-low/50 border-b border-outline-variant">
          <div>
            <h4 className="font-headline-md text-on-surface">Pending Your Action</h4>
            <p className="text-xs text-outline mt-1">Review the longest-waiting requests first.</p>
          </div>
          <span className="font-label-sm text-outline">{displayedClaims.length} records</span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low text-outline font-label-sm uppercase tracking-wider">
              <tr>
                <th className="px-6 py-4">Requestor</th>
                <th className="px-6 py-4">Ref & Type</th>
                <th className="px-6 py-4">Submitted</th>
                <th className="px-6 py-4">Aging</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 text-right">Quick Actions</th>
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
              ) : paginatedClaims.map(claim => {
                const req = users.find(u => u.id === claim.requestorId) || users[0];
                const aging = getClaimAgingInfo(claim.submittedAt, claim.createdAt);
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
                        <span className="material-symbols-outlined text-[14px] mr-1">{claimTypeIcon(claim.type)}</span>
                        {claim.type}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-on-surface-variant whitespace-nowrap">
                      {formatDate(claim.submittedAt || claim.createdAt)}
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
      ) : (
        <Card>
          <CardHeader className="bg-surface-container-low/50 border-b border-outline-variant">
            <div>
              <h4 className="font-headline-md text-on-surface">Approval History</h4>
              <p className="text-xs text-outline mt-1">Your recorded approval decisions, including comments.</p>
            </div>
            <span className="font-label-sm text-outline">{displayedHistory.length} records</span>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-surface-container-low text-outline font-label-sm uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4">Requestor</th>
                  <th className="px-6 py-4">Ref &amp; Type</th>
                  <th className="px-6 py-4">Decision</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Comment</th>
                  <th className="px-6 py-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {displayedHistory.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-outline">
                      <span className="material-symbols-outlined text-4xl mb-2 opacity-50">history</span>
                      <p className="font-label-md">No approval decisions match this view.</p>
                    </td>
                  </tr>
                ) : paginatedHistory.map(({ entry, claim }) => {
                  const requestor = users.find(user => user.id === claim.requestorId);
                  return (
                    <tr key={entry.id} className="hover:bg-primary/5 transition-colors cursor-pointer" onClick={() => navigate(`/claims/${claim.id}`)}>
                      <td className="px-6 py-4">
                        <p className="font-label-md text-on-surface">{requestor?.name || 'Unknown requestor'}</p>
                        <p className="text-body-sm text-outline">{requestor?.department || '—'}</p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-mono-data font-bold text-on-surface">{claim.ref}</p>
                        <p className="text-body-sm text-outline mt-0.5">{claim.type}</p>
                      </td>
                      <td className="px-6 py-4"><StatusBadge status={entry.newStatus as ClaimStatus} /></td>
                      <td className="px-6 py-4 text-sm text-on-surface-variant whitespace-nowrap">{formatDate(entry.timestamp)}</td>
                      <td className="px-6 py-4 text-sm text-on-surface-variant max-w-[360px]">{entry.comment || '—'}</td>
                      <td className="px-6 py-4 text-right font-mono-data font-bold text-on-surface">{formatMoney(claim.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
        </Card>
      )}
    </div>
  );
}
