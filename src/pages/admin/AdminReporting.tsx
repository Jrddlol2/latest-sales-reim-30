import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AnalyticsFilters } from '../../components/shared/AnalyticsFilters';
import { useToast } from '../../components/shared/ToastContext';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Pagination } from '../../components/ui/Pagination';
import { StatusBadge } from '../../components/ui/StatusBadge';
import {
  AnalyticsFilters as AnalyticsFilterState,
  AnalyticsSummary,
  DEFAULT_ANALYTICS_FILTERS,
  downloadAnalyticsCsv,
  fetchAnalyticsSummary,
} from '../../lib/analytics';
import { formatDate } from '../../lib/date';
import { formatAxisMoney, formatMoney } from '../../lib/money';
import { ClaimStatus } from '../../types';

const COLOR_PRIMARY = '#004ac6';
const COLOR_SECONDARY = '#565e74';
const COLOR_TERTIARY = '#943700';
const PAGE_SIZE = 20;

const STATUS_COLOR: Partial<Record<ClaimStatus, string>> = {
  [ClaimStatus.DRAFT]: '#9ca3af',
  [ClaimStatus.SUBMITTED]: COLOR_SECONDARY,
  [ClaimStatus.PENDING_APPROVAL]: COLOR_SECONDARY,
  [ClaimStatus.APPROVED]: COLOR_PRIMARY,
  [ClaimStatus.PROCESSING]: COLOR_PRIMARY,
  [ClaimStatus.READY_FOR_CLAIM]: COLOR_PRIMARY,
  [ClaimStatus.RELEASED]: COLOR_PRIMARY,
  [ClaimStatus.REVIEWED]: COLOR_PRIMARY,
  [ClaimStatus.COMPLETED]: '#0d9488',
  [ClaimStatus.LIQUIDATED]: '#0d9488',
  [ClaimStatus.CLOSED]: '#0d9488',
  [ClaimStatus.RETURNED]: COLOR_TERTIARY,
  [ClaimStatus.REJECTED]: '#ba1a1a',
};

interface ReportingProps {
  audience?: 'admin' | 'finance';
}

