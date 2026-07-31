import { useState } from 'react';
import { Button } from '../ui/Button';
import { Input, Select } from '../ui/Input';
import { ClaimStatus, Claim } from '../../types';
import { formatMoney } from '../../lib/money';
import { ConfirmModal } from './ConfirmModal';
import { useAppContext } from '../AppContext';
import { useToast } from './ToastContext';
import { decideAsCustodian, generateClaimCode } from '../../lib/api';

interface CustodianActionButtonsProps {
  claim: Claim;
  size?: 'sm' | 'md';
}

// Mark Ready / Release / Close Liquidation for a claim in the custodian's
// worklist. Shared by ProcessingQueue (row actions) and ClaimDetail (full
// line-item review) so the transition rules and required fields live in
// exactly one place.
export function CustodianActionButtons({ claim, size = 'sm' }: CustodianActionButtonsProps) {
  const { lineItems, currentUser, updateClaimStatus, refresh, paymentMethods } = useAppContext();
  const { addToast } = useToast();

  const [activeModal, setActiveModal] = useState<'markReady' | 'release' | 'closeLiq' | 'return' | 'reject' | null>(null);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentRef, setPaymentRef] = useState('');
  const [refundMethod, setRefundMethod] = useState('');
  const [refundRef, setRefundRef] = useState('');
  const [error, setError] = useState('');
  const [correctionComment, setCorrectionComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isReimbursement = claim.type === 'Reimbursement' || claim.type === 'Transport Reimbursement';

  const handleAction = (action: 'markReady' | 'release' | 'closeLiq' | 'return' | 'reject') => {
    setPaymentMethod('');
    setPaymentRef('');
    // Prefill the refund method with whatever the requestor declared at
    // submission (mapped onto claim.paymentMethod) — the custodian confirms it.
    setRefundMethod(action === 'closeLiq' ? (claim.paymentMethod || '') : '');
    setRefundRef('');
    setCorrectionComment('');
    setError('');
    setActiveModal(action);
  };

  const handleCorrectionDecision = async () => {
    if (activeModal !== 'return' && activeModal !== 'reject') return;
    if (!correctionComment.trim()) {
      setError('Explain what needs correction or why the request is being rejected.');
      return;
    }

    setIsSubmitting(true);
    try {
      await decideAsCustodian(
        claim.id,
        activeModal === 'return' ? 'Return' : 'Reject',
        correctionComment.trim(),
      );
      await refresh();
      addToast(
        activeModal === 'return' ? 'Returned to the requestor for revision.' : 'Request rejected before release.',
        'success',
      );
      setActiveModal(null);
    } catch (err: any) {
      setError(err?.message || 'The server rejected this decision.');
      addToast(err?.message || 'Decision failed.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Mint the claim code server-side and reveal it to the custodian. This is the
   * one authoritative code — the same value the requestor must quote back on the
   * Payouts page to complete the claim. The custodian conveys it to the
   * requestor out of band (in person, chat, etc.); it is never shown on the
   * requestor's own screen, which is the point of the two-party check.
   */
  const handleGenerateCode = async () => {
    setGeneratingCode(true);
    setError('');
    try {
      await generateClaimCode(claim.id);
      await refresh();
      addToast('Claim code generated — give it to the requestor.', 'success');
    } catch (err: any) {
      setError(err?.message || 'Could not generate the claim code.');
      addToast(err?.message || 'Could not generate the claim code.', 'error');
    } finally {
      setGeneratingCode(false);
    }
  };

  const handleConfirm = async () => {
    if (!activeModal) return;

    // A claim code must be generated (and handed to the requestor) before the
    // claim can be released — it's the code the requestor quotes back to confirm
    // receipt. Generating it is an explicit step in this same modal.
    if (activeModal === 'markReady' && !claim.releaseCode) {
      setError('Generate the claim code first, then give it to the requestor.');
      return;
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
        toastMsg = `Marked ready. Claim code ${claim.releaseCode} — make sure the requestor has it.`;
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
        {isReimbursement && claim.status === ClaimStatus.APPROVED && (
          <span className="text-body-sm text-outline italic self-center pr-2">Awaiting processing</span>
        )}
        {isReimbursement && claim.status === ClaimStatus.PROCESSING && (
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
        {((isReimbursement && [ClaimStatus.APPROVED, ClaimStatus.PROCESSING].includes(claim.status)) ||
          (claim.type === 'Liquidation' && claim.status === ClaimStatus.REVIEWED && claim.varianceType === 'RefundDue')) && (
          <Button size={size} variant="outline" className="text-tertiary border-tertiary/50" onClick={() => handleAction('return')}>
            Return
          </Button>
        )}
        {((isReimbursement && [ClaimStatus.APPROVED, ClaimStatus.PROCESSING].includes(claim.status)) ||
          (claim.type === 'Cash Advance' && claim.status === ClaimStatus.APPROVED)) && (
          <Button size={size} variant="outline" className="text-error border-error/50 hover:bg-error-container/20" onClick={() => handleAction('reject')}>
            Reject
          </Button>
        )}
      </div>

      <ConfirmModal
        isOpen={activeModal === 'return'}
        onClose={() => setActiveModal(null)}
        onConfirm={handleCorrectionDecision}
        title="Return to Requestor"
        confirmLabel={isSubmitting ? 'Returning...' : 'Return for Revision'}
        variant="warning"
        disabled={isSubmitting}
      >
        <div className="space-y-3">
          <p>
            Return <strong>{claim.ref}</strong> without releasing funds. The requestor will see this note and can correct the record.
          </p>
          <div>
            <label className="block text-label-md text-on-surface mb-1">Required correction <span className="text-error">*</span></label>
            <textarea
              value={correctionComment}
              onChange={event => { setCorrectionComment(event.target.value); setError(''); }}
              rows={4}
              placeholder="Describe the missing document, incorrect amount, or required correction..."
              className="w-full bg-white border border-[#CBD5E1] rounded-[6px] px-4 py-2.5 text-body-base focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none resize-y"
              disabled={isSubmitting}
            />
          </div>
          {error && <p className="text-error text-body-sm">{error}</p>}
        </div>
      </ConfirmModal>

      <ConfirmModal
        isOpen={activeModal === 'reject'}
        onClose={() => setActiveModal(null)}
        onConfirm={handleCorrectionDecision}
        title="Reject Before Release"
        confirmLabel={isSubmitting ? 'Rejecting...' : 'Reject Request'}
        variant="error"
        disabled={isSubmitting}
      >
        <div className="space-y-3">
          <p>
            Reject <strong>{claim.ref}</strong> before any funds are released. This decision and your reason will be written to the audit history.
          </p>
          <div>
            <label className="block text-label-md text-on-surface mb-1">Rejection reason <span className="text-error">*</span></label>
            <textarea
              value={correctionComment}
              onChange={event => { setCorrectionComment(event.target.value); setError(''); }}
              rows={4}
              placeholder="Explain why this request cannot proceed..."
              className="w-full bg-white border border-[#CBD5E1] rounded-[6px] px-4 py-2.5 text-body-base focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none resize-y"
              disabled={isSubmitting}
            />
          </div>
          {error && <p className="text-error text-body-sm">{error}</p>}
        </div>
      </ConfirmModal>

      <ConfirmModal
        isOpen={activeModal === 'markReady'}
        onClose={() => setActiveModal(null)}
        onConfirm={handleConfirm}
        title="Review & Mark Ready"
        confirmLabel={isSubmitting ? "Marking ready..." : "Mark Ready for Claim"}
        disabled={isSubmitting}
      >
        {(() => {
          const items = lineItems.filter(li => li.claimId === claim.id);
          return (
            <div className="space-y-4">
              <p className="text-body-sm text-on-surface-variant">
                Review the submitted expenses and receipts, generate the claim code and give
                it to the requestor, then mark the claim ready for payout.
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
              <div className="flex justify-between items-center">
                <span className="font-label-md text-on-surface-variant">Amount to Release</span>
                <span className="font-mono-data font-bold text-primary">{formatMoney(claim.approvedAmount ?? Math.min(claim.total, 1000))}</span>
              </div>
              <div>
                <label className="block text-label-md text-on-surface mb-1">Payment Method <span className="text-error">*</span></label>
                <Select value={paymentMethod} onChange={e => { setPaymentMethod(e.target.value); setError(''); }} disabled={isSubmitting}>
                  <option value="">Select a payment method...</option>
                  {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
                </Select>
              </div>
              <div>
                <label className="block text-label-md text-on-surface mb-1">Claim Code</label>
                {claim.releaseCode ? (
                  <div className="rounded-lg border border-primary/40 bg-primary-container/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono-data text-xl tracking-widest font-bold text-on-surface">{claim.releaseCode}</span>
                      <button
                        type="button"
                        onClick={handleGenerateCode}
                        disabled={generatingCode || isSubmitting}
                        className="text-body-sm text-primary hover:underline disabled:opacity-50"
                      >
                        {generatingCode ? 'Regenerating…' : 'Regenerate'}
                      </button>
                    </div>
                    <p className="text-[12px] text-on-surface-variant mt-1">
                      Give this code to the requestor — they enter it on Payouts to confirm receipt. It is not shown on their screen.
                    </p>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleGenerateCode}
                    disabled={generatingCode || isSubmitting}
                    className="w-full p-3 rounded-lg border border-dashed border-outline-variant text-primary font-label-md hover:bg-primary/5 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[18px]">key</span>
                    {generatingCode ? 'Generating…' : 'Generate Claim Code'}
                  </button>
                )}
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
          {claim.paymentMethod && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary-container/20 border border-primary/20 text-body-sm text-on-surface">
              <span className="material-symbols-outlined text-[18px] text-primary">info</span>
              Requestor said they'd refund via <strong>{claim.paymentMethod}</strong>. Confirm or change below.
            </div>
          )}
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
