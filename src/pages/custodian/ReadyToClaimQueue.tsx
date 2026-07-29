import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader } from '../../components/ui/Card';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Pagination } from '../../components/ui/Pagination';
import { ClaimStatus } from '../../types';
import { formatMoney } from '../../lib/money';
import { useAppContext } from '../../components/AppContext';

const ITEMS_PER_PAGE = 12;

export function ReadyToClaimQueue() {
  const navigate = useNavigate();
  const { claims, users } = useAppContext();
  const [currentPage, setCurrentPage] = useState(1);

  const readyClaims = claims.filter(c => c.status === ClaimStatus.READY_FOR_CLAIM);
  const totalPages = Math.ceil(readyClaims.length / ITEMS_PER_PAGE);
  const paginatedClaims = readyClaims.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-display text-on-surface">Ready to Claim</h1>
            <span className="text-[12px] font-bold uppercase tracking-wider text-outline bg-surface-container-high px-2 py-0.5 rounded-full">Read-only</span>
          </div>
          <p className="text-body-md text-outline mt-1">Prepped claims awaiting the requestor to confirm receipt with their release code.</p>
        </div>
      </div>

      <Card className="border-primary/20 bg-primary-fixed/10">
        <div className="p-4 flex items-start gap-3">
          <span className="material-symbols-outlined text-primary text-[22px]">key</span>
          <p className="text-body-sm text-on-surface-variant">
            Share each release code with its requestor. The claim completes only when
            <span className="font-semibold text-on-surface"> they </span>
            confirm receipt by entering the code — the custodian cannot finalize payout.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader className="bg-surface-container-low/50 border-b border-outline-variant">
          <h4 className="font-headline-md text-on-surface">Awaiting Confirmation ({readyClaims.length})</h4>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low text-outline font-label-sm uppercase tracking-wider">
              <tr>
                <th className="px-6 py-4">Requestor</th>
                <th className="px-6 py-4">Ref & Type</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Release Code</th>
                <th className="px-6 py-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {readyClaims.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-outline">
                    <span className="material-symbols-outlined text-4xl mb-2 opacity-50">task_alt</span>
                    <p className="font-label-md">Queue is empty!</p>
                  </td>
                </tr>
              ) : paginatedClaims.map(claim => {
                const req = users.find(u => u.id === claim.requestorId) || users[0];
                return (
                  <tr key={claim.id} className="hover:bg-primary-fixed/20 transition-colors cursor-pointer" onClick={() => navigate(`/claims/${claim.id}`)}>
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
                      <p className="font-label-md text-on-surface">{claim.ref}</p>
                      <div className="flex items-center text-outline font-body-sm mt-0.5">
                        <span className="material-symbols-outlined text-[14px] mr-1">receipt_long</span>
                        {claim.type}
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono-data text-on-surface font-bold">{formatMoney(claim.total)}</td>
                    <td className="px-6 py-4">
                      {claim.releaseCode ? (
                        <span className="font-mono-data text-sm bg-surface-container-high px-2.5 py-1 rounded tracking-widest text-on-surface">{claim.releaseCode}</span>
                      ) : (
                        <span className="text-outline text-sm">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
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
