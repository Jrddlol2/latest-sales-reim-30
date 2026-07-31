import { useState, useMemo, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Pagination } from '../../components/ui/Pagination';
import { formatMoney } from '../../lib/money';
import { formatDate } from '../../lib/date';
import { ConfirmModal } from '../../components/shared/ConfirmModal';
import { useAppContext } from '../../components/AppContext';
import { useToast } from '../../components/shared/ToastContext';
import { confirmReceipt } from '../../lib/api';
import { ClaimStatus, Claim } from '../../types';

const PAYOUT_HISTORY_PAGE_SIZE = 10;

export function Payouts() {
  const { currentUser, claims, statusHistory, refresh } = useAppContext();
  const { addToast } = useToast();

  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);

  const readyClaims = claims.filter(c => c.requestorId === currentUser.id && c.status === ClaimStatus.READY_FOR_CLAIM);
  const totalWaiting = readyClaims.reduce((acc, c) => acc + (c.approvedAmount ?? Math.min(c.total, 1000)), 0);

  // Completion date comes from the claim's own history — the COMPLETED entry
  // is when the requestor confirmed receipt — falling back to the processing
  // date if (somehow) no history row exists.
  const completedOn = (claim: Claim): string | undefined => {
    const entry = statusHistory
      .filter(h => h.claimId === claim.id && h.newStatus === ClaimStatus.COMPLETED)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
    return entry?.timestamp || claim.processingDate;
  };

  // Everything this requestor has already claimed — the record of where money
  // went, newest first.
  const completedPayouts = useMemo(() => {
    return claims
      .filter(c => c.requestorId === currentUser.id && c.status === ClaimStatus.COMPLETED)
      .map(c => ({ claim: c, date: completedOn(c) }))
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claims, statusHistory, currentUser.id]);

  const totalReceived = completedPayouts.reduce((acc, p) => acc + p.claim.paidAmount, 0);
  const thisYear = new Date().getFullYear();
  const totalThisYear = completedPayouts
    .filter(p => p.date && new Date(p.date).getFullYear() === thisYear)
    .reduce((acc, p) => acc + p.claim.paidAmount, 0);

  const historyTotalPages = Math.max(1, Math.ceil(completedPayouts.length / PAYOUT_HISTORY_PAGE_SIZE));
  const paginatedPayouts = completedPayouts.slice(
    (historyPage - 1) * PAYOUT_HISTORY_PAGE_SIZE,
    historyPage * PAYOUT_HISTORY_PAGE_SIZE
  );

  // Reset to page 1 whenever the underlying set of payouts changes (e.g. a
  // new claim completes), so the page number never points past the end.
  useEffect(() => { setHistoryPage(1); }, [completedPayouts.length]);

  const openModal = (claim: Claim) => {
    setSelectedClaim(claim);
    setCode('');
    setError('');
  };

  const handleConfirm = async () => {
    if (!selectedClaim) return;
    if (!code.trim()) {
      setError('Enter the release code from your custodian.');
      return;
    }
    setIsSubmitting(true);
    try {
      await confirmReceipt(selectedClaim.id, code.trim());
      await refresh();
      addToast('Receipt confirmed — claim completed.', 'success');
      setSelectedClaim(null);
      setCode('');
    } catch (err: any) {
      setError(err?.message || 'Could not confirm receipt. Check the code and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="font-display text-display text-on-surface">Payouts</h1>
        <p className="text-body-md text-outline mt-1">
          Claims the custodian has released — enter your release code to confirm receipt and complete them.
        </p>
      </div>

      {readyClaims.length > 0 && (
        <Card className="border-primary/30 bg-primary-container/20">
          <div className="p-4 flex items-center gap-3">
            <span className="material-symbols-outlined text-primary text-[28px]">payments</span>
            <p className="font-label-md text-on-surface">
              {readyClaims.length} payout{readyClaims.length === 1 ? '' : 's'} waiting — {formatMoney(totalWaiting)} total
            </p>
          </div>
        </Card>
      )}

      {readyClaims.length === 0 ? (
        <Card className="p-12 text-center text-outline">
          <span className="material-symbols-outlined text-[48px] mb-3">task_alt</span>
          <p className="font-headline-sm text-on-surface mb-1">Nothing waiting</p>
          <p className="text-sm">You're all clear — no payouts pending confirmation right now.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {readyClaims.map(claim => (
            <Card key={claim.id} className="p-5 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono-data text-primary font-bold">{claim.ref}</p>
                  <p className="text-body-sm text-outline mt-0.5">{claim.purpose}</p>
                </div>
                <span className="px-2 py-1 rounded-md text-[12px] uppercase font-bold bg-primary-container text-on-primary-container whitespace-nowrap">
                  {claim.type}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <div>
                  <span className="font-mono-data font-bold text-2xl text-on-surface">{formatMoney(claim.approvedAmount ?? Math.min(claim.total, 1000))}</span>
                  {claim.total > 1000 && <p className="text-xs text-outline">Claimed {formatMoney(claim.total)}</p>}
                </div>
                {claim.paymentMethod && (
                  <span className="text-body-sm text-outline">via {claim.paymentMethod}</span>
                )}
              </div>
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant text-outline">
                <span className="material-symbols-outlined text-[18px]">lock</span>
                <span className="text-body-sm">Enter the release code your custodian gave you to confirm receipt.</span>
              </div>
              <Button className="w-full gap-2" onClick={() => openModal(claim)}>
                <span className="material-symbols-outlined text-[18px]">key</span>
                Enter Code to Claim
              </Button>
            </Card>
          ))}
        </div>
      )}

      {/* Payout history — a record of what's already been claimed, so a
          completed payout isn't just gone from the page with no trace. */}
      <div className="pt-2">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-headline-md text-on-surface">Payout History</h2>
          <span className="text-body-sm text-outline">{completedPayouts.length} completed</span>
        </div>

        {completedPayouts.length === 0 ? (
          <Card className="p-8 text-center text-outline">
            <span className="material-symbols-outlined text-[36px] mb-2">receipt_long</span>
            <p className="text-body-sm">No completed payouts yet. Confirmed claims will show up here.</p>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
              <Card className="p-4">
                <p className="font-label-sm text-outline uppercase tracking-wider mb-1">Total Received</p>
                <p className="font-mono-data font-bold text-2xl text-on-surface">{formatMoney(totalReceived)}</p>
              </Card>
              <Card className="p-4">
                <p className="font-label-sm text-outline uppercase tracking-wider mb-1">Received in {thisYear}</p>
                <p className="font-mono-data font-bold text-2xl text-on-surface">{formatMoney(totalThisYear)}</p>
              </Card>
              <Card className="p-4">
                <p className="font-label-sm text-outline uppercase tracking-wider mb-1">Payouts Completed</p>
                <p className="font-mono-data font-bold text-2xl text-on-surface">{completedPayouts.length}</p>
              </Card>
            </div>

            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-surface-container-low text-outline font-label-sm uppercase tracking-wider">
                    <tr>
                      <th className="px-5 py-3">Reference</th>
                      <th className="px-5 py-3">Purpose</th>
                      <th className="px-5 py-3 text-right">Amount</th>
                      <th className="px-5 py-3">Method</th>
                      <th className="px-5 py-3">Release Code</th>
                      <th className="px-5 py-3">Date Submitted</th>
                      <th className="px-5 py-3">Date Completed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {paginatedPayouts.map(({ claim, date }) => (
                      <tr key={claim.id} className="hover:bg-surface-container-low/50 transition-colors">
                        <td className="px-5 py-3 font-mono-data text-primary font-bold whitespace-nowrap">{claim.ref}</td>
                        <td className="px-5 py-3 text-body-sm text-on-surface max-w-[220px] truncate" title={claim.purpose}>{claim.purpose}</td>
                        <td className="px-5 py-3 font-mono-data font-bold text-on-surface text-right whitespace-nowrap">{formatMoney(claim.paidAmount)}</td>
                        <td className="px-5 py-3 text-body-sm text-on-surface-variant whitespace-nowrap">{claim.paymentMethod || '—'}</td>
                        <td className="px-5 py-3 font-mono-data text-body-sm text-on-surface-variant whitespace-nowrap">{claim.releaseCode || '—'}</td>
                        <td className="px-5 py-3 text-body-sm text-on-surface-variant whitespace-nowrap">{formatDate(claim.submittedAt || claim.createdAt)}</td>
                        <td className="px-5 py-3 text-body-sm text-on-surface-variant whitespace-nowrap">{date ? formatDate(date) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination currentPage={historyPage} totalPages={historyTotalPages} onPageChange={setHistoryPage} />
            </Card>
          </>
        )}
      </div>

      <ConfirmModal
        isOpen={!!selectedClaim}
        onClose={() => setSelectedClaim(null)}
        onConfirm={handleConfirm}
        title="Confirm Receipt"
        confirmLabel={isSubmitting ? 'Confirming...' : 'Confirm Receipt'}
        disabled={isSubmitting}
      >
        <p className="mb-4 text-body-md text-on-surface-variant">
          Enter the release code your custodian gave you for {selectedClaim?.ref}. This confirms you received the
          {selectedClaim?.paymentMethod ? ` ${selectedClaim.paymentMethod} ` : ' '}payout and completes the claim.
        </p>
        <input
          type="text"
          className="w-full p-3 rounded-lg border border-outline-variant bg-surface text-on-surface font-mono-data uppercase focus:outline-primary"
          placeholder="e.g. RC-12345"
          value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(''); }}
          disabled={isSubmitting}
        />
        {error && <p className="text-error text-body-sm mt-2 flex items-center"><span className="material-symbols-outlined text-[16px] mr-1">error</span>{error}</p>}
      </ConfirmModal>
    </div>
  );
}
