import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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
import { CHART_ANIMATION_PROPS, CHART_AXIS_PROPS, CHART_COLORS, CHART_GRID_PROPS, calculatePercentChange } from '../../lib/chartTheme';
import { ChartEmptyState, ChartLegend, ChartTooltip, MetricSkeleton, TrendBadge, formatCompactChartValue } from '../../components/shared/ChartPrimitives';

const PAGE_SIZE = 20;

const STATUS_COLOR: Partial<Record<ClaimStatus, string>> = {
  [ClaimStatus.DRAFT]: CHART_COLORS.muted,
  [ClaimStatus.SUBMITTED]: CHART_COLORS.secondary,
  [ClaimStatus.PENDING_APPROVAL]: CHART_COLORS.secondary,
  [ClaimStatus.APPROVED]: CHART_COLORS.primary,
  [ClaimStatus.PROCESSING]: CHART_COLORS.primary,
  [ClaimStatus.READY_FOR_CLAIM]: CHART_COLORS.primary,
  [ClaimStatus.RELEASED]: CHART_COLORS.primary,
  [ClaimStatus.REVIEWED]: CHART_COLORS.primary,
  [ClaimStatus.COMPLETED]: CHART_COLORS.success,
  [ClaimStatus.LIQUIDATED]: CHART_COLORS.success,
  [ClaimStatus.CLOSED]: CHART_COLORS.success,
  [ClaimStatus.RETURNED]: CHART_COLORS.tertiary,
  [ClaimStatus.REJECTED]: CHART_COLORS.error,
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
  const categoryData = (summary?.breakdowns.byCategory || []).slice(0, 8);
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
  const currentMonth = monthlyMovement.at(-1) || { claimed: 0, paid: 0 };
  const previousMonth = monthlyMovement.at(-2) || { claimed: 0, paid: 0 };
  const claimedChange = calculatePercentChange(currentMonth.claimed, previousMonth.claimed);
  const paidChange = calculatePercentChange(currentMonth.paid, previousMonth.paid);

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
          <p className="font-mono-data text-2xl font-bold text-on-surface">{loading ? <MetricSkeleton label="Loading claimed amount" /> : formatMoney(metrics?.claimedAmount || 0)}</p>
          <p className="text-[12px] text-outline mt-1">{metrics?.recordCount || 0} filtered records</p>
        </Card>
        <Card className="p-6 bg-surface-container-low">
          <p className="text-xs font-bold uppercase tracking-wider text-outline mb-1">Approved / Reviewed</p>
          <p className="font-mono-data text-2xl font-bold text-primary">{loading ? <MetricSkeleton label="Loading approved amount" /> : formatMoney(metrics?.approvedAmount || 0)}</p>
          <p className="text-[12px] text-outline mt-1">Accepted for processing</p>
        </Card>
        <Card className="p-6 bg-surface-container-low">
          <p className="text-xs font-bold uppercase tracking-wider text-outline mb-1">Paid / Released</p>
          <p className="font-mono-data text-2xl font-bold text-tertiary">{loading ? <MetricSkeleton label="Loading paid amount" /> : formatMoney(metrics?.paidAmount || 0)}</p>
          <p className="text-[12px] text-outline mt-1">Actual company cash movement</p>
        </Card>
        <Card className="p-6 bg-surface-container-low">
          <p className="text-xs font-bold uppercase tracking-wider text-outline mb-1">Outstanding</p>
          <p className="font-mono-data text-2xl font-bold text-on-surface">{loading ? <MetricSkeleton label="Loading outstanding amount" /> : formatMoney(metrics?.outstandingAmount || 0)}</p>
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
              {audience === 'finance' ? 'Monthly obligations and releases' : 'Monthly claimed and paid'}
            </h3>
            <p className="text-xs text-outline mt-1">
              {audience === 'finance'
                ? 'Compare reported obligations with actual cash released during the last six months.'
                : 'Track demand entering the system against value successfully paid out.'}
            </p>
          </div>
          <div className="hidden flex-col items-end gap-1.5 lg:flex">
            <TrendBadge value={claimedChange} context="claimed vs prior month" />
            <TrendBadge value={paidChange} context="paid vs prior month" />
          </div>
        </CardHeader>
        <CardContent className="p-6 h-80">
          <div className="h-full" role="img" aria-label={`Six-month claimed and paid movement. Latest claimed ${formatMoney(currentMonth.claimed)} and paid ${formatMoney(currentMonth.paid)}.`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyMovement} margin={{ top: 8, right: 8, left: 4, bottom: 8 }} accessibilityLayer>
              <CartesianGrid {...CHART_GRID_PROPS} vertical={false} />
              <XAxis dataKey="month" {...CHART_AXIS_PROPS} />
              <YAxis {...CHART_AXIS_PROPS} tickFormatter={formatAxisMoney} width={72} />
              <Tooltip content={<ChartTooltip labels={{ claimed: 'Claimed', paid: 'Paid' }} valueTypes={{ claimed: 'currency', paid: 'currency' }} />} />
              <Legend verticalAlign="bottom" content={<ChartLegend />} />
              <Bar dataKey="claimed" name="Claimed" fill={CHART_COLORS.primary} radius={[5, 5, 0, 0]} maxBarSize={34} {...CHART_ANIMATION_PROPS} />
              <Bar dataKey="paid" name="Paid" fill={CHART_COLORS.success} radius={[5, 5, 0, 0]} maxBarSize={34} {...CHART_ANIMATION_PROPS} />
            </BarChart>
          </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <MetricBarCard
          title={audience === 'finance' ? 'Expense exposure by category' : 'Reported expenses by category'}
          data={categoryData}
          dataKey="amount"
          color={CHART_COLORS.primary}
          emptyText="No expense lines match these filters."
        />
        <MetricBarCard
          title={audience === 'finance' ? 'Obligations by department' : 'Adoption and value by department'}
          data={departmentData}
          dataKey="claimedAmount"
          color={CHART_COLORS.secondary}
          emptyText="No department activity matches these filters."
        />
        <MetricBarCard
          title={audience === 'finance' ? 'Highest-value requestors' : 'Top requestors by claimed value'}
          data={requestorData}
          dataKey="claimedAmount"
          color={CHART_COLORS.tertiary}
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
              <ChartEmptyState message="No statuses match the current filters." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusData} layout="vertical" margin={{ left: 8, right: 40 }} accessibilityLayer>
                  <XAxis type="number" {...CHART_AXIS_PROPS} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" {...CHART_AXIS_PROPS} fontSize={11} width={115} interval={0} />
                  <Tooltip content={<ChartTooltip labels={{ count: 'Records' }} valueTypes={{ count: 'count' }} defaultValueType="count" />} />
                  <Bar dataKey="count" name="Records" radius={[0, 4, 4, 0]} {...CHART_ANIMATION_PROPS}>
                    {statusData.map(entry => (
                      <Cell key={entry.name} fill={STATUS_COLOR[entry.name as ClaimStatus] || CHART_COLORS.muted} />
                    ))}
                    {statusData.length <= 8 && <LabelList dataKey="count" position="right" formatter={value => formatCompactChartValue(value, 'count')} className="fill-on-surface font-mono-data text-[11px]" />}
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
          <ChartEmptyState message={emptyText} />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 68 }} accessibilityLayer>
              <XAxis type="number" {...CHART_AXIS_PROPS} tickFormatter={formatAxisMoney} />
              <YAxis type="category" dataKey="name" {...CHART_AXIS_PROPS} fontSize={11} width={115} interval={0} />
              <Tooltip content={<ChartTooltip labels={{ [dataKey]: 'Amount' }} valueTypes={{ [dataKey]: 'currency' }} />} />
              <Bar dataKey={dataKey} name="Amount" fill={color} radius={[0, 4, 4, 0]} {...CHART_ANIMATION_PROPS}>
                {data.length <= 8 && <LabelList dataKey={dataKey} position="right" formatter={value => formatCompactChartValue(value, 'currency')} className="fill-on-surface font-mono-data text-[11px]" />}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export function FinanceAnalytics() {
  return <AdminReporting audience="finance" />;
}
