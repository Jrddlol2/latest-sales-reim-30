import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Pagination } from '../../components/ui/Pagination';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { useAppContext } from '../../components/AppContext';
import { ClaimStatus } from '../../types';
import { formatMoney } from '../../lib/money';
import { formatDate } from '../../lib/date';

export function TransactionHistory() {
  const navigate = useNavigate();
  const { claims, users, statusHistory } = useAppContext();

  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  // Show completed claims
  const completedClaims = claims.filter(c => c.status === ClaimStatus.COMPLETED);

  const completionDateFor = (claimId: string) => {
    const completedEntry = statusHistory.find(h => h.claimId === claimId && h.newStatus === ClaimStatus.COMPLETED);
    return completedEntry ? new Date(completedEntry.timestamp) : undefined;
  };

  const filteredClaims = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return completedClaims;
    return completedClaims.filter(c => {
      const req = users.find(u => u.id === c.requestorId);
      return c.ref.toLowerCase().includes(q) || (req?.name || '').toLowerCase().includes(q);
    });
  }, [completedClaims, users, search]);

  const totalPages = Math.ceil(filteredClaims.length / itemsPerPage);
  const paginatedClaims = filteredClaims.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <span className="font-label-sm text-primary font-bold tracking-wider uppercase">Custodian Tools</span>
          <h1 className="font-display text-display text-on-surface mt-1">Transaction History</h1>
        </div>
      </div>

      <Card>
        <CardHeader className="bg-surface-container-low">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center w-full gap-3">
            <h3 className="font-label-md uppercase tracking-wider text-on-surface whitespace-nowrap">Completed Disbursements</h3>
            <div className="flex items-center gap-3">
              <div className="w-64 max-w-full">
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search ref or requestor..."
                  className="py-1.5 text-sm"
                />
              </div>
              <span className="font-label-sm text-outline whitespace-nowrap">{filteredClaims.length} of {completedClaims.length}</span>
            </div>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low text-label-sm text-outline uppercase">
              <tr>
                <th className="px-6 py-4">Claim ID</th>
                <th className="px-6 py-4">Requestor</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Completion Date</th>
                <th className="px-6 py-4">Payment Method</th>
                <th className="px-6 py-4">Payment Reference</th>
                <th className="px-6 py-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {paginatedClaims.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-outline">
                    <span className="material-symbols-outlined text-4xl mb-2 opacity-50">history</span>
                    <p className="font-label-md">{completedClaims.length === 0 ? 'No completed transactions yet.' : 'No transactions match your search.'}</p>
                  </td>
                </tr>
              ) : paginatedClaims.map(claim => {
                const req = users.find(u => u.id === claim.requestorId) || users[0];
                const completedAt = completionDateFor(claim.id);
                return (
                  <tr key={claim.id} className="hover:bg-primary-container/5 transition-colors cursor-pointer" onClick={() => navigate(`/claims/${claim.id}`)}>
                    <td className="px-6 py-5 font-mono-data text-primary font-bold">{claim.ref}</td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        {req.avatarUrl ? (
                          <img src={req.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center text-xs font-semibold">{req.name.split(' ').map(n=>n[0]).join('')}</div>
                        )}
                        <div>
                          <p className="text-sm font-bold">{req.name}</p>
                          <p className="text-xs text-outline">{req.department}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5 font-mono-data text-sm font-bold">{formatMoney(claim.total)}</td>
                    <td className="px-6 py-5 text-on-surface-variant text-sm">
                      {completedAt ? formatDate(completedAt) : '—'}
                    </td>
                    <td className="px-6 py-5 text-on-surface-variant text-sm">{claim.paymentMethod || '—'}</td>
                    <td className="px-6 py-5 font-mono-data text-on-surface-variant text-sm">{claim.paymentReference || claim.releaseReference || '—'}</td>
                    <td className="px-6 py-5 text-center">
                      <StatusBadge status={claim.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
