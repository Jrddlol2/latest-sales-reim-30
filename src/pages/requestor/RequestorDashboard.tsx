import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { KPICard } from '../../components/ui/KPICard';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { LiquidationProgressCard } from '../../components/shared/LiquidationProgressCard';
import { ClaimProgressTracker } from '../../components/shared/ClaimProgressTracker';
import { useAppContext } from '../../components/AppContext';
import { ClaimStatus } from '../../types';
import { formatMoney } from '../../lib/money';
import { formatLongDate } from '../../lib/date';
import { getRequestAmountPresentation } from '../../lib/claimWorkflow';

const ACTIVE_STATUSES = [ClaimStatus.DRAFT, ClaimStatus.PENDING_APPROVAL, ClaimStatus.PROCESSING, ClaimStatus.READY_FOR_CLAIM];
const LIQUIDATION_DEADLINE_DAYS = 7; // mirrors server.ts's LIQUIDATION_DEADLINE_DAYS

export function RequestorDashboard() {
  const { currentUser, claims, users, statusHistory } = useAppContext();
  const navigate = useNavigate();

  const myClaims = claims.filter(c => c.requestorId === currentUser.id);
  const activeClaimsCount = myClaims.filter(c => ACTIVE_STATUSES.includes(c.status)).length;
  const completedClaims = myClaims.filter(c => c.status === ClaimStatus.COMPLETED);
  const totalReimbursed = completedClaims.reduce((acc, c) => acc + c.paidAmount, 0);

  const openAdvances = useMemo(
    () => myClaims.filter(c => c.type === 'Cash Advance' && c.status === ClaimStatus.RELEASED),
    [myClaims]
  );
  const unliquidatedFloat = openAdvances.reduce((acc, c) => acc + c.total, 0);
  const overdueAdvances = useMemo(
    () => openAdvances.filter(c => {
      if (!c.releaseDate) return false;
      const daysSinceRelease = (Date.now() - new Date(c.releaseDate).getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceRelease > LIQUIDATION_DEADLINE_DAYS;
    }),
    [openAdvances]
  );

  const readyForClaim = myClaims.filter(c => c.status === ClaimStatus.READY_FOR_CLAIM);
  const readyForClaimTotal = readyForClaim.reduce((acc, c) => acc + c.total, 0);

  // Most recently submitted (non-draft) claim, for the progress tracker.
  const mostRecentClaim = useMemo(() => {
    const submitted = myClaims.filter(c => c.status !== ClaimStatus.DRAFT);
    return submitted.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  }, [myClaims]);

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-display text-on-surface">Hello, {currentUser.name.split(' ')[0]}.</h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">Today is {formatLongDate(new Date())}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button className="gap-2 px-6" onClick={() => navigate('/claims/new')}>
            <span className="material-symbols-outlined text-[20px]">note_add</span>
            New Claim
          </Button>
        </div>
      </div>

      {readyForClaim.length > 0 && (
        <Card className="border-primary/30 bg-primary-container/20">
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

      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPICard
          title="Active Claims"
          value={activeClaimsCount.toString()}
          icon="pending_actions"
          iconColorClass="bg-primary-fixed text-on-primary-fixed-variant"
        />
        <KPICard
          title="Unliquidated Float"
          value={formatMoney(unliquidatedFloat)}
          icon="account_balance_wallet"
          iconColorClass="bg-secondary-container text-on-secondary-fixed-variant"
          trend={overdueAdvances.length > 0 ? `${overdueAdvances.length} Overdue` : openAdvances.length > 0 ? 'On track' : 'None outstanding'}
          trendIcon={overdueAdvances.length > 0 ? 'warning' : 'check_circle'}
          trendColorClass={overdueAdvances.length > 0 ? 'text-error' : 'text-tertiary'}
        />
        <KPICard
          title="Total Reimbursed"
          value={formatMoney(totalReimbursed)}
          icon="payments"
          iconColorClass="bg-tertiary-fixed text-on-tertiary-fixed-variant"
          trend={`${completedClaims.length} completed claim${completedClaims.length === 1 ? '' : 's'}`}
          trendIcon="check_circle"
          trendColorClass="text-[#0D9488]"
        />
      </div>

      <div className="order-1 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Requests Table */}
        <Card className="lg:col-span-2 flex flex-col">
          <CardHeader>
            <h3 className="font-headline-md text-headline-md text-on-surface">Recent Requests</h3>
            <button className="text-primary font-label-md hover:underline transition-all outline-none focus:ring-2 focus:ring-primary rounded p-1" onClick={() => navigate('/claims')}>View All</button>
          </CardHeader>
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-left">
              <thead className="bg-brand-table-header text-on-surface-variant font-label-sm uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4">ID</th>
                  <th className="px-4 py-4">Type</th>
                  <th className="px-4 py-4">Purpose</th>
                  <th className="px-4 py-4">Amounts</th>
                  <th className="px-6 py-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border font-body-base">
                {myClaims.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-outline">
                      <span className="material-symbols-outlined text-4xl mb-2 opacity-50">task_alt</span>
                      <p className="font-label-md">No claims submitted yet.</p>
                    </td>
                  </tr>
                ) : myClaims.slice(0, 5).map(claim => {
                  const amounts = getRequestAmountPresentation(claim);
                  const reimbursementTitle = amounts.reimbursementAmount !== undefined
                    ? amounts.reimbursementLabel
                    : claim.type === 'Cash Advance' ? 'Released' : 'Reimbursed';
                  return (
                  <tr key={claim.id} className="hover:bg-brand-row-hover transition-colors cursor-pointer" onClick={() => navigate(`/claims/${claim.id}`)}>
                    <td className="px-6 py-4 font-mono-data font-medium">{claim.ref}</td>
                    <td className="px-4 py-4">{claim.type}</td>
                    <td className="px-4 py-4">{claim.purpose}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="block text-[11px] text-outline">{amounts.expenseLabel}</span>
                      <span className="block font-mono-data text-sm font-semibold text-on-surface">{formatMoney(amounts.expenseAmount)}</span>
                      <span className="mt-1 block text-[11px] text-outline">{reimbursementTitle}</span>
                      <span className="block font-mono-data text-sm font-bold text-primary">{amounts.reimbursementAmount !== undefined ? formatMoney(amounts.reimbursementAmount) : amounts.reimbursementLabel === 'Pending' ? 'Pending' : '—'}</span>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={claim.status} />
                    </td>
                  </tr>
                );})}
              </tbody>
            </table>
          </div>
          
          {/* Mobile View */}
          <div className="md:hidden divide-y divide-outline-variant">
            {myClaims.length === 0 ? (
              <div className="p-8 text-center text-on-surface-variant">
                No claims found.
              </div>
            ) : myClaims.slice(0, 5).map(claim => {
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
                <div className="flex justify-between items-end gap-4 mt-1">
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    <div>
                      <span className="block text-[11px] text-outline">{amounts.expenseLabel}</span>
                      <span className="font-mono-data font-bold text-on-surface">{formatMoney(amounts.expenseAmount)}</span>
                    </div>
                    <div>
                      <span className="block text-[11px] text-outline">{reimbursementTitle}</span>
                      <span className="font-mono-data font-bold text-primary">{amounts.reimbursementAmount !== undefined ? formatMoney(amounts.reimbursementAmount) : amounts.reimbursementLabel === 'Pending' ? 'Pending' : '—'}</span>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-outline text-[18px]">chevron_right</span>
                </div>
              </div>
            );})}
          </div>
        </Card>

        {/* Side Panel */}
        <div className="flex flex-col gap-4">
          <LiquidationProgressCard claims={myClaims} />
          <ClaimProgressTracker claim={mostRecentClaim} users={users} statusHistory={statusHistory} />
        </div>
      </div>
    </div>
  );
}
