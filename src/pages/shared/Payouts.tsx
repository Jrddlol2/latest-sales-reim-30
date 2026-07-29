import { useState } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { formatMoney } from '../../lib/money';
import { ConfirmModal } from '../../components/shared/ConfirmModal';
import { useAppContext } from '../../components/AppContext';
import { useToast } from '../../components/shared/ToastContext';
import { confirmReceipt } from '../../lib/api';
import { ClaimStatus, Claim } from '../../types';

export function Payouts() {
  const { currentUser, claims, refresh } = useAppContext();
  const { addToast } = useToast();

  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const readyClaims = claims.filter(c => c.requestorId === currentUser.id && c.status === ClaimStatus.READY_FOR_CLAIM);
  const totalWaiting = readyClaims.reduce((acc, c) => acc + c.total, 0);

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
                <span className="font-mono-data font-bold text-2xl text-on-surface">{formatMoney(claim.total)}</span>
                {claim.paymentMethod && (
                  <span className="text-body-sm text-outline">via {claim.paymentMethod}</span>
                )}
              </div>
              {claim.releaseCode && (
                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant">
                  <span className="text-body-sm text-outline">Release code</span>
                  <span className="font-mono-data text-sm tracking-widest text-on-surface">{claim.releaseCode}</span>
                </div>
              )}
              <Button className="w-full gap-2" onClick={() => openModal(claim)}>
                <span className="material-symbols-outlined text-[18px]">key</span>
                Enter Code to Claim
              </Button>
            </Card>
          ))}
        </div>
      )}

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
