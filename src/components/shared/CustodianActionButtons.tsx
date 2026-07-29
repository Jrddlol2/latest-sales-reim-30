import { useState } from 'react';
import { Button } from '../ui/Button';
import { Input, Select } from '../ui/Input';
import { ClaimStatus, Claim } from '../../types';
import { formatMoney } from '../../lib/money';
import { ConfirmModal } from './ConfirmModal';
import { useAppContext } from '../AppContext';
import { useToast } from './ToastContext';

interface CustodianActionButtonsProps {
  claim: Claim;
  size?: 'sm' | 'md';
}

// Mark Ready / Release / Close Liquidation for a claim in the custodian's
// worklist. Shared by ProcessingQueue (row actions) and ClaimDetail (full
// line-item review) so the transition rules and required fields live in
// exactly one place.
export function CustodianActionButtons({ claim, size = 'sm' }: CustodianActionButtonsProps) {
  const { lineItems, currentUser, updateClaimStatus, paymentMethods } = useAppContext();
  const { addToast } = useToast();

  const [activeModal, setActiveModal] = useState<'markReady' | 'release' | 'closeLiq' | null>(null);
  const [releaseCode, setReleaseCode] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentRef, setPaymentRef] = useState('');
  const [refundMethod, setRefundMethod] = useState('');
  const [refundRef, setRefundRef] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAction = (action: 'markReady' | 'release' | 'closeLiq') => {
    setReleaseCode('');
    setPaymentMethod('');
    setPaymentRef('');
    setRefundMethod('');
    setRefundRef('');
    setError('');
    setActiveModal(action);
  };

  const handleConfirm = async () => {
    if (!activeModal) return;

    // The code is only something to verify once one has been issued. A claim
    // that has never had one gets it minted server-side on mark-ready, so
    // demanding it up front would make the step unreachable.
    if (activeModal === 'markReady' && claim.releaseCode) {
      if (releaseCode !== claim.releaseCode) {
        setError('Invalid release code. Please verify the code provided by Finance Audit.');
        return;
      }
    }
    if (activeModal === 'markReady' && !paymentMethod) {
      setError('Select a payment method.');
      return;
    }
    if (activeModal === 'release' && !paymentMethod) {
      setError('Select a release method.');
      return;
    }
    if (activeModal === 'closeLiq' && !refundMethod) {
      setError('Select a refund method.');
      return;
    }

    let newStatus: string = claim.status;
    let toastMsg = '';
    let updates: Partial<Claim> = {};

    switch (activeModal) {
      case 'markReady':
        newStatus = ClaimStatus.READY_FOR_CLAIM;
        toastMsg = 'Claim marked ready for payout.';
        updates = { paymentMethod };
        break;
      case 'release':
        newStatus = ClaimStatus.RELEASED;
        toastMsg = 'Cash advance released successfully.';
        updates = { releaseReference: paymentRef || undefined, paymentMethod };
        break;
      case 'closeLiq':
        newStatus = ClaimStatus.CLOSED;
        toastMsg = 'Liquidation closed.';
        updates = { releaseReference: refundRef || undefined, paymentMethod: refundMethod };
        break;
    }

    setIsSubmitting(true);
    try {
      await updateClaimStatus(claim.id, newStatus as ClaimStatus, currentUser.id, undefined, updates);
      addToast(toastMsg, 'success');
      setActiveModal(null);
    } catch (err: any) {
      // The server owns these transitions — report what it actually said
      // instead of claiming success and leaving the row unchanged.
      setError(err?.message || 'The server rejected this action.');
      addToast(err?.message || 'Action failed.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap" onClick={e => e.stopPropagation()}>
        {claim.type === 'Reimbursement' && claim.status === ClaimStatus.APPROVED && (
          <span className="text-body-sm text-outline italic self-center pr-2">Awaiting processing</span>
        )}
        {claim.type === 'Reimbursement' && claim.status === ClaimStatus.PROCESSING && (
          <Button size={size} className="gap-1.5" onClick={() => handleAction('markReady')}>
            <span className="material-symbols-outlined text-[16px]">fact_check</span> Review
          </Button>
        )}
        {claim.type === 'Cash Advance' && claim.status === ClaimStatus.APPROVED && (
          <Button size={size} onClick={() => handleAction('release')}>Release Funds</Button>
        )}
        {claim.type === 'Liquidation' && claim.status === ClaimStatus.REVIEWED && claim.varianceType === 'RefundDue' && (
          <Button size={size} onClick={() => handleAction('closeLiq')}>Close Liquidation</Button>
        )}
      </div>

      <ConfirmModal
        isOpen={activeModal === 'markReady'}
        onClose={() => setActiveModal(null)}
        onConfirm={handleConfirm}
        title="Review & Mark Ready"
        confirmLabel={isSubmitting ? "Verifying..." : "Verify & Mark Ready"}
        disabled={isSubmitting}
      >
        {(() => {
          const items = lineItems.filter(li => li.claimId === claim.id);
          return (
            <div className="space-y-4">
              <p className="text-body-sm text-on-surface-variant">
                Review the submitted expenses and receipts, then verify the release code
                generated when this claim entered processing.
              </p>
              {items.length === 0 ? (
                <p className="text-body-sm text-outline italic">No expense line items found for this claim.</p>
              ) : (
                <div className="border border-outline-variant rounded-lg overflow-hidden max-h-56 overflow-y-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-surface-container-low text-outline font-label-sm uppercase sticky top-0">
                      <tr>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Category / Vendor</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2 text-center">Receipt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant">
                      {items.map(item => (
                        <tr key={item.id}>
                          <td className="px-3 py-2 whitespace-nowrap">{item.expenseDate}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-on-surface">{item.category}</div>
                            <div className="text-outline text-xs">{item.vendor}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono-data">{formatMoney(item.amount)}</td>
                          <td className="px-3 py-2 text-center">
                            {item.receiptUrl ? (
                              <a
                                href={item.receiptUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary hover:underline"
                                onClick={e => e.stopPropagation()}
                              >
                                View
                              </a>
                            ) : (
                              <span className="text-error text-xs">Missing</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex justify-between items-center pt-2 border-t border-outline-variant">
                <span className="font-label-md text-on-surface-variant">Claim Total</span>
                <span className="font-mono-data font-bold text-on-surface">{formatMoney(claim.total)}</span>
              </div>
              <div>
                <label className="block text-label-md text-on-surface mb-1">Payment Method <span className="text-error">*</span></label>
                <Select value={paymentMethod} onChange={e => { setPaymentMethod(e.target.value); setError(''); }} disabled={isSubmitting}>
                  <option value="">Select a payment method...</option>
                  {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
                </Select>
              </div>
              <div>
                <label className="block text-label-md text-on-surface mb-1">Release Code</label>
                <input
                  type="text"
                  className="w-full p-3 rounded-lg border border-outline-variant bg-surface text-on-surface font-mono-data uppercase focus:outline-primary"
                  placeholder="e.g. RC-12345"
                  value={releaseCode}
                  onChange={(e) => {
                    setReleaseCode(e.target.value.toUpperCase());
                    setError('');
                  }}
                  disabled={isSubmitting}
                />
                {error && <p className="text-error text-body-sm mt-2 flex items-center"><span className="material-symbols-outlined text-[16px] mr-1">error</span>{error}</p>}
              </div>
            </div>
          );
        })()}
      </ConfirmModal>

      <ConfirmModal
        isOpen={activeModal === 'release'}
        onClose={() => setActiveModal(null)}
        onConfirm={handleConfirm}
        title="Release Cash Advance"
        confirmLabel={isSubmitting ? "Releasing..." : "Confirm Release"}
        disabled={isSubmitting}
      >
        <p className="mb-4 text-body-md text-on-surface-variant">Select how these funds are being released and enter a reference number.</p>
        <div className="space-y-4">
          <div>
            <label className="block text-label-md text-on-surface mb-1">Release Method <span className="text-error">*</span></label>
            <Select value={paymentMethod} onChange={e => { setPaymentMethod(e.target.value); setError(''); }} disabled={isSubmitting}>
              <option value="">Select a release method...</option>
              {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
            </Select>
          </div>
          <div>
            <label className="block text-label-md text-on-surface mb-1">Reference Number</label>
            <Input type="text" placeholder="Reference Number" value={paymentRef} onChange={e => setPaymentRef(e.target.value)} disabled={isSubmitting} />
          </div>
          {error && <p className="text-error text-body-sm flex items-center"><span className="material-symbols-outlined text-[16px] mr-1">error</span>{error}</p>}
        </div>
      </ConfirmModal>

      <ConfirmModal
        isOpen={activeModal === 'closeLiq'}
        onClose={() => setActiveModal(null)}
        onConfirm={handleConfirm}
        title="Close Liquidation"
        confirmLabel={isSubmitting ? "Closing..." : "Close Liquidation"}
        disabled={isSubmitting}
      >
        <p className="mb-4 text-body-md text-on-surface-variant">Confirm the refund of {formatMoney(Math.abs(claim.varianceAmount || 0))} has been physically collected from the requestor, then close this liquidation.</p>
        <div className="space-y-4">
          <div>
            <label className="block text-label-md text-on-surface mb-1">Refund Method <span className="text-error">*</span></label>
            <Select value={refundMethod} onChange={e => { setRefundMethod(e.target.value); setError(''); }} disabled={isSubmitting}>
              <option value="">Select how the refund was collected...</option>
              {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
            </Select>
          </div>
          <div>
            <label className="block text-label-md text-on-surface mb-1">Reference Note (Optional)</label>
            <Input type="text" placeholder="Reference note (optional)" value={refundRef} onChange={e => setRefundRef(e.target.value)} disabled={isSubmitting} />
          </div>
          {error && <p className="text-error text-body-sm flex items-center"><span className="material-symbols-outlined text-[16px] mr-1">error</span>{error}</p>}
        </div>
      </ConfirmModal>
    </>
  );
}
