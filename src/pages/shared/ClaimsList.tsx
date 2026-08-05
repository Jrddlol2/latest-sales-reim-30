import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { KPICard } from '../../components/ui/KPICard';
import { LiquidationProgressCard } from '../../components/shared/LiquidationProgressCard';
import { ClaimProgressTracker } from '../../components/shared/ClaimProgressTracker';
import { useAppContext } from '../../components/AppContext';
import { Pagination } from '../../components/ui/Pagination';
import { GroupByControl, GroupSection, GroupMetric } from '../../components/shared/GroupByControl';
import { FilterBar } from '../../components/shared/FilterBar';
import { Claim, ClaimStatus, UserRole } from '../../types';
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
  const [requestorFilter, setRequestorFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [groupBy, setGroupBy] = useState<'none' | 'client' | 'requestor'>('none');
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
  // Finance sees every requestor's approved-onward records, so a requestor
  // filter/grouping is meaningful there; a requestor's own list is single-person.
  const requestorOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of myClaims) {
      if (c.requestorId && !map.has(c.requestorId)) {
        map.set(c.requestorId, users.find(u => u.id === c.requestorId)?.name || 'Unknown requestor');
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [myClaims, users]);
  const reimbursedOf = (claim: Claim) => claim.paidAmount || claim.approvedAmount || 0;
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
      const matchesRequestor = requestorFilter ? claim.requestorId === requestorFilter : true;
      const matchesLocation = locationFilter ? claim.location === locationFilter : true;
      const submitted = new Date(claim.submittedAt || claim.createdAt).getTime();
      const matchesFrom = dateFrom ? submitted >= new Date(`${dateFrom}T00:00:00`).getTime() : true;
      const matchesTo = dateTo ? submitted <= new Date(`${dateTo}T23:59:59`).getTime() : true;
      return matchesSearch && matchesStatus && matchesType && matchesClient && matchesRequestor && matchesLocation && matchesFrom && matchesTo;
    });
  }, [myClaims, searchQuery, statusFilter, typeFilter, clientFilter, requestorFilter, locationFilter, dateFrom, dateTo]);

  const totalPages = Math.ceil(filteredClaims.length / itemsPerPage);
  const paginatedClaims = filteredClaims.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Grouped view (finance's Approved Records): bucket by client or requestor,
  // each with an approved/paid subtotal + count.
  const groups = useMemo(() => {
    if (groupBy === 'none') return [];
    const map = new Map<string, Claim[]>();
    for (const c of filteredClaims) {
      const key = groupBy === 'client' ? (c.client || '—') : (c.requestorId || 'unknown');
      const bucket = map.get(key);
      if (bucket) bucket.push(c);
      else map.set(key, [c]);
    }
    return Array.from(map.entries()).map(([key, items]) => {
      const label = groupBy === 'client'
        ? (key === '—' ? 'No client' : key)
        : (users.find(u => u.id === key)?.name || 'Unknown requestor');
      const total = items.reduce((sum, c) => sum + reimbursedOf(c), 0);
      return { key, label, items, total };
    }).sort((a, b) => b.total - a.total);
  }, [filteredClaims, groupBy, users]);

  const groupByOptions = [
    { value: 'none', label: 'List', icon: 'view_list' },
    { value: 'client', label: 'By Client', icon: 'domain' },
    { value: 'requestor', label: 'By Requestor', icon: 'person' },
  ];

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
  }, [searchQuery, statusFilter, typeFilter, clientFilter, requestorFilter, locationFilter, dateFrom, dateTo]);


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
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <GroupByControl value={groupBy} options={groupByOptions} onChange={v => setGroupBy(v as typeof groupBy)} />
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
          </div>
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

      <FilterBar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search claims..."
        quickFilters={[
          {
            type: 'select', key: 'status', label: 'Status', placeholder: 'All Statuses',
            value: statusFilter, onChange: setStatusFilter,
            options: (isFinance ? FINANCE_VISIBLE_STATUSES : Object.values(ClaimStatus)).map(s => ({ value: s, label: s })),
          },
          {
            type: 'select', key: 'type', label: 'Claim type', placeholder: 'All Types',
            value: typeFilter, onChange: setTypeFilter,
            options: ['Reimbursement', 'Transport Reimbursement', 'Cash Advance', 'Liquidation'].map(t => ({ value: t, label: t })),
          },
        ]}
        advancedFilters={[
          {
            type: 'select', key: 'client', label: 'Client', placeholder: 'All Clients',
            value: clientFilter, onChange: setClientFilter,
            options: clientOptions.map(c => ({ value: c, label: c })),
          },
          ...(isFinance ? [{
            type: 'select' as const, key: 'requestor', label: 'Requestor', placeholder: 'All Requestors',
            value: requestorFilter, onChange: setRequestorFilter,
            options: requestorOptions.map(r => ({ value: r.id, label: r.name })),
          }] : []),
          {
            type: 'select', key: 'location', label: 'Location', placeholder: 'All Locations',
            value: locationFilter, onChange: setLocationFilter,
            options: locationOptions.map(l => ({ value: l, label: l })),
          },
          {
            type: 'dateRange', key: 'submitted', label: 'Submitted',
            fromValue: dateFrom, toValue: dateTo, onFromChange: setDateFrom, onToChange: setDateTo,
          },
        ]}
        popoverDescription="Narrow claims by client, location, or submitted date."
      />

      <Card>
        {groupBy === 'none' ? (
          <>
            {renderClaimsBody(paginatedClaims)}
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          </>
        ) : (
          <div className="p-4 space-y-5">
            <p className="text-sm text-outline">
              {groups.length} {groupBy === 'client' ? (groups.length === 1 ? 'client' : 'clients') : (groups.length === 1 ? 'requestor' : 'requestors')}
              {' · '}{filteredClaims.length} claim{filteredClaims.length === 1 ? '' : 's'}
            </p>
            {groups.length === 0 ? (
              <div className="p-8 text-center text-on-surface-variant">No claims found.</div>
            ) : groups.map(group => (
              <GroupSection
                key={group.key}
                icon={groupBy === 'client' ? 'domain' : 'person'}
                title={group.label}
                badge={`${group.items.length} claim${group.items.length === 1 ? '' : 's'}`}
                metrics={<GroupMetric label="Reimbursed" value={formatMoney(group.total)} />}
              >
                {renderClaimsBody(group.items)}
              </GroupSection>
            ))}
          </div>
        )}
      </Card>
    </div>
  );

  function renderClaimsBody(items: Claim[]) {
    return (
      <>
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
              {items.map(claim => {
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
              {items.length === 0 && (
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
          {items.map(claim => {
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
          {items.length === 0 && (
            <div className="p-8 text-center text-on-surface-variant">
              No claims found.
            </div>
          )}
        </div>
      </>
    );
  }
}
