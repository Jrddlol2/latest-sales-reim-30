import { useMemo, useState } from 'react';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Input';
import { useAppContext } from '../../components/AppContext';
import { useToast } from '../../components/shared/ToastContext';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, Legend } from 'recharts';
import { formatMoney, formatAxisMoney } from '../../lib/money';
import { ClaimStatus, UserRole } from '../../types';

// Design-token hex values (see index.css @theme) -- not an arbitrary rainbow.
// Colors carry meaning: blue family = normal progress, orange = needs
// attention, red = rejected, grey = still waiting on someone.
const COLOR_PRIMARY = '#004ac6';
const COLOR_PRIMARY_CONTAINER = '#2563eb';
const COLOR_SECONDARY = '#565e74';
const COLOR_TERTIARY = '#943700';
const COLOR_ERROR = '#ba1a1a';

const STATUS_COLOR: Partial<Record<ClaimStatus, string>> = {
  [ClaimStatus.DRAFT]: '#9ca3af',
  [ClaimStatus.SUBMITTED]: COLOR_SECONDARY,
  [ClaimStatus.PENDING_APPROVAL]: COLOR_SECONDARY,
  [ClaimStatus.REVIEW_MEETING_SCHEDULED]: COLOR_SECONDARY,
  [ClaimStatus.APPROVED]: COLOR_PRIMARY_CONTAINER,
  [ClaimStatus.PROCESSING]: COLOR_PRIMARY_CONTAINER,
  [ClaimStatus.READY_FOR_CLAIM]: COLOR_PRIMARY_CONTAINER,
  [ClaimStatus.RELEASED]: COLOR_PRIMARY_CONTAINER,
  [ClaimStatus.REVIEWED]: COLOR_PRIMARY_CONTAINER,
  [ClaimStatus.COMPLETED]: COLOR_PRIMARY,
  [ClaimStatus.LIQUIDATED]: COLOR_PRIMARY,
  [ClaimStatus.CLOSED]: COLOR_PRIMARY,
  [ClaimStatus.RETURNED]: COLOR_TERTIARY,
  [ClaimStatus.REJECTED]: COLOR_ERROR,
};

const TOP_N_REQUESTORS = 10;
const APPROVAL_SLA_DAYS = 2;

