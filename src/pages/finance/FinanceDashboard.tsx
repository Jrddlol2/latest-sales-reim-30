import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { KPICard } from '../../components/ui/KPICard';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { useAppContext } from '../../components/AppContext';
import { ClaimStatus } from '../../types';
import { formatMoney } from '../../lib/money';
import { formatDate } from '../../lib/date';
import { claimTypeIcon, isFinanceVisibleClaim } from '../../lib/claimWorkflow';

export function FinanceDashboard() {
  const navigate = useNavigate();
  const { claims, users } = useAppContext();

  const financeClaims = useMemo(() => claims.filter(isFinanceVisibleClaim), [claims]);
  const inProcessing = financeClaims.filter(c =>
    c.status === ClaimStatus.APPROVED || c.status === ClaimStatus.PROCESSING
  );
  const readyForClaim = financeClaims.filter(c => c.status === ClaimStatus.READY_FOR_CLAIM);
  const completedThisMonth = useMemo(() => {
    const now = new Date();
    return financeClaims.filter(c => {
      if (![ClaimStatus.COMPLETED, ClaimStatus.RELEASED, ClaimStatus.CLOSED, ClaimStatus.LIQUIDATED].includes(c.status)) return false;
      const date = new Date(c.processingDate || c.releaseDate || c.createdAt);
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    });
  }, [financeClaims]);

  const processingValue = inProcessing.reduce((sum, c) => sum + (c.approvedAmount || 0), 0);
  const readyValue = readyForClaim.reduce((sum, c) => sum + c.paidAmount, 0);
  const recent = financeClaims
    .slice()
    .sort((a, b) => new Date(b.submittedAt || b.createdAt).getTime() - new Date(a.submittedAt || a.createdAt).getTime())
    .slice(0, 8);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <span className="font-label-sm text-primary font-bold tracking-wider uppercase">View-only</span>
          <h1 className="font-display text-display text-on-surface mt-1">Finance Overview</h1>
          <p className="text-body-md text-outline mt-1">Company-wide visibility from approval through payment and closure, without action controls.</p>
        </div>
        <Button variant="outline" className="gap-2" onClick={() => navigate('/finance/analytics')}>
          <span className="material-symbols-outlined text-[18px]">monitoring</span>
          Open Analytics
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KPICard title="Approved Records" value={financeClaims.length.toString()} icon="fact_check" iconColorClass="bg-secondary-container text-on-secondary-container" />
        <KPICard title="In Processing" value={formatMoney(processingValue)} icon="payments" iconColorClass="bg-primary-fixed text-on-primary-fixed-variant" trend={`${inProcessing.length} record${inProcessing.length === 1 ? '' : 's'}`} />
        <KPICard title="Ready for Claim" value={formatMoney(readyValue)} icon="key" iconColorClass="bg-tertiary-fixed text-on-tertiary-fixed-variant" trend={`${readyForClaim.length} awaiting confirmation`} />
        <KPICard title="Closed This Month" value={completedThisMonth.length.toString()} icon="task_alt" iconColorClass="bg-primary-container text-on-primary-container" />
      </div>

      <Card>
        <CardHeader className="bg-surface-container-low">
          <h2 className="font-headline-md text-on-surface">Recent Financial Records</h2>
          <Button size="sm" variant="ghost" onClick={() => navigate('/claims')}>View all</Button>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low text-outline font-label-sm uppercase tracking-wider">
              <tr>
                <th className="px-6 py-4">Reference</th>
                <th className="px-6 py-4">Requestor</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Submitted</th>
                <th className="px-6 py-4 text-right">Amount</th>
                <th className="px-6 py-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {recent.map(claim => {
                const requestor = users.find(u => u.id === claim.requestorId);
                return (
                  <tr key={claim.id} className="hover:bg-primary-container/5 cursor-pointer" onClick={() => navigate(`/claims/${claim.id}`)}>
                    <td className="px-6 py-4 font-mono-data font-bold text-primary">{claim.ref}</td>
                    <td className="px-6 py-4 text-sm text-on-surface">{requestor?.name || 'Unknown'}</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-2 text-sm text-on-surface-variant">
                        <span className="material-symbols-outlined text-[18px] text-primary">{claimTypeIcon(claim.type)}</span>
                        {claim.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-on-surface-variant">{formatDate(claim.submittedAt || claim.createdAt)}</td>
                    <td className="px-6 py-4 text-right font-mono-data font-bold">{formatMoney(claim.total)}</td>
                    <td className="px-6 py-4 text-center"><StatusBadge status={claim.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
