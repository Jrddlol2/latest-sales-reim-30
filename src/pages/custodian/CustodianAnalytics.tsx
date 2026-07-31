import { useMemo, useState } from 'react';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Select } from '../../components/ui/Input';
import { useAppContext } from '../../components/AppContext';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { formatMoney, formatAxisMoney } from '../../lib/money';
import { Claim, ClaimStatus, ClaimType, StatusHistory } from '../../types';
import { isCustodianProcessingClaim } from '../../lib/claimWorkflow';

const COLOR_PRIMARY = '#004ac6';
const COLOR_SECONDARY = '#565e74';

/** The status that means "the custodian is done with this one", per type --
 *  Cash Advance's final custodian action is Released (what happens to it
 *  after, via the requestor's own liquidation, isn't the custodian's step). */
function finalStatusFor(type: ClaimType): ClaimStatus {
  if (type === 'Cash Advance') return ClaimStatus.RELEASED;
  if (type === 'Liquidation') return ClaimStatus.CLOSED;
  return ClaimStatus.COMPLETED;
}

function isProcessedByCustodian(claim: Claim): boolean {
  if (claim.type === 'Cash Advance') return claim.status === ClaimStatus.RELEASED || claim.status === ClaimStatus.LIQUIDATED;
  if (claim.type === 'Liquidation') return claim.status === ClaimStatus.CLOSED;
  return claim.status === ClaimStatus.COMPLETED;
}

function finalTimestamp(claim: Claim, statusHistory: StatusHistory[]): Date | null {
  const entry = statusHistory.find(h => h.claimId === claim.id && h.newStatus === finalStatusFor(claim.type));
  const fallback = claim.releaseDate || claim.processingDate;
  return entry ? new Date(entry.timestamp) : fallback ? new Date(fallback) : null;
}

/** When the custodian's own clock started on this item -- Approved for a
 *  Reimbursement/Cash Advance (that's when it lands in their queue),
 *  Submitted for a Liquidation (nothing else gates it before review). */
function startTimestamp(claim: Claim, statusHistory: StatusHistory[]): Date | null {
  const startStatus = claim.type === 'Liquidation' ? ClaimStatus.SUBMITTED : ClaimStatus.APPROVED;
  const entry = statusHistory.find(h => h.claimId === claim.id && h.newStatus === startStatus);
  return entry ? new Date(entry.timestamp) : claim.submittedAt ? new Date(claim.submittedAt) : new Date(claim.createdAt);
}

const MONTHS_BACK = 6;

