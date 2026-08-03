import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Label, Select } from '../../components/ui/Input';
import { Pagination } from '../../components/ui/Pagination';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { useAppContext } from '../../components/AppContext';
import { Claim, ClaimStatus, UserRole } from '../../types';
import { formatMoney } from '../../lib/money';
import { formatDate } from '../../lib/date';

export function TransactionHistory() {
  const navigate = useNavigate();
  const { claims, users, statusHistory, currentUser } = useAppContext();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'amount'>('newest');
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  const finalStatuses: ClaimStatus[] = [ClaimStatus.COMPLETED, ClaimStatus.RELEASED, ClaimStatus.CLOSED, ClaimStatus.LIQUIDATED];
  const completedClaims = claims.filter(c => finalStatuses.includes(c.status));

  const completionDateFor = (claim: Claim) => {
    const completedEntry = statusHistory
      .filter(h => h.claimId === claim.id && finalStatuses.includes(h.newStatus))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
    const fallback = claim.processingDate || claim.releaseDate;
    return completedEntry ? new Date(completedEntry.timestamp) : fallback ? new Date(fallback) : undefined;
  };

  const filteredClaims = useMemo(() => {
    const q = search.trim().toLowerCase();
    return completedClaims.filter(c => {
      const req = users.find(u => u.id === c.requestorId);
      const matchesSearch = !q || c.ref.toLowerCase().includes(q) || (req?.name || '').toLowerCase().includes(q);
      const matchesType = !typeFilter || c.type === typeFilter;
      const completionDate = completionDateFor(c)?.getTime();
      const matchesFrom = !dateFrom || (!!completionDate && completionDate >= new Date(`${dateFrom}T00:00:00`).getTime());
      const matchesTo = !dateTo || (!!completionDate && completionDate <= new Date(`${dateTo}T23:59:59`).getTime());
      return matchesSearch && matchesType && matchesFrom && matchesTo;
    }).sort((a, b) => {
      if (sortOrder === 'amount') return (b.paidAmount || b.approvedAmount || b.total) - (a.paidAmount || a.approvedAmount || a.total);
      const aTime = completionDateFor(a)?.getTime() || 0;
      const bTime = completionDateFor(b)?.getTime() || 0;
      return sortOrder === 'oldest' ? aTime - bTime : bTime - aTime;
    });
  }, [completedClaims, users, statusHistory, search, typeFilter, dateFrom, dateTo, sortOrder]);
  const hasFilters = Boolean(typeFilter || dateFrom || dateTo);

  const totalPages = Math.ceil(filteredClaims.length / itemsPerPage);
  const paginatedClaims = filteredClaims.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, typeFilter, dateFrom, dateTo, sortOrder]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <span className="font-label-sm text-primary font-bold tracking-wider uppercase">
            {currentUser.role === UserRole.FINANCE ? 'Finance Archive' : 'Custodian Tools'}
          </span>
          <h1 className="font-display text-display text-on-surface mt-1">{currentUser.role === UserRole.FINANCE ? 'Paid & Completed' : 'Transaction History'}</h1>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[240px] flex-1 max-w-xl">
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search reference or requestor..." />
          </div>
          <Button variant="outline" className="gap-2" onClick={() => setShowFilters(open => !open)}>
            <span className="material-symbols-outlined text-[18px]">filter_list</span>
            Filters{hasFilters ? ' (active)' : ''}
          </Button>
          <Select className="w-40" value={sortOrder} onChange={e => setSortOrder(e.target.value as typeof sortOrder)} aria-label="Sort transaction history">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="amount">Highest amount</option>
          </Select>
          {(search || hasFilters || sortOrder !== 'newest') && (
            <button className="text-xs font-semibold text-primary hover:underline" onClick={() => { setSearch(''); setTypeFilter(''); setDateFrom(''); setDateTo(''); setSortOrder('newest'); }}>Clear all</button>
          )}
        </div>
        {showFilters && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-outline-variant pt-4">
            <div><Label>Request Type</Label><Select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}><option value="">All types</option><option value="Reimbursement">Reimbursement</option><option value="Transport Reimbursement">Transport Reimbursement</option><option value="Cash Advance">Cash Advance</option><option value="Liquidation">Liquidation</option></Select></div>
            <div><Label>Completed From</Label><Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></div>
            <div><Label>Completed To</Label><Input type="date" min={dateFrom || undefined} value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
          </div>
        )}
        {hasFilters && (
          <div className="mt-3 flex flex-wrap gap-2">
            {typeFilter && <button onClick={() => setTypeFilter('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">{typeFilter}<span className="material-symbols-outlined text-[14px]">close</span></button>}
            {dateFrom && <button onClick={() => setDateFrom('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">From {dateFrom}<span className="material-symbols-outlined text-[14px]">close</span></button>}
            {dateTo && <button onClick={() => setDateTo('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">To {dateTo}<span className="material-symbols-outlined text-[14px]">close</span></button>}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader className="bg-surface-container-low">
          <h3 className="font-label-md uppercase tracking-wider text-on-surface">Completed Disbursements</h3>
          <span className="font-label-sm text-outline whitespace-nowrap">{filteredClaims.length} of {completedClaims.length}</span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low text-label-sm text-outline uppercase">
              <tr>
                <th className="px-6 py-4">Claim ID</th>
                <th className="px-6 py-4">Requestor</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Date Submitted</th>
                <th className="px-6 py-4">Completion Date</th>
                <th className="px-6 py-4">Payment Method</th>
                <th className="px-6 py-4">Payment Reference</th>
                <th className="px-6 py-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {paginatedClaims.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-outline">
                    <span className="material-symbols-outlined text-4xl mb-2 opacity-50">history</span>
                    <p className="font-label-md">{completedClaims.length === 0 ? 'No completed transactions yet.' : 'No transactions match your search.'}</p>
                  </td>
                </tr>
              ) : paginatedClaims.map(claim => {
                const req = users.find(u => u.id === claim.requestorId) || users[0];
                const completedAt = completionDateFor(claim);
                return (
                  <tr key={claim.id} className="hover:bg-primary-container/5 transition-colors cursor-pointer" onClick={() => navigate(`/claims/${claim.id}`)}>
                    <td className="px-6 py-5 font-mono-data text-primary font-bold">{claim.ref}</td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        {req.avatarUrl ? (
                          <img src={req.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center text-xs font-semibold">{req.name.split(' ').map(n=>n[0]).join('')}</div>
                        )}
                        <div>
                          <p className="text-sm font-bold">{req.name}</p>
                          <p className="text-xs text-outline">{req.department}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5 font-mono-data text-sm font-bold">{formatMoney(claim.paidAmount || claim.approvedAmount || claim.total)}</td>
                    <td className="px-6 py-5 text-on-surface-variant text-sm">{formatDate(claim.submittedAt || claim.createdAt)}</td>
                    <td className="px-6 py-5 text-on-surface-variant text-sm">
                      {completedAt ? formatDate(completedAt) : '—'}
                    </td>
                    <td className="px-6 py-5 text-on-surface-variant text-sm">{claim.paymentMethod || '—'}</td>
                    <td className="px-6 py-5 font-mono-data text-on-surface-variant text-sm">{claim.paymentReference || claim.releaseReference || '—'}</td>
                    <td className="px-6 py-5 text-center">
                      <StatusBadge status={claim.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      </Card>
    </div>
  );
}