export function AdminReporting() {
  const { claims, lineItems, users, statusHistory } = useAppContext();
  const { addToast } = useToast();

  const [dateRange, setDateRange] = useState<'30d' | '90d' | 'all'>('all');
  const [claimTypeFilter, setClaimTypeFilter] = useState<'All' | 'Reimbursement' | 'CashAdvance' | 'Liquidation'>('All');

  const filteredClaims = useMemo(() => claims.filter(c => {
    if (claimTypeFilter !== 'All' && c.type !== claimTypeFilter) return false;
    if (dateRange === '30d' || dateRange === '90d') {
      const days = dateRange === '30d' ? 30 : 90;
      const d = new Date(c.createdAt);
      return (Date.now() - d.getTime()) <= days * 24 * 60 * 60 * 1000;
    }
    return true;
  }), [claims, claimTypeFilter, dateRange]);

  const filteredClaimIds = useMemo(() => new Set(filteredClaims.map(c => c.id)), [filteredClaims]);
  const filteredLineItems = useMemo(() => lineItems.filter(li => filteredClaimIds.has(li.claimId)), [lineItems, filteredClaimIds]);

  const categoryChartData = useMemo(() => {
    const totals: Record<string, number> = {};
    filteredLineItems.forEach(item => { totals[item.category] = (totals[item.category] || 0) + item.amount; });
    return Object.entries(totals)
      .map(([name, value]) => ({ name, amount: Number(value.toFixed(2)) }))
      .sort((a, b) => b.amount - a.amount);
  }, [filteredLineItems]);

  const statusChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredClaims.forEach(c => { counts[c.status] = (counts[c.status] || 0) + 1; });
    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }, [filteredClaims]);

  const userSpendChartData = useMemo(() => {
    const spend: Record<string, number> = {};
    filteredClaims.forEach(c => {
      const requestor = users.find(u => u.id === c.requestorId)?.name || c.requestorId;
      spend[requestor] = (spend[requestor] || 0) + c.total;
    });
    return Object.entries(spend)
      .map(([name, amount]) => ({ name, amount: Number(amount.toFixed(2)) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, TOP_N_REQUESTORS);
  }, [filteredClaims, users]);

  const departmentChartData = useMemo(() => {
    const spend: Record<string, number> = {};
    filteredClaims.forEach(c => {
      const dept = users.find(u => u.id === c.requestorId)?.department || 'Unknown';
      spend[dept] = (spend[dept] || 0) + c.total;
    });
    return Object.entries(spend)
      .map(([name, amount]) => ({ name, amount: Number(amount.toFixed(2)) }))
      .sort((a, b) => b.amount - a.amount);
  }, [filteredClaims, users]);

  // Avg approval turnaround, computed only from claims that actually have
  // both a submission and a decision timestamp in this filter's scope --
  // no fallback number when there's nothing to compute from.
  const avgTurnaroundDays = useMemo(() => {
    let totalDays = 0;
    let count = 0;
    filteredClaims.forEach(c => {
      const history = statusHistory.filter(h => h.claimId === c.id);
      const submitted = history.find(h => h.newStatus === ClaimStatus.SUBMITTED || h.newStatus === ClaimStatus.PENDING_APPROVAL);
      const decided = history.find(h => h.newStatus === ClaimStatus.APPROVED || h.newStatus === ClaimStatus.READY_FOR_CLAIM || h.newStatus === ClaimStatus.REJECTED);
      if (submitted && decided) {
        const diffDays = (new Date(decided.timestamp).getTime() - new Date(submitted.timestamp).getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays >= 0) { totalDays += diffDays; count++; }
      }
    });
    return count > 0 ? totalDays / count : null;
  }, [filteredClaims, statusHistory]);

  const requestorApproverCount = useMemo(
    () => users.filter(u => u.role === UserRole.REQUESTOR || u.role === UserRole.APPROVER).length,
    [users]
  );

  const handleExportCSV = () => {
    const headers = ['Claim ID', 'Reference', 'Type', 'Requestor', 'Purpose', 'Total Amount', 'Status', 'Created Date'];
    const rows = filteredClaims.map(c => [
      c.id,
      c.ref,
      c.type,
      users.find(u => u.id === c.requestorId)?.name || c.requestorId,
      `"${c.purpose.replace(/"/g, '""')}"`,
      c.total.toFixed(2),
      c.status,
      c.createdAt
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `claims_summary_report_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addToast('CSV Report exported successfully!', 'success');
  };

  const totalFilteredSpend = filteredClaims.reduce((sum, c) => sum + c.total, 0);

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="font-display text-display text-on-surface">Admin Reporting & Analytics</h1>
          <p className="text-body-md text-outline mt-1">Expenditure analysis, compliance metrics, and audit exports.</p>
        </div>
        <Button className="gap-2" onClick={handleExportCSV}>
          <span className="material-symbols-outlined">download</span> Export Claims CSV
        </Button>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-4 bg-surface-container-low p-4 rounded-xl border border-outline-variant">
        <div className="w-full sm:w-48">
          <label className="text-xs font-semibold text-outline block mb-1">Timeframe</label>
          <Select value={dateRange} onChange={e => setDateRange(e.target.value as any)}>
            <option value="all">All Time</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
          </Select>
        </div>
        <div className="w-full sm:w-56">
          <label className="text-xs font-semibold text-outline block mb-1">Claim Type</label>
          <Select value={claimTypeFilter} onChange={e => setClaimTypeFilter(e.target.value as any)}>
            <option value="All">All Claim Types</option>
            <option value="Reimbursement">Reimbursements</option>
            <option value="CashAdvance">Cash Advances</option>
            <option value="Liquidation">Liquidations</option>
          </Select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="p-6 bg-surface-container-low">
          <p className="text-xs font-bold uppercase tracking-wider text-outline mb-1">Total Period Expenditure</p>
          <p className="font-mono-data text-2xl font-bold text-primary">{formatMoney(totalFilteredSpend)}</p>
          <p className="text-[12px] text-outline mt-1">{filteredClaims.length} total claims match filter</p>
        </Card>

        <Card className="p-6 bg-surface-container-low">
          <p className="text-xs font-bold uppercase tracking-wider text-outline mb-1">Avg Approval Turnaround</p>
          <p className="font-mono-data text-2xl font-bold text-on-surface">
            {avgTurnaroundDays === null ? '—' : `${avgTurnaroundDays.toFixed(1)} Day${avgTurnaroundDays.toFixed(1) === '1.0' ? '' : 's'}`}
          </p>
          <p className={`text-[12px] mt-1 ${avgTurnaroundDays === null ? 'text-outline' : avgTurnaroundDays <= APPROVAL_SLA_DAYS ? 'text-green-600' : 'text-error'}`}>
            {avgTurnaroundDays === null ? 'No decided claims in range' : avgTurnaroundDays <= APPROVAL_SLA_DAYS ? `Within ${APPROVAL_SLA_DAYS}-day target` : `Over ${APPROVAL_SLA_DAYS}-day target`}
          </p>
        </Card>

        <Card className="p-6 bg-surface-container-low">
          <p className="text-xs font-bold uppercase tracking-wider text-outline mb-1">Line Items in Range</p>
          <p className="font-mono-data text-2xl font-bold text-on-surface">{filteredLineItems.length}</p>
          <p className="text-[12px] text-outline mt-1">Logged expense items matching filter</p>
        </Card>

        <Card className="p-6 bg-surface-container-low">
          <p className="text-xs font-bold uppercase tracking-wider text-outline mb-1">Requestors &amp; Approvers</p>
          <p className="font-mono-data text-2xl font-bold text-on-surface">{requestorApproverCount}</p>
          <p className="text-[12px] text-outline mt-1">Of {users.length} total system accounts</p>
        </Card>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Category Spend */}
        <Card>
          <CardHeader className="bg-surface-container-low border-b border-outline-variant">
            <h3 className="font-headline-sm text-on-surface">Expenditure by Expense Category</h3>
          </CardHeader>
          <CardContent className="p-0 overflow-y-auto h-80">
            {categoryChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-outline">No expense items to chart</div>
            ) : (
              <div style={{ height: Math.max(320, categoryChartData.length * 40) }} className="p-6">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryChartData} layout="vertical" margin={{ left: 8 }}>
                    <XAxis type="number" stroke="#565e74" fontSize={12} tickFormatter={val => formatAxisMoney(val)} />
                    <YAxis type="category" dataKey="name" stroke="#565e74" fontSize={11} width={110} interval={0} />
                    <Tooltip formatter={(value: any) => [formatMoney(value), 'Amount']} />
                    <Bar dataKey="amount" fill={COLOR_PRIMARY} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* User Spend */}
        <Card>
          <CardHeader className="bg-surface-container-low border-b border-outline-variant">
            <h3 className="font-headline-sm text-on-surface">Top {TOP_N_REQUESTORS} Requestors by Spend</h3>
          </CardHeader>
          <CardContent className="p-0 overflow-y-auto h-80">
            {userSpendChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-outline">No requestor spend to chart</div>
            ) : (
              <div style={{ height: Math.max(320, userSpendChartData.length * 40) }} className="p-6">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={userSpendChartData} layout="vertical" margin={{ left: 8 }}>
                    <XAxis type="number" stroke="#565e74" fontSize={12} tickFormatter={val => formatAxisMoney(val)} />
                    <YAxis type="category" dataKey="name" stroke="#565e74" fontSize={11} width={110} interval={0} />
                    <Tooltip formatter={(value: any) => [formatMoney(value), 'Total Spend']} />
                    <Bar dataKey="amount" fill={COLOR_TERTIARY} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Department Spend */}
        <Card>
          <CardHeader className="bg-surface-container-low border-b border-outline-variant">
            <h3 className="font-headline-sm text-on-surface">Expenditure by Department</h3>
          </CardHeader>
          <CardContent className="p-6 h-80">
            {departmentChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-outline">No department spend to chart</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={departmentChartData} margin={{ bottom: 8 }}>
                  <XAxis dataKey="name" stroke="#565e74" fontSize={12} />
                  <YAxis stroke="#565e74" fontSize={12} tickFormatter={val => formatAxisMoney(val)} width={70} />
                  <Tooltip formatter={(value: any) => [formatMoney(value), 'Amount']} />
                  <Bar dataKey="amount" fill={COLOR_SECONDARY} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Status Distribution */}
        <Card>
          <CardHeader className="bg-surface-container-low border-b border-outline-variant">
            <h3 className="font-headline-sm text-on-surface">Claim Distribution by Status</h3>
          </CardHeader>
          <CardContent className="p-6 h-80">
            {statusChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-outline">No claims to chart</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusChartData.sort((a,b) => b.count - a.count)} layout="vertical" margin={{ left: 8 }}>
                  <XAxis type="number" stroke="#565e74" fontSize={12} />
                  <YAxis type="category" dataKey="name" stroke="#565e74" fontSize={11} width={110} interval={0} />
                  <Tooltip formatter={(value: any) => [`${value} claim${value === 1 ? '' : 's'}`, 'Count']} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {statusChartData.map((entry) => (
                      <Cell key={entry.name} fill={STATUS_COLOR[entry.name as ClaimStatus] || '#9ca3af'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
