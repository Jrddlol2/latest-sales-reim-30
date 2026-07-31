import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Portal } from '../../components/shared/Portal';

import { Card, CardContent } from '../../components/ui/Card';
import { formatMoney } from '../../lib/money';
import { Button } from '../../components/ui/Button';
import { Input, Label, Select } from '../../components/ui/Input';
import { Pagination } from '../../components/ui/Pagination';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { useAppContext } from '../../components/AppContext';
import { uploadUrl } from '../../lib/api';
import { ClaimStatus, UserRole } from '../../types';
import { TeamAnalytics } from '../../components/shared/TeamAnalytics';

interface ReceiptRecord {
  id: string;
  fileName: string;
  fileUrl?: string;
  category: string;
  vendor: string;
  businessPurpose?: string;
  amount: number;
  date: string;
  claimRef?: string;
  claimId?: string;
  claimStatus?: ClaimStatus;
  claimType?: string;
  client?: string;
  requestorId?: string;
  orNumber?: string;
}

export function Receipts() {
  const navigate = useNavigate();
  const { lineItems, claims, currentUser, users } = useAppContext();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedMember, setSelectedMember] = useState('');
  const [receiptStatus, setReceiptStatus] = useState<'all' | 'attached' | 'missing'>('all');
  const [claimStatusFilter, setClaimStatusFilter] = useState('');
  const [claimTypeFilter, setClaimTypeFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'highest' | 'lowest' | 'missing'>('newest');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptRecord | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  // Approvers manage their own submissions plus whatever's routed through
  // them; split the archive so "my receipts" isn't buried in the team's.
  const isApprover = currentUser.role === UserRole.APPROVER;
  const isFinance = currentUser.role === UserRole.FINANCE;
  const reporteeIds = new Set(users.filter(u => u.reportsTo === currentUser.id).map(u => u.id));
  const teamMembers = users
    .filter(user => user.reportsTo === currentUser.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  const [scope, setScope] = useState<'mine' | 'team'>('mine');

  // Every line item belongs here, including expenses whose receipt is missing.
  const derivedReceipts: ReceiptRecord[] = lineItems
    .map(item => {
      const parentClaim = claims.find(c => c.id === item.claimId);
      return {
        id: item.id,
        fileName: item.receiptFileName || (item.receiptUrl ? `Receipt_${item.vendor || item.category}.pdf` : 'No receipt attached'),
        fileUrl: item.receiptUrl,
        category: item.category,
        vendor: item.vendor || 'Vendor N/A',
        businessPurpose: item.businessPurpose,
        amount: item.amount,
        date: item.expenseDate,
        claimRef: parentClaim?.ref,
        claimId: item.claimId,
        claimStatus: parentClaim?.status,
        claimType: parentClaim?.type,
        client: parentClaim?.client,
        requestorId: parentClaim?.requestorId,
        orNumber: item.orNumber,
      };
    });

  const isRequestorInScope = (requestorId?: string) => {
    if (isFinance || !isApprover) return true;
    return scope === 'mine'
      ? requestorId === currentUser.id
      : Boolean(requestorId && reporteeIds.has(requestorId));
  };

  const scopedReceipts = isFinance
    ? derivedReceipts
    : !isApprover
      ? derivedReceipts
      : derivedReceipts.filter(receipt => {
          if (!isRequestorInScope(receipt.requestorId)) return false;
          if (scope !== 'team') return true;
          return claims.find(claim => claim.id === receipt.claimId)?.status !== ClaimStatus.DRAFT;
        });
  const scopedLineItems = lineItems.filter(item => {
    const parentClaim = claims.find(c => c.id === item.claimId);
    if (!isRequestorInScope(parentClaim?.requestorId)) return false;
    return !(isApprover && scope === 'team' && parentClaim?.status === ClaimStatus.DRAFT);
  });
  const availableMembers = users.filter(u =>
    scopedReceipts.some(r => r.requestorId === u.id)
  ).sort((a, b) => a.name.localeCompare(b.name));
  const categoryOptions = Array.from(new Set(scopedReceipts.map(r => r.category).filter(Boolean))).sort();
  const clientOptions = Array.from(new Set(scopedReceipts.map(r => r.client).filter((client): client is string => Boolean(client)))).sort();

  const filteredReceipts = scopedReceipts
    .filter(r => {
      const query = searchTerm.toLowerCase();
      const matchesSearch =
        r.fileName.toLowerCase().includes(query) ||
        r.vendor.toLowerCase().includes(query) ||
        Boolean(r.businessPurpose?.toLowerCase().includes(query)) ||
        Boolean(r.claimRef?.toLowerCase().includes(query)) ||
        Boolean(r.orNumber?.toLowerCase().includes(query));
      const matchesCategory = !selectedCategory || r.category === selectedCategory;
      const matchesReceiptStatus = receiptStatus === 'all' || (receiptStatus === 'attached' ? Boolean(r.fileUrl) : !r.fileUrl);
      const matchesMember = !selectedMember || r.requestorId === selectedMember;
      const matchesClaimStatus = !claimStatusFilter || r.claimStatus === claimStatusFilter;
      const matchesClaimType = !claimTypeFilter || r.claimType === claimTypeFilter;
      const matchesClient = !clientFilter || r.client === clientFilter;
      const matchesAmountMin = !amountMin || r.amount >= Number(amountMin);
      const matchesAmountMax = !amountMax || r.amount <= Number(amountMax);
      const receiptDate = new Date(`${r.date}T12:00:00`).getTime();
      const matchesFrom = !dateFrom || receiptDate >= new Date(`${dateFrom}T00:00:00`).getTime();
      const matchesTo = !dateTo || receiptDate <= new Date(`${dateTo}T23:59:59`).getTime();
      return matchesSearch && matchesCategory && matchesReceiptStatus && matchesMember &&
        matchesClaimStatus && matchesClaimType && matchesClient && matchesAmountMin &&
        matchesAmountMax && matchesFrom && matchesTo;
    })
    .sort((a, b) => {
      if (sortBy === 'oldest') return new Date(a.date).getTime() - new Date(b.date).getTime();
      if (sortBy === 'highest') return b.amount - a.amount;
      if (sortBy === 'lowest') return a.amount - b.amount;
      if (sortBy === 'missing') return Number(Boolean(a.fileUrl)) - Number(Boolean(b.fileUrl)) || new Date(b.date).getTime() - new Date(a.date).getTime();
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

  const filteredReceiptIds = new Set(filteredReceipts.map(receipt => receipt.id));
  const filteredApplicableLineItems = scopedLineItems.filter(item => filteredReceiptIds.has(item.id));

  const totalPages = Math.ceil(filteredReceipts.length / itemsPerPage);
  const paginatedReceipts = filteredReceipts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const advancedFilterCount = [
    selectedMember,
    claimStatusFilter,
    claimTypeFilter,
    clientFilter,
    dateFrom || dateTo,
    amountMin || amountMax,
  ].filter(Boolean).length;
  const hasAdvancedFilters = advancedFilterCount > 0;
  const hasAnyFilters = Boolean(
    searchTerm || selectedCategory || receiptStatus !== 'all' || hasAdvancedFilters
  );

  const clearAdvancedFilters = () => {
    setSelectedMember('');
    setClaimStatusFilter('');
    setClaimTypeFilter('');
    setClientFilter('');
    setAmountMin('');
    setAmountMax('');
    setDateFrom('');
    setDateTo('');
  };

  const clearAllFilters = () => {
    setSearchTerm('');
    setSelectedCategory('');
    setReceiptStatus('all');
    clearAdvancedFilters();
  };

  const applyThisMonth = () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    setDateFrom(firstDay.toISOString().split('T')[0]);
    setDateTo(now.toISOString().split('T')[0]);
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchTerm,
    selectedCategory,
    selectedMember,
    receiptStatus,
    claimStatusFilter,
    claimTypeFilter,
    clientFilter,
    amountMin,
    amountMax,
    dateFrom,
    dateTo,
    sortBy,
    scope,
  ]);

  useEffect(() => {
    setSelectedMember('');
  }, [scope]);

  const filteredTotal = filteredReceipts.reduce((sum, receipt) => sum + receipt.amount, 0);
  const receiptCoverage = filteredApplicableLineItems.length === 0
    ? null
    : Math.round((filteredApplicableLineItems.filter(item => item.receiptUrl).length / filteredApplicableLineItems.length) * 100);
  const averageReceipt = filteredReceipts.length === 0 ? 0 : filteredTotal / filteredReceipts.length;
  const attachedReceiptCount = filteredReceipts.filter(expense => Boolean(expense.fileUrl)).length;
  const categoryTotals = filteredReceipts.reduce<Record<string, number>>((totals, receipt) => {
    totals[receipt.category] = (totals[receipt.category] || 0) + receipt.amount;
    return totals;
  }, {});
  const topCategory = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-display text-on-surface">Expenses &amp; Receipts</h1>
          <p className="text-body-md text-outline mt-1">Review individual expenses, linked claims, and the supporting receipts behind them.</p>
        </div>
      </div>

      {isApprover && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-outline-variant bg-surface-container-low p-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setScope('mine')}
              className={`px-5 py-2.5 rounded-lg font-label-md transition-colors ${scope === 'mine' ? 'bg-primary text-white shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
            >
              My Expenses
            </button>
            <button
              onClick={() => setScope('team')}
              className={`px-5 py-2.5 rounded-lg font-label-md transition-colors ${scope === 'team' ? 'bg-primary text-white shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
            >
              Team Expenses
            </button>
          </div>
          <p className="text-xs text-outline px-3">
            {scope === 'team'
              ? 'Review direct-report expenses and identify missing supporting receipts.'
              : 'Expense lines and receipts attached to your own requests.'}
          </p>
        </div>
      )}

      {isApprover && scope === 'team' && (
        <TeamAnalytics
          members={teamMembers}
          claims={claims}
          lineItems={lineItems}
          title="Team Expense Analytics"
          description="Compare reported expenses, reimbursements, and receipt completeness across direct reports."
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="font-label-sm text-outline uppercase tracking-wider">Total Expense Amount</p>
          <p className="font-headline-md text-primary mt-1">{formatMoney(filteredTotal)}</p>
          <p className="text-[12px] text-outline mt-1">{filteredReceipts.length} expense{filteredReceipts.length === 1 ? '' : 's'} in this view</p>
        </Card>
        <Card className="p-4">
          <p className="font-label-sm text-outline uppercase tracking-wider">Receipt Coverage</p>
          <p className="font-headline-md text-on-surface mt-1">{receiptCoverage === null ? '—' : `${receiptCoverage}%`}</p>
          <p className="text-[12px] text-outline mt-1">{attachedReceiptCount} attached, {filteredReceipts.length - attachedReceiptCount} missing</p>
        </Card>
        <Card className="p-4">
          <p className="font-label-sm text-outline uppercase tracking-wider">Average Expense</p>
          <p className="font-headline-md text-on-surface mt-1">{filteredReceipts.length === 0 ? '—' : formatMoney(averageReceipt)}</p>
          <p className="text-[12px] text-outline mt-1">Across the current filter</p>
        </Card>
        <Card className="p-4">
          <p className="font-label-sm text-outline uppercase tracking-wider">Top Category</p>
          <p className="font-headline-md text-on-surface mt-1 truncate">{topCategory?.[0] || '—'}</p>
          <p className="text-[12px] text-outline mt-1">{topCategory ? formatMoney(topCategory[1]) : 'No supported spend'}</p>
        </Card>
      </div>

      {/* Filter Bar */}
      <div className="relative rounded-xl border border-outline-variant bg-white p-4">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1 min-w-0">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">search</span>
            <Input
              className="pl-10"
              type="text"
              placeholder="Search vendor, purpose, OR number, or claim..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <Select
            aria-label="Filter expenses by category"
            className="w-full lg:w-44"
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
          >
            <option value="">All Categories</option>
            {categoryOptions.map(category => <option key={category} value={category}>{category}</option>)}
          </Select>
          <Select
            aria-label="Filter by receipt status"
            className="w-full lg:w-44"
            value={receiptStatus}
            onChange={e => setReceiptStatus(e.target.value as typeof receiptStatus)}
          >
            <option value="all">All Receipts</option>
            <option value="attached">Receipt Attached</option>
            <option value="missing">Missing Receipt</option>
          </Select>
          <div className="relative w-full lg:w-auto">
            <Button
              variant="outline"
              className={`w-full lg:w-auto gap-2 justify-center ${hasAdvancedFilters ? 'border-primary text-primary bg-primary/5' : ''}`}
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
              <div className="absolute right-0 top-full mt-2 z-30 w-[min(520px,calc(100vw-3rem))] rounded-xl border border-outline-variant bg-white shadow-xl p-5">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h3 className="font-headline-sm text-on-surface">More filters</h3>
                    <p className="text-xs text-outline mt-1">Narrow expenses using claim and purchase details.</p>
                  </div>
                  <button type="button" aria-label="Close filters" className="text-outline hover:text-on-surface" onClick={() => setShowAdvancedFilters(false)}>
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>

                <div className="mb-5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-outline mb-2">Quick views</p>
                  <div className="flex flex-wrap gap-2">
                    <button className="px-3 py-1.5 rounded-full border border-outline-variant text-xs font-semibold hover:border-primary hover:text-primary" onClick={() => setReceiptStatus('missing')}>Missing receipts</button>
                    <button className="px-3 py-1.5 rounded-full border border-outline-variant text-xs font-semibold hover:border-primary hover:text-primary" onClick={applyThisMonth}>This month</button>
                    <button className="px-3 py-1.5 rounded-full border border-outline-variant text-xs font-semibold hover:border-primary hover:text-primary" onClick={() => setClaimStatusFilter(ClaimStatus.PENDING_APPROVAL)}>Pending claims</button>
                    <button className="px-3 py-1.5 rounded-full border border-outline-variant text-xs font-semibold hover:border-primary hover:text-primary" onClick={() => setAmountMin('1000')}>High-value expenses</button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Claim status</Label>
                    <Select value={claimStatusFilter} onChange={e => setClaimStatusFilter(e.target.value)}>
                      <option value="">All Statuses</option>
                      {Object.values(ClaimStatus).map(status => <option key={status} value={status}>{status}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label>Claim type</Label>
                    <Select value={claimTypeFilter} onChange={e => setClaimTypeFilter(e.target.value)}>
                      <option value="">All Types</option>
                      <option value="Reimbursement">Reimbursement</option>
                      <option value="Transport Reimbursement">Transport Reimbursement</option>
                      <option value="Cash Advance">Cash Advance</option>
                      <option value="Liquidation">Liquidation</option>
                    </Select>
                  </div>
                  <div>
                    <Label>Client</Label>
                    <Select value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
                      <option value="">All Clients</option>
                      {clientOptions.map(client => <option key={client} value={client}>{client}</option>)}
                    </Select>
                  </div>
                  {(isFinance || (isApprover && scope === 'team')) && (
                    <div>
                      <Label>{isFinance ? 'Requestor' : 'Team member'}</Label>
                      <Select value={selectedMember} onChange={e => setSelectedMember(e.target.value)}>
                        <option value="">{isFinance ? 'All Requestors' : 'All Team Members'}</option>
                        {availableMembers.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
                      </Select>
                    </div>
                  )}
                  <div>
                    <Label>Purchased from</Label>
                    <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                  </div>
                  <div>
                    <Label>Purchased to</Label>
                    <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
                  </div>
                  <div>
                    <Label>Minimum amount</Label>
                    <Input type="number" min="0" placeholder="₱0" value={amountMin} onChange={e => setAmountMin(e.target.value)} />
                  </div>
                  <div>
                    <Label>Maximum amount</Label>
                    <Input type="number" min="0" placeholder="No maximum" value={amountMax} onChange={e => setAmountMax(e.target.value)} />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 mt-5 pt-4 border-t border-outline-variant">
                  <Button variant="ghost" size="sm" onClick={clearAdvancedFilters} disabled={!hasAdvancedFilters}>Clear</Button>
                  <Button size="sm" onClick={() => setShowAdvancedFilters(false)}>Done</Button>
                </div>
              </div>
            )}
          </div>
          <Select
            aria-label="Sort expenses"
            className="w-full lg:w-44"
            value={sortBy}
            onChange={e => setSortBy(e.target.value as typeof sortBy)}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="highest">Highest amount</option>
            <option value="lowest">Lowest amount</option>
            <option value="missing">Missing receipts first</option>
          </Select>
        </div>

        {hasAnyFilters && (
          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-outline-variant">
            <span className="text-xs font-semibold text-outline">Filtered by</span>
            {selectedCategory && <button className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold" onClick={() => setSelectedCategory('')}>{selectedCategory}<span className="material-symbols-outlined text-[14px]">close</span></button>}
            {receiptStatus !== 'all' && <button className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold" onClick={() => setReceiptStatus('all')}>{receiptStatus === 'attached' ? 'Receipt attached' : 'Missing receipt'}<span className="material-symbols-outlined text-[14px]">close</span></button>}
            {claimStatusFilter && <button className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold" onClick={() => setClaimStatusFilter('')}>{claimStatusFilter}<span className="material-symbols-outlined text-[14px]">close</span></button>}
            {claimTypeFilter && <button className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold" onClick={() => setClaimTypeFilter('')}>{claimTypeFilter}<span className="material-symbols-outlined text-[14px]">close</span></button>}
            {clientFilter && <button className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold" onClick={() => setClientFilter('')}>{clientFilter}<span className="material-symbols-outlined text-[14px]">close</span></button>}
            {selectedMember && <button className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold" onClick={() => setSelectedMember('')}>{users.find(user => user.id === selectedMember)?.name || 'Requestor'}<span className="material-symbols-outlined text-[14px]">close</span></button>}
            {(dateFrom || dateTo) && <button className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold" onClick={() => { setDateFrom(''); setDateTo(''); }}>{dateFrom || 'Any date'} – {dateTo || 'Today'}<span className="material-symbols-outlined text-[14px]">close</span></button>}
            {(amountMin || amountMax) && <button className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold" onClick={() => { setAmountMin(''); setAmountMax(''); }}>{amountMin ? `From ${formatMoney(Number(amountMin))}` : 'Any minimum'}{amountMax ? ` to ${formatMoney(Number(amountMax))}` : ''}<span className="material-symbols-outlined text-[14px]">close</span></button>}
            <button className="text-xs font-semibold text-outline hover:text-primary ml-1" onClick={clearAllFilters}>Clear all</button>
          </div>
        )}
      </div>

      {/* Expense records */}
      {filteredReceipts.length === 0 ? (
        <Card className="p-12 text-center text-outline">
          <span className="material-symbols-outlined text-[48px] mb-3">folder_open</span>
          <p className="font-headline-sm text-on-surface mb-1">No expenses found</p>
          <p className="text-sm">Expense lines will appear here when they are added to a claim.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
        <div className="p-5 border-b border-outline-variant flex items-center justify-between bg-surface-container-low/40">
          <div>
            <h2 className="font-headline-sm text-on-surface">Expense records</h2>
            <p className="text-xs text-outline mt-1">Inspect each purchase, its claim status, and whether evidence is attached.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-label-sm text-outline whitespace-nowrap">{filteredReceipts.length} records</span>
            <div className="flex rounded-lg border border-outline-variant bg-white p-1" aria-label="Expense view">
              <button
                type="button"
                aria-label="Grid view"
                title="Grid view"
                onClick={() => setViewMode('grid')}
                className={`w-9 h-8 rounded flex items-center justify-center ${viewMode === 'grid' ? 'bg-primary text-white' : 'text-outline hover:bg-surface-container-high'}`}
              >
                <span className="material-symbols-outlined text-[18px]">grid_view</span>
              </button>
              <button
                type="button"
                aria-label="List view"
                title="List view"
                onClick={() => setViewMode('list')}
                className={`w-9 h-8 rounded flex items-center justify-center ${viewMode === 'list' ? 'bg-primary text-white' : 'text-outline hover:bg-surface-container-high'}`}
              >
                <span className="material-symbols-outlined text-[18px]">view_list</span>
              </button>
            </div>
          </div>
        </div>
        {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 p-6 pt-4">
          {paginatedReceipts.map(receipt => (
            <Card 
              key={receipt.id} 
              className="overflow-hidden hover:border-primary transition-all cursor-pointer group hover:shadow-md"
              onClick={() => setSelectedReceipt(receipt)}
            >
              <div className="h-36 bg-surface-container-high flex flex-col items-center justify-center relative p-4">
                <span className={`material-symbols-outlined text-4xl mb-1 ${receipt.fileUrl ? 'text-primary' : 'text-tertiary'}`}>
                  {receipt.fileUrl ? 'receipt_long' : 'receipt_long_off'}
                </span>
                <span className="text-xs font-mono-data font-semibold text-on-surface text-center truncate max-w-full px-2">
                  {receipt.fileName}
                </span>
                {!receipt.fileUrl && (
                  <span className="text-[11px] font-bold text-tertiary mt-1">Receipt missing</span>
                )}
                <span className="text-[12px] uppercase font-bold text-outline mt-1 bg-surface-container px-2 py-0.5 rounded">
                  {receipt.category}
                </span>
                {receipt.orNumber && (
                  <span className="text-[11px] font-mono-data text-outline mt-1">OR {receipt.orNumber}</span>
                )}
                {(isFinance || (isApprover && scope === 'team')) && (
                  <span className="text-[12px] text-outline mt-1">
                    {users.find(u => u.id === receipt.requestorId)?.name || 'Unknown requestor'}
                  </span>
                )}
              </div>
              <CardContent className="p-4 bg-surface-container-lowest">
                <div className="flex justify-between items-start mb-1">
                  <p className="font-label-md text-on-surface font-semibold truncate">{receipt.vendor}</p>
                  <p className="font-mono-data font-bold text-primary">{formatMoney(receipt.amount)}</p>
                </div>
                {receipt.businessPurpose && <p className="text-xs text-outline line-clamp-2">{receipt.businessPurpose}</p>}
                <div className="flex justify-between items-center text-xs text-outline mt-2 pt-2 border-t border-outline-variant/40">
                  <span>{receipt.date}</span>
                  {receipt.claimRef && (
                    <span className="bg-primary-container/20 text-primary font-mono-data px-1.5 py-0.5 rounded text-[12px]">
                      {receipt.claimRef}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[900px]">
              <thead className="bg-surface-container-low text-outline font-label-sm uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3">Expense</th>
                  {(isFinance || (isApprover && scope === 'team')) && <th className="px-5 py-3">Requestor</th>}
                  <th className="px-5 py-3">Claim / OR</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3">Date of Purchase</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                  <th className="px-5 py-3 text-right">Attachment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {paginatedReceipts.map(receipt => (
                  <tr
                    key={receipt.id}
                    onClick={() => setSelectedReceipt(receipt)}
                    className="hover:bg-primary/5 cursor-pointer transition-colors"
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <span className={`material-symbols-outlined ${receipt.fileUrl ? 'text-primary' : 'text-tertiary'}`}>
                          {receipt.fileUrl ? 'receipt_long' : 'receipt_long_off'}
                        </span>
                        <div className="min-w-0">
                          <p className="font-label-md text-on-surface truncate max-w-[240px]">{receipt.vendor}</p>
                          <p className="text-xs text-outline truncate max-w-[280px]">{receipt.businessPurpose || receipt.fileName}</p>
                        </div>
                      </div>
                    </td>
                    {(isFinance || (isApprover && scope === 'team')) && (
                      <td className="px-5 py-4 text-body-sm text-on-surface">
                        {users.find(user => user.id === receipt.requestorId)?.name || 'Unknown requestor'}
                      </td>
                    )}
                    <td className="px-5 py-4">
                      <p className="font-mono-data text-xs text-primary">{receipt.claimRef || '—'}</p>
                      <p className="font-mono-data text-[11px] text-outline mt-1">{receipt.orNumber ? `OR ${receipt.orNumber}` : 'No OR number'}</p>
                    </td>
                    <td className="px-5 py-4">
                      {receipt.claimStatus ? <StatusBadge status={receipt.claimStatus} /> : <span className="text-xs text-outline">Not linked</span>}
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface-variant">
                        {receipt.category}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-body-sm text-on-surface-variant whitespace-nowrap">{receipt.date}</td>
                    <td className="px-5 py-4 text-right font-mono-data font-bold text-on-surface">{formatMoney(receipt.amount)}</td>
                    <td className="px-5 py-4 text-right">
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold ${receipt.fileUrl ? 'text-primary' : 'text-tertiary'}`}>
                        {receipt.fileUrl ? 'View receipt' : 'Missing receipt'}
                        <span className="material-symbols-outlined text-[16px]">{receipt.fileUrl ? 'open_in_new' : 'warning'}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
        </Card>
      )}

      {/* Preview Modal */}
      {selectedReceipt && (
        <Portal>
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-surface-container-lowest rounded-xl max-w-2xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-outline-variant pb-3">
              <div>
                <h3 className="font-headline-sm text-on-surface">{selectedReceipt.fileName}</h3>
                <p className="text-xs text-outline">{selectedReceipt.vendor} • {selectedReceipt.date}</p>
              </div>
              <button onClick={() => setSelectedReceipt(null)} className="text-outline hover:text-on-surface">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="bg-surface-container-low border border-outline-variant rounded-lg p-8 flex flex-col items-center justify-center min-h-[260px]">
              {(() => {
                const url = uploadUrl(selectedReceipt.fileUrl) ?? '';
                if (!url) {
                  return (
                    <div className="text-center space-y-2">
                      <span className="material-symbols-outlined text-[64px] text-tertiary">receipt_long_off</span>
                      <p className="font-bold text-on-surface">No receipt attached</p>
                      <p className="text-xs text-outline">Open the linked claim to review or correct this expense.</p>
                    </div>
                  );
                }
                if (url.startsWith('data:image') || url.startsWith('blob:') || url.match(/\.(jpeg|jpg|gif|png)($|\?)/i)) {
                  return <img src={url} alt="Receipt preview" className="max-h-64 object-contain rounded" />;
                }
                if (url.match(/\.pdf($|\?)/i)) {
                  return <iframe title="Receipt attachment" src={url} className="w-full h-64 rounded border border-outline-variant" />;
                }
                return (
                  <div className="text-center space-y-2">
                    <span className="material-symbols-outlined text-[64px] text-primary">description</span>
                    <p className="font-bold text-on-surface">{selectedReceipt.fileName}</p>
                    <p className="text-xs text-outline">Document attachment linked to {selectedReceipt.claimRef || 'Expenses & Receipts'}</p>
                  </div>
                );
              })()}
            </div>
            <div className="flex justify-between items-center text-sm pt-2">
              <div>
                <span className="text-outline">Category:</span> <span className="font-semibold text-on-surface">{selectedReceipt.category}</span>
                <span className="ml-4 text-outline">Amount:</span> <span className="font-mono-data font-bold text-primary">{formatMoney(selectedReceipt.amount)}</span>
                {selectedReceipt.orNumber && (
                  <span className="ml-4 text-outline">OR:</span>
                )}
                {selectedReceipt.orNumber && <span className="ml-1 font-mono-data text-on-surface">{selectedReceipt.orNumber}</span>}
              </div>
              <div className="flex gap-2">
                {selectedReceipt.claimId && (
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => navigate(`/claims/${selectedReceipt.claimId}`)}>
                    <span className="material-symbols-outlined text-[16px]">description</span> View claim
                  </Button>
                )}
                {selectedReceipt.fileUrl && <a href={uploadUrl(selectedReceipt.fileUrl)} target="_blank" rel="noreferrer" download={selectedReceipt.fileName}>
                  <Button variant="outline" size="sm" className="gap-1">
                    <span className="material-symbols-outlined text-[16px]">download</span> Download
                  </Button>
                </a>}
                <Button size="sm" onClick={() => setSelectedReceipt(null)}>Close</Button>
              </div>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}