export function AdminReporting({ audience = 'admin' }: ReportingProps = {}) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [filters, setFilters] = useState<AnalyticsFilterState>({ ...DEFAULT_ANALYTICS_FILTERS });
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    fetchAnalyticsSummary(filters)
      .then(result => {
        if (!active) return;
        setSummary(result);
        setPage(1);
      })
      .catch((cause: any) => {
        if (!active) return;
        setError(cause?.message || 'Could not load analytics.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [filters]);

  const paginatedRecords = useMemo(() => {
    if (!summary) return [];
    const start = (page - 1) * PAGE_SIZE;
    return summary.records.slice(start, start + PAGE_SIZE);
  }, [summary, page]);
  const totalPages = Math.max(1, Math.ceil((summary?.records.length || 0) / PAGE_SIZE));

  const exportRecords = () => {
    if (!summary?.records.length) {
      addToast('There are no filtered records to export.', 'info');
      return;
    }
    downloadAnalyticsCsv(summary.records, audience === 'finance' ? 'finance-analytics' : 'admin-analytics');
    addToast(`Exported ${summary.records.length} filtered record${summary.records.length === 1 ? '' : 's'}.`, 'success');
  };

  const metrics = summary?.metrics;
  const categoryData = summary?.breakdowns.byCategory || [];
  const departmentData = (summary?.breakdowns.byDepartment || []).slice(0, 10);
  const requestorData = (summary?.breakdowns.byRequestor || []).slice(0, 10);
  const statusData = summary?.breakdowns.byStatus || [];
  const monthlyMovement = useMemo(() => {
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
      return {
        key: `${date.getFullYear()}-${date.getMonth()}`,
        month: date.toLocaleDateString(undefined, { month: 'short' }),
        claimed: 0,
        paid: 0,
      };
    });
    const byMonth = new Map(months.map(month => [month.key, month]));
    (summary?.records || []).forEach(record => {
      const submitted = new Date(record.submittedAt || record.createdAt);
      const submittedBucket = byMonth.get(`${submitted.getFullYear()}-${submitted.getMonth()}`);
      if (submittedBucket) submittedBucket.claimed += record.claimedAmount;
      if (record.paidAt) {
        const paid = new Date(record.paidAt);
        const paidBucket = byMonth.get(`${paid.getFullYear()}-${paid.getMonth()}`);
        if (paidBucket) paidBucket.paid += record.paidAmount;
      }
    });
    return months;
  }, [summary]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <span className="font-label-sm text-primary font-bold tracking-wider uppercase">
            {audience === 'finance' ? 'View-only financial reporting' : 'System-wide reporting'}
          </span>
          <h1 className="font-display text-display text-on-surface mt-1">
            {audience === 'finance' ? 'Finance Analytics' : 'Admin Analytics'}
          </h1>
          <p className="text-body-md text-outline mt-1">
            Claimed, approved, paid, and outstanding values use one role-scoped metric contract.
          </p>
        </div>
        <Button variant="outline" className="gap-2" onClick={exportRecords} disabled={loading || !summary?.records.length}>
          <span className="material-symbols-outlined text-[18px]">download</span>
          Export filtered CSV
        </Button>
      </div>

      <AnalyticsFilters
        value={filters}
        dimensions={summary?.dimensions}
        onChange={setFilters}
        loading={loading}
      />

      {error && (
        <Card className="p-5 border-error/30 bg-error-container/10 text-error">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined">error</span>
            <p className="text-sm font-semibold">{error}</p>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="p-6 bg-surface-container-low">
          <p className="text-xs font-bold uppercase tracking-wider text-outline mb-1">Claimed / Reported</p>
          <p className="font-mono-data text-2xl font-bold text-on-surface">{loading ? '…' : formatMoney(metrics?.claimedAmount || 0)}</p>
          <p className="text-[12px] text-outline mt-1">{metrics?.recordCount || 0} filtered records</p>
        </Card>
        <Card className="p-6 bg-surface-container-low">
          <p className="text-xs font-bold uppercase tracking-wider text-outline mb-1">Approved / Reviewed</p>
          <p className="font-mono-data text-2xl font-bold text-primary">{loading ? '…' : formatMoney(metrics?.approvedAmount || 0)}</p>
          <p className="text-[12px] text-outline mt-1">Accepted for processing</p>
        </Card>
        <Card className="p-6 bg-surface-container-low">
          <p className="text-xs font-bold uppercase tracking-wider text-outline mb-1">Paid / Released</p>
          <p className="font-mono-data text-2xl font-bold text-tertiary">{loading ? '…' : formatMoney(metrics?.paidAmount || 0)}</p>
          <p className="text-[12px] text-outline mt-1">Actual company cash movement</p>
        </Card>
        <Card className="p-6 bg-surface-container-low">
          <p className="text-xs font-bold uppercase tracking-wider text-outline mb-1">Outstanding</p>
          <p className="font-mono-data text-2xl font-bold text-on-surface">{loading ? '…' : formatMoney(metrics?.outstandingAmount || 0)}</p>
          <p className="text-[12px] text-outline mt-1">
            {metrics?.avgApprovalTurnaroundDays == null
              ? 'No complete approval intervals'
              : `${metrics.avgApprovalTurnaroundDays.toFixed(1)} day average approval`}
          </p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="bg-surface-container-low border-b border-outline-variant">
          <div>
            <h3 className="font-headline-sm text-on-surface">
              {audience === 'finance' ? 'Cash exposure and releases' : 'Submission and payout movement'}
            </h3>
            <p className="text-xs text-outline mt-1">
              {audience === 'finance'
                ? 'Compare reported obligations with actual cash released during the last six months.'
                : 'Track demand entering the system against value successfully paid out.'}
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-6 h-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={monthlyMovement} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id={`claimed-${audience}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLOR_PRIMARY} stopOpacity={0.24} />
                  <stop offset="95%" stopColor={COLOR_PRIMARY} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" axisLine={false} tickLine={false} stroke="#565e74" fontSize={12} />
              <YAxis axisLine={false} tickLine={false} stroke="#565e74" fontSize={12} tickFormatter={formatAxisMoney} width={72} />
              <Tooltip formatter={(value: number, key: string) => [formatMoney(value), key === 'claimed' ? 'Claimed' : 'Paid']} />
              <Area type="monotone" dataKey="claimed" stroke={COLOR_PRIMARY} strokeWidth={2.5} fill={`url(#claimed-${audience})`} />
              <Area type="monotone" dataKey="paid" stroke="#0d9488" strokeWidth={2.5} fill="transparent" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <MetricBarCard
          title={audience === 'finance' ? 'Expense exposure by category' : 'Reported expenses by category'}
          data={categoryData}
          dataKey="amount"
          color={COLOR_PRIMARY}
          emptyText="No expense lines match these filters."
        />
        <MetricBarCard
          title={audience === 'finance' ? 'Obligations by department' : 'Adoption and value by department'}
          data={departmentData}
          dataKey="claimedAmount"
          color={COLOR_SECONDARY}
          emptyText="No department activity matches these filters."
        />
        <MetricBarCard
          title={audience === 'finance' ? 'Highest-value requestors' : 'Top requestors by claimed value'}
          data={requestorData}
          dataKey="claimedAmount"
          color={COLOR_TERTIARY}
          emptyText="No requestor activity matches these filters."
        />
        <Card>
          <CardHeader className="bg-surface-container-low border-b border-outline-variant">
            <div>
              <h3 className="font-headline-sm text-on-surface">Records by Status</h3>
              <p className="text-xs text-outline mt-1">Counts use the same role scope and filters.</p>
            </div>
          </CardHeader>
          <CardContent className="p-6 h-80">
            {statusData.length === 0 ? (
              <EmptyChart text="No statuses match these filters." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusData} layout="vertical" margin={{ left: 8 }}>
                  <XAxis type="number" stroke="#565e74" fontSize={12} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" stroke="#565e74" fontSize={11} width={115} interval={0} />
                  <Tooltip formatter={(value: any) => [value, 'Records']} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {statusData.map(entry => (
                      <Cell key={entry.name} fill={STATUS_COLOR[entry.name as ClaimStatus] || '#9ca3af'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="bg-surface-container-low border-b border-outline-variant">
          <div>
            <h3 className="font-headline-sm text-on-surface">Filtered Records</h3>
            <p className="text-xs text-outline mt-1">Drill down from any KPI or chart using the shared filters above.</p>
          </div>
          <span className="text-xs font-semibold text-outline">{summary?.records.length || 0} records</span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[1050px]">
            <thead className="bg-surface-container-low text-outline font-label-sm uppercase tracking-wider">
              <tr>
                <th className="px-5 py-4">Reference</th>
                <th className="px-5 py-4">Requestor</th>
                <th className="px-5 py-4">Type</th>
                <th className="px-5 py-4">Submitted</th>
                <th className="px-5 py-4 text-right">Claimed</th>
                <th className="px-5 py-4 text-right">Approved</th>
                <th className="px-5 py-4 text-right">Paid</th>
                <th className="px-5 py-4 text-right">Outstanding</th>
                <th className="px-5 py-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {!loading && paginatedRecords.length === 0 ? (
                <tr><td colSpan={9} className="px-6 py-12 text-center text-outline">No records match the current filters.</td></tr>
              ) : paginatedRecords.map(record => (
                <tr
                  key={`${record.type}-${record.id}`}
                  className="hover:bg-primary-container/5 cursor-pointer"
                  onClick={() => navigate(`/claims/${record.id}`)}
                >
                  <td className="px-5 py-4 font-mono-data font-bold text-primary">{record.ref}</td>
                  <td className="px-5 py-4">
                    <p className="text-sm font-semibold text-on-surface">{record.requestorName}</p>
                    <p className="text-xs text-outline">{record.department}</p>
                  </td>
                  <td className="px-5 py-4 text-sm text-on-surface-variant">{record.type}</td>
                  <td className="px-5 py-4 text-sm text-on-surface-variant whitespace-nowrap">
                    {record.submittedAt ? formatDate(record.submittedAt) : '—'}
                  </td>
                  <td className="px-5 py-4 text-right font-mono-data">{formatMoney(record.claimedAmount)}</td>
                  <td className="px-5 py-4 text-right font-mono-data">{formatMoney(record.approvedAmount)}</td>
                  <td className="px-5 py-4 text-right font-mono-data">{formatMoney(record.paidAmount)}</td>
                  <td className="px-5 py-4 text-right font-mono-data font-bold">{formatMoney(record.outstandingAmount)}</td>
                  <td className="px-5 py-4 text-center"><StatusBadge status={record.status as ClaimStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {summary && summary.records.length > PAGE_SIZE && (
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
        )}
      </Card>
    </div>
  );
}

function MetricBarCard({
  title,
  data,
  dataKey,
  color,
  emptyText,
}: {
  title: string;
  data: Array<Record<string, any>>;
  dataKey: string;
  color: string;
  emptyText: string;
}) {
  return (
    <Card>
      <CardHeader className="bg-surface-container-low border-b border-outline-variant">
        <h3 className="font-headline-sm text-on-surface">{title}</h3>
      </CardHeader>
      <CardContent className="p-6 h-80">
        {data.length === 0 ? (
          <EmptyChart text={emptyText} />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
              <XAxis type="number" stroke="#565e74" fontSize={12} tickFormatter={value => formatAxisMoney(value)} />
              <YAxis type="category" dataKey="name" stroke="#565e74" fontSize={11} width={115} interval={0} />
              <Tooltip formatter={(value: any) => [formatMoney(value), 'Amount']} />
              <Bar dataKey={dataKey} fill={color} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyChart({ text }: { text: string }) {
  return <div className="h-full flex items-center justify-center text-center text-sm text-outline">{text}</div>;
}

export function FinanceAnalytics() {
  return <AdminReporting audience="finance" />;
}
