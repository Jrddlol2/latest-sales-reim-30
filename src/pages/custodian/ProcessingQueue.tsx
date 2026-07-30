import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader } from '../../components/ui/Card';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { ClaimStatus } from '../../types';
import { formatMoney } from '../../lib/money';
import { CustodianActionButtons } from '../../components/shared/CustodianActionButtons';
import { useAppContext } from '../../components/AppContext';
import { Pagination } from '../../components/ui/Pagination';

const ITEMS_PER_PAGE = 15;
const ageInDays = (date: string) => Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86400000));

export function ProcessingQueue() {
  const navigate = useNavigate();
  const { claims, users } = useAppContext();

  const [filter, setFilter] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);

  const processingClaims = claims.filter(c =>
    (c.status === ClaimStatus.APPROVED) ||
    (c.status === ClaimStatus.PROCESSING) ||
    // A Liquidation only reaches the custodian once an Approver has reviewed
    // it (Submitted -> Reviewed) and a refund is actually owed back — settled
    // or reimbursement-due liquidations are closed automatically server-side.
    (c.type === 'Liquidation' && c.status === ClaimStatus.REVIEWED && c.varianceType === 'RefundDue')
  );

  let displayedClaims = processingClaims;
  if (filter === 'Audit') displayedClaims = processingClaims.filter(c => c.status === ClaimStatus.PROCESSING);
  if (filter === 'Advances') displayedClaims = processingClaims.filter(c => c.type === 'Cash Advance');
  if (filter === 'Liquidations') displayedClaims = processingClaims.filter(c => c.type === 'Liquidation');
  displayedClaims = [...displayedClaims].sort(
    (a, b) => new Date(a.submittedAt || a.createdAt).getTime() - new Date(b.submittedAt || b.createdAt).getTime()
  );

  const totalPages = Math.ceil(displayedClaims.length / ITEMS_PER_PAGE);
  const paginatedClaims = displayedClaims.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="font-display text-display text-on-surface">Processing Queue</h1>
          <p className="text-body-md text-outline mt-1">Manage approved claims, cash advances, and liquidations.</p>
        </div>
      </div>

      <div className="flex items-center gap-3 pb-2">
        <button onClick={() => setFilter('All')} className={`px-5 py-2 rounded-full font-label-md transition-colors shadow-sm focus:ring-2 focus:ring-primary outline-none ${filter === 'All' ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-outline-variant'}`}>All Processing</button>
        <button onClick={() => setFilter('Audit')} className={`px-5 py-2 rounded-full font-label-md transition-colors shadow-sm focus:ring-2 focus:ring-primary outline-none ${filter === 'Audit' ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-outline-variant'}`}>In Audit</button>
        <button onClick={() => setFilter('Advances')} className={`px-5 py-2 rounded-full font-label-md transition-colors shadow-sm focus:ring-2 focus:ring-primary outline-none ${filter === 'Advances' ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-outline-variant'}`}>Cash Advances</button>
        <button onClick={() => setFilter('Liquidations')} className={`px-5 py-2 rounded-full font-label-md transition-colors shadow-sm focus:ring-2 focus:ring-primary outline-none ${filter === 'Liquidations' ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-outline-variant'}`}>Liquidations</button>
      </div>

      <Card>
        <CardHeader className="bg-surface-container-low/50 border-b border-outline-variant">
          <h4 className="font-headline-md text-on-surface">Disbursement Worklist</h4>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low text-outline font-label-sm uppercase tracking-wider">
              <tr>
                <th className="px-6 py-4">Requestor</th>
                <th className="px-6 py-4">Ref & Type</th>
                <th className="px-6 py-4">Aging</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {displayedClaims.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-outline">
                    <span className="material-symbols-outlined text-4xl mb-2 opacity-50">task_alt</span>
                    <p className="font-label-md">Queue is empty!</p>
                  </td>
                </tr>
              ) : paginatedClaims.map(claim => {
                const req = users.find(u => u.id === claim.requestorId) || users[0];
                return (
                  <tr key={claim.id} className={`hover:bg-primary-fixed/20 transition-colors group cursor-pointer ${claim.id === displayedClaims[0]?.id ? 'bg-tertiary-container/20' : ''}`} onClick={(e) => {
                    if (!(e.target as HTMLElement).closest('button')) {
                      navigate(`/claims/${claim.id}`);
                    }
                  }}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {req.avatarUrl ? (
                          <img src={req.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover" loading="lazy" width="40" height="40" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center font-bold text-on-secondary-container">{req.name.split(' ').map(n=>n[0]).join('')}</div>
                        )}
                        <div>
                          <p className="font-label-md text-on-surface">{req.name}</p>
                          <p className="text-body-sm text-outline">{req.department}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-label-md text-on-surface flex items-center gap-2">
                        {claim.ref}
                        {claim.flaggedHighValue && <span className="px-2 py-0.5 rounded text-[12px] uppercase font-bold bg-error-container text-error">High Value</span>}
                      </p>
                      <div className="flex items-center text-outline font-body-sm mt-0.5">
                        <span className="material-symbols-outlined text-[14px] mr-1">receipt_long</span>
                        {claim.type}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`rounded-md px-2 py-1 text-xs font-bold ${ageInDays(claim.submittedAt || claim.createdAt) >= 5 ? 'bg-error-container text-error' : 'bg-surface-container text-outline'}`}>
                        {claim.id === displayedClaims[0]?.id ? 'Oldest · ' : ''}{ageInDays(claim.submittedAt || claim.createdAt)} day(s)
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono-data text-on-surface font-bold">
                       {formatMoney(
                         claim.type === 'Liquidation'
                           ? Math.abs(claim.varianceAmount || 0)
                           : (claim.type === 'Reimbursement' || claim.type === 'Transport Reimbursement')
                             ? (claim.reimbursableAmount ?? Math.min(claim.total, 1000))
                             : claim.total
                       )}
                       {claim.type === 'Liquidation' && <span className="block text-xs font-normal text-on-surface-variant">{claim.varianceType}</span>}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <StatusBadge status={claim.status} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <CustodianActionButtons claim={claim} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
      </Card>
    </div>
  );
}

