import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { KPICard } from '../../components/ui/KPICard';
import { LiquidationProgressCard } from '../../components/shared/LiquidationProgressCard';
import { ClaimProgressTracker } from '../../components/shared/ClaimProgressTracker';
import { useAppContext } from '../../components/AppContext';
import { Pagination } from '../../components/ui/Pagination';
import { ClaimStatus, UserRole } from '../../types';
import { formatMoney } from '../../lib/money';

const ACTIVE_STATUSES = [ClaimStatus.DRAFT, ClaimStatus.PENDING_APPROVAL, ClaimStatus.PROCESSING, ClaimStatus.READY_FOR_CLAIM];

export function ClaimsList() {
  const { currentUser, claims, users } = useAppContext();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  const myClaims = claims.filter(c => c.requestorId === currentUser.id);
  const isApprover = currentUser.role === UserRole.APPROVER;

  // Requestor-style summary, shown to Approvers too so "My Requests" covers
  // their own submissions in one place (they don't get a separate requestor
  // dashboard, but they submit claims like anyone else).
  const activeClaimsCount = myClaims.filter(c => ACTIVE_STATUSES.includes(c.status)).length;
  const completedClaims = myClaims.filter(c => c.status === ClaimStatus.COMPLETED);
  const totalReimbursed = completedClaims.reduce((acc, c) => acc + c.total, 0);
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
                            claim.purpose.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter ? claim.status === statusFilter : true;
      return matchesSearch && matchesStatus;
    });
  }, [myClaims, searchQuery, statusFilter]);

  const totalPages = Math.ceil(filteredClaims.length / itemsPerPage);
  const paginatedClaims = filteredClaims.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter]);


  return (
    <div className="animate-in fade-in duration-500">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h2 className="font-display text-display text-on-surface">My Requests</h2>
          <p className="text-body-md text-outline mt-1">Track your submitted claims, advances, and liquidations.</p>
        </div>
        <Button className="gap-2" onClick={() => navigate('/claims/new')}>
          <span className="material-symbols-outlined text-[20px]">add</span>
          New Claim
        </Button>
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
              trendColorClass="text-[#0D9488]"
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
        <CardHeader>
          <div className="flex gap-4 w-full">
            <div className="relative flex-1 max-w-md">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">search</span>
              <Input
                className="pl-10 py-1.5"
                placeholder="Search claims..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <Select
              className="w-48 py-1.5"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="">All Statuses</option>
              <option value="Draft">Draft</option>
              <option value="Submitted">Submitted</option>
              <option value="Pending Approval">Pending Approval</option>
              <option value="Approved">Approved</option>
              <option value="Processing">Processing</option>
              <option value="Ready for Claim">Ready for Claim</option>
              <option value="Completed">Completed</option>
              <option value="Returned for Revision">Returned</option>
              <option value="Rejected">Rejected</option>
            </Select>
          </div>
        </CardHeader>
        <div className="overflow-x-auto hidden md:block">
          <table className="w-full text-left">
            <thead className="bg-brand-table-header text-on-surface-variant font-label-sm uppercase tracking-wider">
              <tr>
                <th className="px-6 py-4">ID</th>
                <th className="px-4 py-4">Type</th>
                <th className="px-4 py-4">Purpose</th>
                <th className="px-4 py-4">Amount</th>
                <th className="px-6 py-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border font-body-base">
              {paginatedClaims.map(claim => (
                <tr key={claim.id} className="hover:bg-brand-row-hover transition-colors cursor-pointer" onClick={() => navigate(`/claims/${claim.id}`)}>
                  <td className="px-6 py-4 font-mono-data font-medium">{claim.ref}</td>
                  <td className="px-4 py-4">{claim.type}</td>
                  <td className="px-4 py-4">{claim.purpose}</td>
                  <td className="px-4 py-4 font-semibold">{formatMoney(claim.total)}</td>
                  <td className="px-6 py-4">
                    <StatusBadge status={claim.status} />
                  </td>
                </tr>
              ))}
              {filteredClaims.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-on-surface-variant">
                    No claims found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Mobile View */}
        <div className="md:hidden divide-y divide-outline-variant">
          {paginatedClaims.map(claim => (
            <div key={claim.id} className="p-4 flex flex-col gap-3 cursor-pointer hover:bg-surface-container-low transition-colors" onClick={() => navigate(`/claims/${claim.id}`)}>
              <div className="flex justify-between items-start">
                <div className="flex flex-col">
                  <span className="font-mono-data font-bold text-primary">{claim.ref}</span>
                  <span className="text-body-sm text-outline">{claim.type}</span>
                </div>
                <StatusBadge status={claim.status} />
              </div>
              <p className="text-body-base font-semibold">{claim.purpose}</p>
              <div className="flex justify-between items-center mt-1">
                <span className="font-bold text-on-surface">{formatMoney(claim.total)}</span>
                <span className="material-symbols-outlined text-outline text-[18px]">chevron_right</span>
              </div>
            </div>
          ))}
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
