import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader } from '../../components/ui/Card';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { ClaimStatus } from '../../types';
import { formatMoney } from '../../lib/money';
import { CustodianActionButtons } from '../../components/shared/CustodianActionButtons';
import { useAppContext } from '../../components/AppContext';
import { Pagination } from '../../components/ui/Pagination';
import { claimTypeIcon, getClaimAgingInfo, isCustodianProcessingClaim } from '../../lib/claimWorkflow';
import { Button } from '../../components/ui/Button';
import { Input, Label, Select } from '../../components/ui/Input';

const ITEMS_PER_PAGE = 15;
const ageInDays = (date: string) => Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86400000));

export function ProcessingQueue() {
  const navigate = useNavigate();
  const { claims, users } = useAppContext();

  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [priority, setPriority] = useState('');
  const [sortOrder, setSortOrder] = useState<'oldest' | 'newest' | 'amount'>('oldest');
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const processingClaims = useMemo(
    () => claims
      .filter(isCustodianProcessingClaim)
      .sort((a, b) =>
        new Date(a.approvedAt || a.submittedAt || a.createdAt).getTime() -
        new Date(b.approvedAt || b.submittedAt || b.createdAt).getTime()
      ),
    [claims]
  );

  const departments = useMemo(() => Array.from(new Set(processingClaims
    .map(claim => users.find(user => user.id === claim.requestorId)?.department)
    .filter((value): value is string => Boolean(value)))).sort(), [processingClaims, users]);
  const displayedClaims = useMemo(() => {
    const query = search.trim().toLowerCase();
    return processingClaims.filter(claim => {
      const requestor = users.find(user => user.id === claim.requestorId);
      if (filter === 'Audit' && claim.status !== ClaimStatus.PROCESSING) return false;
      if (filter === 'Advances' && claim.type !== 'Cash Advance') return false;
      if (filter === 'Liquidations' && claim.type !== 'Liquidation') return false;
      if (department && requestor?.department !== department) return false;
      if (priority === 'high' && !(claim.flaggedHighValue || claim.total > 15000)) return false;
      if (query && ![claim.ref, claim.purpose, requestor?.name]
        .filter(Boolean).some(value => value!.toLowerCase().includes(query))) return false;
      return true;
    }).sort((a, b) => {
      if (sortOrder === 'amount') return b.total - a.total;
      const aTime = new Date(a.approvedAt || a.submittedAt || a.createdAt).getTime();
      const bTime = new Date(b.approvedAt || b.submittedAt || b.createdAt).getTime();
      return sortOrder === 'newest' ? bTime - aTime : aTime - bTime;
    });
  }, [processingClaims, users, filter, search, department, priority, sortOrder]);
  const hasFilters = Boolean(department || priority);

  const totalPages = Math.ceil(displayedClaims.length / ITEMS_PER_PAGE);
  const paginatedClaims = displayedClaims.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter, search, department, priority, sortOrder]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="font-display text-display text-on-surface">Processing Queue</h1>
          <p className="text-body-md text-outline mt-1">Manage approved claims, cash advances, and liquidations.</p>
        </div>
      </div>

      {processingClaims[0] && (() => {
        const oldest = processingClaims[0];
        const requestor = users.find(user => user.id === oldest.requestorId);
        const aging = getClaimAgingInfo(oldest.approvedAt || oldest.submittedAt, oldest.createdAt);
        return (
          <button
            type="button"
            onClick={() => navigate(`/claims/${oldest.id}`)}
            className="w-full flex flex-col sm:flex-row sm:items-center gap-3 text-left rounded-xl border border-tertiary/40 bg-tertiary-container/20 p-4 hover:bg-tertiary-container/30 transition-colors"
          >
            <span className="material-symbols-outlined text-tertiary">priority_high</span>
            <div className="flex-1">
              <p className="font-label-md text-on-surface">Oldest item: {oldest.ref} · {requestor?.name || 'Unknown requestor'}</p>
              <p className="text-body-sm text-outline mt-1">Waiting in the custodian queue for {aging.text.toLowerCase().replace('waiting ', '')}.</p>
            </div>
            <span className={`inline-flex px-2.5 py-1 rounded-md text-xs font-bold ${aging.color}`}>{aging.text}</span>
            <span className="material-symbols-outlined text-outline">arrow_forward</span>
          </button>
        );
      })()}

      <div className="flex flex-wrap items-center gap-3 pb-2">
        <button onClick={() => setFilter('All')} className={`px-5 py-2 rounded-full font-label-md transition-colors shadow-sm focus:ring-2 focus:ring-primary outline-none ${filter === 'All' ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-outline-variant'}`}>All Processing</button>
        <button onClick={() => setFilter('Audit')} className={`px-5 py-2 rounded-full font-label-md transition-colors shadow-sm focus:ring-2 focus:ring-primary outline-none ${filter === 'Audit' ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-outline-variant'}`}>In Audit</button>
        <button onClick={() => setFilter('Advances')} className={`px-5 py-2 rounded-full font-label-md transition-colors shadow-sm focus:ring-2 focus:ring-primary outline-none ${filter === 'Advances' ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-outline-variant'}`}>Cash Advances</button>
        <button onClick={() => setFilter('Liquidations')} className={`px-5 py-2 rounded-full font-label-md transition-colors shadow-sm focus:ring-2 focus:ring-primary outline-none ${filter === 'Liquidations' ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-outline-variant'}`}>Liquidations</button>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[240px] flex-1 max-w-xl">
            <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search reference, requestor, or purpose..." aria-label="Search processing queue" />
          </div>
          <Button variant="outline" className="gap-2" onClick={() => setShowFilters(open => !open)}>
            <span className="material-symbols-outlined text-[18px]">filter_list</span>
            Filters{hasFilters ? ' (active)' : ''}
          </Button>
          <Select className="w-40" value={sortOrder} onChange={event => setSortOrder(event.target.value as typeof sortOrder)} aria-label="Sort processing queue">
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
            <option value="amount">Highest amount</option>
          </Select>
          {(search || hasFilters || sortOrder !== 'oldest') && <button className="text-xs font-semibold text-primary hover:underline" onClick={() => { setSearch(''); setDepartment(''); setPriority(''); setSortOrder('oldest'); }}>Clear all</button>}
        </div>
        {showFilters && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-outline-variant pt-4">
            <div><Label>Department</Label><Select value={department} onChange={event => setDepartment(event.target.value)}><option value="">All departments</option>{departments.map(item => <option key={item}>{item}</option>)}</Select></div>
            <div><Label>Priority</Label><Select value={priority} onChange={event => setPriority(event.target.value)}><option value="">All priorities</option><option value="high">High value</option></Select></div>
          </div>
        )}
        {hasFilters && <div className="mt-3 flex flex-wrap gap-2">
          {department && <button onClick={() => setDepartment('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">{department}<span className="material-symbols-outlined text-[14px]">close</span></button>}
          {priority && <button onClick={() => setPriority('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">High value<span className="material-symbols-outlined text-[14px]">close</span></button>}
        </div>}
      </Card>

      <Card>
        <CardHeader className="bg-surface-container-low/50 border-b border-outline-variant">
          <div>
            <h4 className="font-headline-md text-on-surface">Disbursement Worklist</h4>
            <p className="text-xs text-outline mt-1">Oldest approved requests are prioritized first.</p>
          </div>
          <span className="font-label-sm text-outline">{displayedClaims.length} records</span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low text-outline font-label-sm uppercase tracking-wider">
              <tr>
                <th className="px-6 py-4">Requestor</th>
                <th className="px-6 py-4">Ref & Type</th>
                <th className="px-6 py-4">In Queue</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {displayedClaims.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-outline">
                    <span className="material-symbols-outlined text-4xl mb-2 opacity-50">task_alt</span>
                    <p className="font-label-md">Queue is empty!</p>
                  </td>
                </tr>
              ) : paginatedClaims.map(claim => {
                const req = users.find(u => u.id === claim.requestorId) || users[0];
                const aging = getClaimAgingInfo(claim.approvedAt || claim.submittedAt, claim.createdAt);
                return (
                  <tr key={claim.id} className={`hover:bg-primary-fixed/20 transition-colors group cursor-pointer ${claim.id === processingClaims[0]?.id ? 'bg-tertiary-container/10' : ''}`} onClick={(e) => {
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
                      <p className="font-label-md text-on-surface flex items-center gap-2">
                        {claim.ref}
                        {claim.flaggedHighValue && <span className="px-2 py-0.5 rounded text-[12px] uppercase font-bold bg-error-container text-error">High Value</span>}
                      </p>
                      <div className="flex items-center text-outline font-body-sm mt-0.5">
                        <span className="material-symbols-outlined text-[14px] mr-1">{claimTypeIcon(claim.type)}</span>
                        {claim.type}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2 py-1 rounded-md text-xs font-bold whitespace-nowrap ${aging.color}`}>{aging.text}</span>
                    </td>
                    <td className="px-6 py-4 font-mono-data text-on-surface font-bold">
                       {formatMoney(claim.type === 'Liquidation'
                         ? Math.abs(claim.varianceAmount || 0)
                         : (claim.type === 'Reimbursement' || claim.type === 'Transport Reimbursement')
                           ? (claim.approvedAmount ?? Math.min(claim.total, 1000))
                           : claim.total)}
                       {claim.type === 'Liquidation' && <span className="block text-xs font-normal text-on-surface-variant">{claim.varianceType}</span>}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <StatusBadge status={claim.status} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <CustodianActionButtons claim={claim} />
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

