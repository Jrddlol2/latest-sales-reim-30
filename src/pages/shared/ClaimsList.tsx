import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Label, Select } from '../../components/ui/Input';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { KPICard } from '../../components/ui/KPICard';
import { LiquidationProgressCard } from '../../components/shared/LiquidationProgressCard';
import { ClaimProgressTracker } from '../../components/shared/ClaimProgressTracker';
import { useAppContext } from '../../components/AppContext';
import { Pagination } from '../../components/ui/Pagination';
import { ClaimStatus, UserRole } from '../../types';
import { formatMoney } from '../../lib/money';
import { formatDate } from '../../lib/date';
import { claimTypeIcon, FINANCE_VISIBLE_STATUSES, getRequestAmountPresentation, isFinanceVisibleClaim } from '../../lib/claimWorkflow';
import { buildFinancialRecordsCsv } from '../../lib/financialRecordsCsv';

const ACTIVE_STATUSES = [ClaimStatus.DRAFT, ClaimStatus.PENDING_APPROVAL, ClaimStatus.PROCESSING, ClaimStatus.READY_FOR_CLAIM];

export function ClaimsList() {
  const { currentUser, claims, users } = useAppContext();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  const isFinance = currentUser.role === UserRole.FINANCE;
  const myClaims = isFinance
    ? claims.filter(isFinanceVisibleClaim)
    : claims.filter(c => c.requestorId === currentUser.id);
  const isApprover = currentUser.role === UserRole.APPROVER;
  const clientOptions = useMemo(
    () => Array.from(new Set(myClaims.map(c => c.client).filter((v): v is string => !!v))).sort(),
    [myClaims]
  );
  const locationOptions = useMemo(
    () => Array.from(new Set(myClaims.map(c => c.location).filter((v): v is string => !!v))).sort(),
    [myClaims]
  );

  // Requestor-style summary, shown to Approvers too so "My Requests" covers
  // their own submissions in one place (they don't get a separate requestor
  // dashboard, but they submit claims like anyone else).
  const activeClaimsCount = myClaims.filter(c => ACTIVE_STATUSES.includes(c.status)).length;
  const completedClaims = myClaims.filter(c => c.status === ClaimStatus.COMPLETED);
  const totalReimbursed = completedClaims.reduce((acc, c) => acc + c.paidAmount, 0);
  const openAdvances = myClaims.filter(c => c.type === 'Cash Advance' && c.status === ClaimStatus.RELEASED);
  const unliquidatedFloat = openAdvances.reduce((acc, c) => acc + c.total, 0);
  const readyForClaim = myClaims.filter(c => c.status === ClaimStatus.READY_FOR_CLAIM);
  const readyForClaimTotal = readyForClaim.reduce((acc, c) => acc + c.total, 0);

  // Most recently submitted (non-draft) claim, for the progress tracker.
  const mostRecentClaim = useMemo(() => {
    const submitted = myClaims.filter(c => c.status !== ClaimStatus.DRAFT);
    return submitted.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  }, [myClaims]);

  const filteredClaims = useMemo(() => {
    return myClaims.filter(claim => {
      const matchesSearch = claim.ref.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            claim.purpose.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            (claim.client || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                            (claim.location || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter ? claim.status === statusFilter : true;
      const matchesType = typeFilter ? claim.type === typeFilter : true;
      const matchesClient = clientFilter ? claim.client === clientFilter : true;
      const matchesLocation = locationFilter ? claim.location === locationFilter : true;
      const submitted = new Date(claim.submittedAt || claim.createdAt).getTime();
      const matchesFrom = dateFrom ? submitted >= new Date(`${dateFrom}T00:00:00`).getTime() : true;
      const matchesTo = dateTo ? submitted <= new Date(`${dateTo}T23:59:59`).getTime() : true;
      return matchesSearch && matchesStatus && matchesType && matchesClient && matchesLocation && matchesFrom && matchesTo;
    });
  }, [myClaims, searchQuery, statusFilter, typeFilter, clientFilter, locationFilter, dateFrom, dateTo]);

  const totalPages = Math.ceil(filteredClaims.length / itemsPerPage);
  const paginatedClaims = filteredClaims.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const advancedFilterCount = [clientFilter, locationFilter, dateFrom || dateTo].filter(Boolean).length;
  const hasAdvancedFilters = advancedFilterCount > 0;

  const clearAdvancedFilters = () => {
    setClientFilter('');
    setLocationFilter('');
    setDateFrom('');
    setDateTo('');
  };

  const exportFinancialRecords = () => {
    const csv = buildFinancialRecordsCsv(filteredClaims, users);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `financial-records-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, typeFilter, clientFilter, locationFilter, dateFrom, dateTo]);


  return (
    <div className="animate-in fade-in duration-500">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h2 className="font-display text-display text-on-surface">{isFinance ? 'Approved Records' : 'My Requests'}</h2>
          <p className="text-body-md text-outline mt-1">
            {isFinance
              ? 'View approved-onward reimbursements, cash advances, and liquidations.'
              : 'Track your submitted claims, advances, and liquidations.'}
          </p>
        </div>
        {isFinance ? (
          <Button
            variant="outline"
            className="gap-2 shrink-0"
            onClick={exportFinancialRecords}
            disabled={filteredClaims.length === 0}
            aria-label="Export filtered financial records to CSV"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            Export CSV
          </Button>
        ) : (
          <Button className="gap-2" onClick={() => navigate('/claims/new')}>
            <span className="material-symbols-outlined text-[20px]">add</span>
            New Claim
          </Button>
        )}
      </div>

      {isApprover && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <KPICard title="Active Claims" value={activeClaimsCount.toString()} icon="pending_actions" iconColorClass="bg-primary-fixed text-on-primary-fixed-variant" />
            <KPICard
              title="Unliquidated Float"
              value={formatMoney(unliquidatedFloat)}
              icon="account_balance_wallet"
              iconColorClass="bg-secondary-container text-on-secondary-fixed-variant"
            />
            <KPICard
              title="Total Reimbursed"
              value={formatMoney(totalReimbursed)}
              icon="payments"
              iconColorClass="bg-tertiary-fixed text-on-tertiary-fixed-variant"
              trend={`${completedClaims.length} completed claim${completedClaims.length === 1 ? '' : 's'}`}
              trendIcon="check_circle"
              trendColorClass="text-success"
            />
          </div>

          {readyForClaim.length > 0 && (
            <Card className="mb-6 border-primary/30 bg-primary-container/20">
              <div className="p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-primary text-[28px]">key</span>
                  <div>
                    <p className="font-label-md text-on-surface">
                      {readyForClaim.length} payout{readyForClaim.length === 1 ? '' : 's'} ready — {formatMoney(readyForClaimTotal)} waiting for you
                    </p>
                    <p className="text-body-sm text-outline">Enter your release code to confirm receipt.</p>
                  </div>
                </div>
                <Button className="gap-2 shrink-0" onClick={() => navigate('/payouts')}>
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                  Go to Payouts
                </Button>
              </div>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <LiquidationProgressCard claims={myClaims} />
            <ClaimProgressTracker claim={mostRecentClaim} users={users} />
          </div>
        </>
      )}

      <Card>
        <CardHeader className="p-4">
          <div className="w-full space-y-3">
            <div className="flex flex-col sm:flex-row gap-3 w-full">
              <div className="relative flex-1 min-w-0">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">search</span>
                <Input
                  className="pl-10 py-1.5"
                  placeholder="Search claims..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
              <Select
                aria-label="Filter by status"
                className="w-full sm:w-44 py-1.5"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
              >
                <option value="">All Statuses</option>
                {(isFinance ? FINANCE_VISIBLE_STATUSES : Object.values(ClaimStatus)).map(status => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </Select>
              <Select
                aria-label="Filter by claim type"
                className="w-full sm:w-44 py-1.5"
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
              >
                <option value="">All Types</option>
                <option value="Reimbursement">Reimbursement</option>
                <option value="Transport Reimbursement">Transport Reimbursement</option>
                <option value="Cash Advance">Cash Advance</option>
                <option value="Liquidation">Liquidation</option>
              </Select>
              <div className="relative w-full sm:w-auto">
                <Button
                  variant="outline"
                  className={`w-full sm:w-auto gap-2 justify-center ${hasAdvancedFilters ? 'border-primary text-primary bg-primary/5' : ''}`}
                  onClick={() => setShowAdvancedFilters(current => !current)}
                  aria-expanded={showAdvancedFilters}
                >
                  <span className="material-symbols-outlined text-[18px]">tune</span>
                  Filters
                  {advancedFilterCount > 0 && (
                    <span className="min-w-5 h-5 px-1 rounded-full bg-primary text-white text-[11px] font-bold flex items-center justify-center">
                      {advancedFilterCount}
                    </span>
                  )}
                </Button>

                {showAdvancedFilters && (
                  <div className="absolute right-0 top-full mt-2 z-30 w-[min(420px,calc(100vw-3rem))] rounded-xl border border-outline-variant bg-white shadow-xl p-5">
                    <div className="flex items-start justify-between gap-4 mb-5">
                      <div>
                        <h3 className="font-headline-sm text-on-surface">More filters</h3>
                        <p className="text-xs text-outline mt-1">Narrow claims by client, location, or submitted date.</p>
                      </div>
                      <button
                        type="button"
                        aria-label="Close filters"
                        className="text-outline hover:text-on-surface"
                        onClick={() => setShowAdvancedFilters(false)}
                      >
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <Label>Client</Label>
                        <Select value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
                          <option value="">All Clients</option>
                          {clientOptions.map(client => <option key={client} value={client}>{client}</option>)}
                        </Select>
                      </div>
                      <div>
                        <Label>Location</Label>
                        <Select value={locationFilter} onChange={e => setLocationFilter(e.target.value)}>
                          <option value="">All Locations</option>
                          {locationOptions.map(location => <option key={location} value={location}>{location}</option>)}
                        </Select>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <Label>Submitted from</Label>
                          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                        </div>
                        <div>
                          <Label>Submitted to</Label>
                          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 mt-5 pt-4 border-t border-outline-variant">
                      <Button variant="ghost" size="sm" onClick={clearAdvancedFilters} disabled={!hasAdvancedFilters}>
                        Clear
                      </Button>
                      <Button size="sm" onClick={() => setShowAdvancedFilters(false)}>Done</Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {hasAdvancedFilters && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-xs font-semibold text-outline">Filtered by</span>
                {clientFilter && (
                  <button className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold" onClick={() => setClientFilter('')}>
                    {clientFilter}<span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                )}
                {locationFilter && (
                  <button className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold" onClick={() => setLocationFilter('')}>
                    {locationFilter}<span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                )}
                {(dateFrom || dateTo) && (
                  <button
                    className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold"
                    onClick={() => { setDateFrom(''); setDateTo(''); }}
                  >
                    {dateFrom || 'Any date'} – {dateTo || 'Today'}
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                )}
                <button className="text-xs font-semibold text-outline hover:text-primary ml-1" onClick={clearAdvancedFilters}>
                  Clear all
                </button>
              </div>
            )}
          </div>
        </CardHeader>
        <div className="overflow-x-auto hidden md:block">
          <table className="w-full min-w-[1040px] text-left">
            <thead className="bg-brand-table-header text-on-surface-variant font-label-sm uppercase tracking-wider">
              <tr>
                <th className="px-6 py-4">ID</th>
                <th className="px-4 py-4">Type</th>
                <th className="px-4 py-4">Purpose</th>
                <th className="px-4 py-4">Client</th>
                <th className="px-4 py-4">Location</th>
                <th className="px-4 py-4">Submitted</th>
                <th className="px-3 py-4" title="Receipt total for reimbursements; requested amount for cash advances.">Expense Total</th>
                <th className="px-3 py-4" title="Approved or paid reimbursement; approved or released amount for cash advances.">Reimbursed</th>
                <th className="px-6 py-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border font-body-base">
              {paginatedClaims.map(claim => {
                const amounts = getRequestAmountPresentation(claim);
                return (
                <tr key={claim.id} className="hover:bg-brand-row-hover transition-colors cursor-pointer" onClick={() => navigate(`/claims/${claim.id}`)}>
                  <td className="px-6 py-4 font-mono-data font-medium">{claim.ref}</td>
                  <td className="px-4 py-4">
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <span className="material-symbols-outlined text-[18px] text-primary">{claimTypeIcon(claim.type)}</span>
                      {claim.type}
                    </span>
                  </td>
                  <td className="px-4 py-4">{claim.purpose}</td>
                  <td className="px-4 py-4 text-on-surface-variant">{claim.client || '—'}</td>
                  <td className="px-4 py-4 text-on-surface-variant">{claim.location || '—'}</td>
                  <td className="px-4 py-4 text-on-surface-variant whitespace-nowrap">{formatDate(claim.submittedAt || claim.createdAt)}</td>
                  <td className="px-3 py-4 whitespace-nowrap">
                    <span className="block font-mono-data font-semibold text-on-surface">{formatMoney(amounts.expenseAmount)}</span>
                    {amounts.expenseLabel !== 'Expense total' && <span className="block text-[11px] text-outline">{amounts.expenseLabel}</span>}
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap">
                    {amounts.reimbursementAmount !== undefined ? (
                      <>
                        <span className="block font-mono-data font-bold text-primary">{formatMoney(amounts.reimbursementAmount)}</span>
                        <span className="block text-[11px] font-semibold text-primary">{amounts.reimbursementLabel}</span>
                      </>
                    ) : (
                      <span className={amounts.reimbursementLabel === 'Pending' ? 'text-sm font-semibold text-tertiary' : 'text-outline'}>
                        {amounts.reimbursementLabel === 'Pending' ? 'Pending' : '—'}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={claim.status} />
                  </td>
                </tr>
              );})}
              {filteredClaims.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-6 py-8 text-center text-on-surface-variant">
                    No claims found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Mobile View */}
        <div className="md:hidden divide-y divide-outline-variant">
          {paginatedClaims.map(claim => {
            const amounts = getRequestAmountPresentation(claim);
            const reimbursementTitle = amounts.reimbursementAmount !== undefined
              ? amounts.reimbursementLabel
              : claim.type === 'Cash Advance' ? 'Released' : 'Reimbursed';
            return (
            <div key={claim.id} className="p-4 flex flex-col gap-3 cursor-pointer hover:bg-surface-container-low transition-colors" onClick={() => navigate(`/claims/${claim.id}`)}>
              <div className="flex justify-between items-start">
                <div className="flex flex-col">
                  <span className="font-mono-data font-bold text-primary">{claim.ref}</span>
                  <span className="text-body-sm text-outline">{claim.type}</span>
                </div>
                <StatusBadge status={claim.status} />
              </div>
              <p className="text-body-base font-semibold">{claim.purpose}</p>
              {(claim.client || claim.location) && (
                <p className="text-body-sm text-outline">{[claim.client, claim.location].filter(Boolean).join(' • ')}</p>
              )}
              <div className="flex justify-between items-end gap-4 mt-1">
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <div>
                    <span className="block text-[11px] text-outline">{amounts.expenseLabel}</span>
                    <span className="font-mono-data font-bold text-on-surface block">{formatMoney(amounts.expenseAmount)}</span>
                  </div>
                  <div>
                    <span className="block text-[11px] text-outline">{reimbursementTitle}</span>
                    <span className="font-mono-data font-bold text-primary block">{amounts.reimbursementAmount !== undefined ? formatMoney(amounts.reimbursementAmount) : amounts.reimbursementLabel === 'Pending' ? 'Pending' : '—'}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs text-outline">{formatDate(claim.submittedAt || claim.createdAt)}</span>
                  <span className="material-symbols-outlined text-outline text-[18px] block">chevron_right</span>
                </div>
              </div>
            </div>
          );})}
          {filteredClaims.length === 0 && (
            <div className="p-8 text-center text-on-surface-variant">
              No claims found.
            </div>
          )}
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