export function CustodianAnalytics() {
  const { claims, statusHistory } = useAppContext();
  const [dateRange, setDateRange] = useState<'30d' | '90d' | 'all'>('all');

  const processedClaims = useMemo(() => claims.filter(c => {
    if (!isProcessedByCustodian(c)) return false;
    if (dateRange === 'all') return true;
    const final = finalTimestamp(c, statusHistory);
    if (!final) return false;
    const days = dateRange === '30d' ? 30 : 90;
    return Date.now() - final.getTime() <= days * 24 * 60 * 60 * 1000;
  }), [claims, statusHistory, dateRange]);
  const activeQueue = claims.filter(isCustodianProcessingClaim);
  const readyForClaim = claims.filter(c => c.status === ClaimStatus.READY_FOR_CLAIM);
  const readyValue = readyForClaim.reduce((sum, c) => sum + c.total, 0);

  const totalVolume = processedClaims.reduce((sum, c) => sum + c.total, 0);

  const avgProcessingDays = useMemo(() => {
    let totalDays = 0;
    let count = 0;
    processedClaims.forEach(c => {
      const start = startTimestamp(c, statusHistory);
      const end = finalTimestamp(c, statusHistory);
      if (start && end) {
        const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
        if (days >= 0) { totalDays += days; count++; }
      }
    });
    return count > 0 ? totalDays / count : null;
  }, [processedClaims, statusHistory]);

  const volumeOverTime = useMemo(() => {
    const buckets: { key: string; label: string; amount: number; count: number }[] = [];
    const now = new Date();
    for (let i = MONTHS_BACK - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString(undefined, { month: 'short' }), amount: 0, count: 0 });
    }
    const byKey = new Map(buckets.map(b => [b.key, b]));
    processedClaims.forEach(c => {
      const end = finalTimestamp(c, statusHistory);
      if (!end) return;
      const key = `${end.getFullYear()}-${end.getMonth()}`;
      const bucket = byKey.get(key);
      if (bucket) { bucket.amount += c.total; bucket.count += 1; }
    });
    return buckets;
  }, [processedClaims, statusHistory]);

  const byType = useMemo(() => {
    const counts: Record<string, number> = { 'Reimbursement': 0, 'Cash Advance': 0, 'Liquidation': 0 };
    processedClaims.forEach(c => { counts[c.type] = (counts[c.type] || 0) + 1; });
    return Object.entries(counts).map(([name, count]) => ({ name, count })).filter(d => d.count > 0);
  }, [processedClaims]);

  const byMethod = useMemo(() => {
    const totals: Record<string, number> = {};
    processedClaims.forEach(c => {
      if (!c.paymentMethod) return;
      totals[c.paymentMethod] = (totals[c.paymentMethod] || 0) + c.total;
    });
    return Object.entries(totals).map(([name, amount]) => ({ name, amount: Number(amount.toFixed(2)) })).sort((a, b) => b.amount - a.amount);
  }, [processedClaims]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-display text-on-surface">Custodian Analytics</h1>
          <p className="text-body-md text-outline mt-1">Throughput and processing time across everything you've released or closed.</p>
        </div>
        <div className="w-full sm:w-48">
          <label className="text-xs font-semibold text-outline block mb-1">Timeframe</label>
          <Select value={dateRange} onChange={e => setDateRange(e.target.value as typeof dateRange)}>
            <option value="all">All Time</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-4">
        <Card className="p-6 bg-surface-container-low">
          <p className="text-xs font-bold uppercase tracking-wider text-outline mb-1">Total Volume Processed</p>
          <p className="font-mono-data text-2xl font-bold text-primary">{formatMoney(totalVolume)}</p>
          <p className="text-[12px] text-outline mt-1">{processedClaims.length} transactions, all time</p>
        </Card>

        <Card className="p-6 bg-surface-container-low">
          <p className="text-xs font-bold uppercase tracking-wider text-outline mb-1">Active Queue</p>
          <p className="font-mono-data text-2xl font-bold text-on-surface">{activeQueue.length}</p>
          <p className="text-[12px] text-outline mt-1">Awaiting custodian action</p>
        </Card>

        <Card className="p-6 bg-surface-container-low">
          <p className="text-xs font-bold uppercase tracking-wider text-outline mb-1">Ready / Unconfirmed</p>
          <p className="font-mono-data text-2xl font-bold text-on-surface">{formatMoney(readyValue)}</p>
          <p className="text-[12px] text-outline mt-1">{readyForClaim.length} awaiting requestor</p>
        </Card>

        <Card className="p-6 bg-surface-container-low">
          <p className="text-xs font-bold uppercase tracking-wider text-outline mb-1">Avg Processing Time</p>
          <p className="font-mono-data text-2xl font-bold text-on-surface">{avgProcessingDays === null ? '—' : `${avgProcessingDays.toFixed(1)} Day${avgProcessingDays.toFixed(1) === '1.0' ? '' : 's'}`}</p>
          <p className="text-[12px] text-outline mt-1">Approved/Submitted → Released/Closed</p>
        </Card>

        <Card className="p-6 bg-surface-container-low">
          <p className="text-xs font-bold uppercase tracking-wider text-outline mb-1">Reimbursements Completed</p>
          <p className="font-mono-data text-2xl font-bold text-on-surface">{processedClaims.filter(c => c.type === 'Reimbursement').length}</p>
          <p className="text-[12px] text-outline mt-1">All time</p>
        </Card>

        <Card className="p-6 bg-surface-container-low">
          <p className="text-xs font-bold uppercase tracking-wider text-outline mb-1">Cash Advances Released</p>
          <p className="font-mono-data text-2xl font-bold text-on-surface">{processedClaims.filter(c => c.type === 'Cash Advance').length}</p>
          <p className="text-[12px] text-outline mt-1">All time</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="lg:col-span-2">
          <CardHeader className="bg-surface-container-low border-b border-outline-variant">
            <h3 className="font-headline-sm text-on-surface">Volume Released — Last {MONTHS_BACK} Months</h3>
          </CardHeader>
          <CardContent className="p-6 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={volumeOverTime}>
                <defs>
                  <linearGradient id="custodianVolume" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#004ac6" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#004ac6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} stroke="#565e74" fontSize={12} />
                <YAxis axisLine={false} tickLine={false} stroke="#565e74" fontSize={12} tickFormatter={val => formatAxisMoney(val)} width={80} />
                <Tooltip formatter={(value: any, name: any) => name === 'amount' ? [formatMoney(value), 'Volume'] : [value, 'Transactions']} />
                <Area type="monotone" dataKey="amount" stroke={COLOR_PRIMARY} strokeWidth={2.5} fill="url(#custodianVolume)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="bg-surface-container-low border-b border-outline-variant">
            <div>
              <h3 className="font-headline-sm text-on-surface">Completed work by type</h3>
              <p className="text-xs text-outline mt-1">Transaction counts are presented on a shared scale.</p>
            </div>
          </CardHeader>
          <CardContent className="p-6 h-72">
            {byType.length === 0 ? (
              <div className="h-full flex items-center justify-center text-outline">Nothing processed yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byType} layout="vertical" margin={{ left: 8, right: 12 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} stroke="#565e74" fontSize={12} />
                  <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} stroke="#565e74" fontSize={11} width={135} />
                  <Tooltip formatter={(value: any) => [`${value} transaction${value === 1 ? '' : 's'}`, 'Completed']} />
                  <Bar dataKey="count" fill={COLOR_SECONDARY} radius={[0, 6, 6, 0]} barSize={22} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="bg-surface-container-low border-b border-outline-variant">
            <h3 className="font-headline-sm text-on-surface">By Payment / Release Method</h3>
          </CardHeader>
          <CardContent className="p-6 h-72">
            {byMethod.length === 0 ? (
              <div className="h-full flex items-center justify-center text-outline">No payment methods recorded yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byMethod} layout="vertical" margin={{ left: 8 }}>
                  <XAxis type="number" stroke="#565e74" fontSize={12} tickFormatter={val => formatAxisMoney(val)} />
                  <YAxis type="category" dataKey="name" stroke="#565e74" fontSize={12} width={110} interval={0} />
                  <Tooltip formatter={(value: any) => [formatMoney(value), 'Volume']} />
                  <Bar dataKey="amount" fill={COLOR_SECONDARY} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
