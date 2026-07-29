import { useState } from 'react';
import { Portal } from '../../components/shared/Portal';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { ApproverActionButtons } from '../../components/shared/ApproverActionButtons';
import { CustodianActionButtons } from '../../components/shared/CustodianActionButtons';
import { useAppContext } from '../../components/AppContext';
import { useToast } from '../../components/shared/ToastContext';
import { confirmReceipt, uploadUrl, resubmitClaimFlow, DraftLineItem } from '../../lib/api';
import { UserRole, ClaimStatus, ExpenseLineItem } from '../../types';
import { formatMoney } from '../../lib/money';
import { formatDateTime } from '../../lib/date';

export function ClaimDetail() {
  const { addToast } = useToast();
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser, claims, lineItems, moms, users, statusHistory, fieldDefinitions, refresh } = useAppContext();
  const [activeReceipt, setActiveReceipt] = useState<ExpenseLineItem | null>(null);
  const [confirmingReceipt, setConfirmingReceipt] = useState(false);
  const [receiptCode, setReceiptCode] = useState('');
  const [receiptError, setReceiptError] = useState('');
  const [submittingReceipt, setSubmittingReceipt] = useState(false);
  const [revising, setRevising] = useState(false);
  const [reviseLineItems, setReviseLineItems] = useState<DraftLineItem[]>([]);
  const [submittingRevision, setSubmittingRevision] = useState(false);

  const claim = claims.find(c => c.id === id) || claims[0];
  const items = lineItems.filter(li => li.claimId === claim.id);
  const mom = moms.find(m => m.claimId === claim.id);
  const history = statusHistory.filter(h => h.claimId === claim.id).sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Only Approver can approve/reject, and only if they are not the requestor.
  // Reimbursement claims sit at Pending Approval; Cash Advances/Liquidations
  // use the server's own Submitted status for the same moment.
  const isApprover = currentUser.role === UserRole.APPROVER &&
    (claim.status === ClaimStatus.PENDING_APPROVAL || claim.status === ClaimStatus.SUBMITTED) &&
    currentUser.id !== claim.requestorId;
  // Matches ProcessingQueue's own worklist scope: the claim must actually be
  // at a step the custodian can act on (Ready for Claim has nothing left to
  // do here — that's the requestor's move via Confirm Receipt below).
  const isCustodian = currentUser.role === UserRole.CUSTODIAN &&
    (claim.status === ClaimStatus.PROCESSING || claim.status === ClaimStatus.APPROVED || claim.status === ClaimStatus.REVIEWED);
  // Only the requestor closes the loop, by quoting the code the custodian issued.
  const canConfirmReceipt = currentUser.id === claim.requestorId && claim.status === ClaimStatus.READY_FOR_CLAIM;
  // Returned is a Reimbursement-only status (PUT /api/claims/:id/resubmit is
  // specific to the `claims` table — Cash Advances/Liquidations use their own
  // ReturnedForRevision flow with different routes).
  const canResubmit = currentUser.id === claim.requestorId && claim.status === ClaimStatus.RETURNED && claim.type === 'Reimbursement';

  const openRevise = () => {
    setReviseLineItems(items.map(li => ({
      category: li.category,
      amount: li.amount,
      vendor: li.vendor,
      businessPurpose: li.businessPurpose,
      expenseDate: li.expenseDate,
      paymentMethod: li.paymentMethod,
      receiptUrl: li.receiptUrl,
    })));
    setRevising(true);
  };

  const handleResubmit = async () => {
    if (reviseLineItems.length === 0) {
      addToast('Add at least one expense line item.', 'error');
      return;
    }
    if (!mom) {
      addToast('This claim has no Minutes of Meeting to resubmit against.', 'error');
      return;
    }
    setSubmittingRevision(true);
    try {
      await resubmitClaimFlow({ claimId: claim.id, momId: mom.id, lineItems: reviseLineItems, remarks: claim.purpose });
      await refresh();
      addToast('Claim revised and resubmitted for approval.', 'success');
      setRevising(false);
    } catch (err: any) {
      addToast(err?.message || 'Could not resubmit the claim.', 'error');
    } finally {
      setSubmittingRevision(false);
    }
  };

  const handleConfirmReceipt = async () => {
    if (!receiptCode.trim()) {
      setReceiptError('Enter the release code from your custodian.');
      return;
    }
    setSubmittingReceipt(true);
    setReceiptError('');
    try {
      await confirmReceipt(claim.id, receiptCode.trim());
      await refresh();
      addToast('Receipt confirmed. Your reimbursement is complete.', 'success');
      setConfirmingReceipt(false);
      setReceiptCode('');
    } catch (err: any) {
      // The server rejects a wrong code; show its message rather than closing.
      setReceiptError(err?.message || 'Could not confirm receipt.');
    } finally {
      setSubmittingReceipt(false);
    }
  };

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500 pb-12">
      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4">
        <div className="min-w-0">
          <nav className="flex gap-2 text-on-surface-variant font-label-sm mb-2">
            <span className="cursor-pointer hover:text-primary" onClick={() => navigate(-1)}>Claims</span>
            <span>/</span>
            <span className="text-on-surface font-semibold">{claim.ref}</span>
          </nav>
          <div className="flex flex-wrap items-center gap-3">
             <h1 className="font-display text-display text-on-surface break-words">{claim.purpose}</h1>
             <StatusBadge status={claim.status} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <Button variant="outline" className="gap-2" onClick={() => window.print()}>
            <span className="material-symbols-outlined text-[18px]">print</span> Print
          </Button>
          {isApprover && <ApproverActionButtons claim={claim} size="md" />}
          {isCustodian && <CustodianActionButtons claim={claim} size="md" />}
          {canConfirmReceipt && (
            <Button className="gap-2" onClick={() => { setReceiptCode(''); setReceiptError(''); setConfirmingReceipt(true); }}>
              <span className="material-symbols-outlined text-[18px]">check_circle</span> Confirm Receipt
            </Button>
          )}
          {canResubmit && (
            <Button className="gap-2" onClick={openRevise}>
              <span className="material-symbols-outlined text-[18px]">edit_note</span> Revise &amp; Resubmit
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="col-span-12 lg:col-span-8 flex flex-col gap-8">
          {claim.customFields && Object.keys(claim.customFields).length > 0 && (
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-6">
                  <span className="material-symbols-outlined text-primary">feed</span>
                  <h3 className="font-headline-md text-on-surface">Claim Details</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {Object.entries(claim.customFields).map(([key, value]) => {
                    const fd = fieldDefinitions.find(f => f.key === key && f.entity === 'claim');
                    return (
                      <div key={key}>
                        <p className="text-label-md text-outline mb-1">{fd ? fd.label : key}</p>
                        <p className="font-body-base text-on-surface">{value}</p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {mom && (
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between gap-4 mb-6">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">summarize</span>
                    <h3 className="font-headline-md text-on-surface">Meeting Summary</h3>
                  </div>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`/moms/${mom.id}`)}>
                    <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                    {mom.fileUrl ? 'View Full Minutes & Document' : 'View Full Minutes'}
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <p className="font-label-sm text-on-surface-variant uppercase tracking-wider mb-1">Purpose</p>
                    <p className="font-body-lg text-on-surface">{mom.purposeOfMeeting || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="font-label-sm text-on-surface-variant uppercase tracking-wider mb-1">Location</p>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-error text-[18px]">location_on</span>
                      <p className="font-body-lg text-on-surface">{mom.location || 'N/A'}</p>
                    </div>
                  </div>
                  <div>
                    <p className="font-label-sm text-on-surface-variant uppercase tracking-wider mb-1">Source File</p>
                    <p className="font-body-sm text-on-surface font-semibold">{mom.fileName || 'Template Form'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {claim.type === 'Liquidation' && (
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-6">
                  <span className="material-symbols-outlined text-primary">account_balance_wallet</span>
                  <h3 className="font-headline-md text-on-surface">Liquidation Details</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                     <p className="font-label-sm text-on-surface-variant uppercase tracking-wider mb-1">Related Cash Advance</p>
                     <p className="font-mono-data text-on-surface bg-surface-container-low px-2 py-1 rounded inline-block">{claim.cashAdvanceId}</p>
                  </div>
                  <div>
                     <p className="font-label-sm text-on-surface-variant uppercase tracking-wider mb-1">Variance Amount</p>
                     <p className={`font-body-lg font-bold ${claim.varianceType === 'RefundDue' ? 'text-error' : claim.varianceType === 'ReimbursementDue' ? 'text-primary' : 'text-green-600'}`}>
                        {formatMoney(Math.abs(claim.varianceAmount || 0))}
                        <span className="block text-sm font-normal text-on-surface-variant mt-1">{claim.varianceType}</span>
                     </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <h3 className="font-headline-md text-on-surface">Expense Line Items</h3>
              <div className="bg-primary-fixed text-on-primary-fixed px-3 py-1 rounded-full font-label-md">
                Total: {formatMoney(claim.total)}
              </div>
            </CardHeader>
            <div className="overflow-x-auto hidden md:block">
              <table className="w-full text-left">
                <thead className="bg-surface-container-low">
                  <tr>
                    <th className="px-4 py-3 font-label-sm text-on-surface-variant uppercase tracking-wider">Date</th>
                    <th className="px-4 py-3 font-label-sm text-on-surface-variant uppercase tracking-wider">Category</th>
                    <th className="px-4 py-3 font-label-sm text-on-surface-variant uppercase tracking-wider">Vendor / Purpose</th>
                    <th className="px-4 py-3 font-label-sm text-on-surface-variant uppercase tracking-wider">Payment</th>
                    <th className="px-4 py-3 font-label-sm text-on-surface-variant uppercase tracking-wider text-right">Amount</th>
                    <th className="px-4 py-3 font-label-sm text-on-surface-variant uppercase tracking-wider text-center">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {items.map(item => {
                    const hasReceipt = Boolean(item.receiptUrl);
                    return (
                      <tr key={item.id} className="hover:bg-primary/5 transition-colors">
                        <td className="px-4 py-3 font-mono-data text-xs">{item.expenseDate}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            {item.category}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <p className="font-bold text-on-surface">{item.vendor || 'N/A'}</p>
                          <p className="text-on-surface-variant text-[12px]">{item.businessPurpose}</p>
                        </td>
                        <td className="px-4 py-3 text-xs text-on-surface-variant">{item.paymentMethod || 'Personal Card'}</td>
                        <td className="px-4 py-3 font-mono-data text-right font-bold text-xs">{formatMoney(item.amount)}</td>
                        <td className="px-4 py-3 text-center">
                          {hasReceipt ? (
                            <button 
                              onClick={() => setActiveReceipt(item)}
                              className="text-primary hover:text-primary-container p-1 rounded hover:bg-primary/10 transition-colors"
                              title="View Receipt Attachment"
                            >
                              <span className="material-symbols-outlined text-[20px]">attachment</span>
                            </button>
                          ) : (
                            <span className="material-symbols-outlined text-[20px] text-outline/30 cursor-not-allowed" title="No Receipt Attached">
                              attachment
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-on-surface-variant">
                        No line items found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile View */}
            <div className="md:hidden divide-y divide-outline-variant">
              {items.map(item => {
                const hasReceipt = Boolean(item.receiptUrl);
                return (
                  <div key={item.id} className="p-4 flex flex-col gap-2">
                    <div className="flex justify-between items-start">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {item.category}
                      </span>
                      <span className="font-mono-data text-xs text-outline">{item.expenseDate}</span>
                    </div>
                    <div className="flex justify-between items-end">
                      <div>
                        <p className="font-bold text-on-surface">{item.vendor || 'N/A'}</p>
                        <p className="text-on-surface-variant text-xs">{item.businessPurpose}</p>
                      </div>
                      <span className="font-mono-data font-bold">{formatMoney(item.amount)}</span>
                    </div>
                    <div className="flex justify-between items-center mt-2 pt-2 border-t border-outline-variant/30">
                      <span className="text-xs text-on-surface-variant flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">payment</span>
                        {item.paymentMethod || 'Personal Card'}
                      </span>
                      {hasReceipt ? (
                        <button 
                          onClick={() => setActiveReceipt(item)}
                          className="text-primary flex items-center gap-1 text-xs font-semibold hover:underline"
                        >
                          <span className="material-symbols-outlined text-[16px]">attachment</span>
                          View Receipt
                        </button>
                      ) : (
                        <span className="text-outline/50 flex items-center gap-1 text-xs">
                          <span className="material-symbols-outlined text-[16px]">attachment_off</span>
                          No Receipt
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {items.length === 0 && (
                <div className="p-8 text-center text-on-surface-variant">
                  No line items found.
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="col-span-12 lg:col-span-4 flex flex-col gap-8">
          {canConfirmReceipt && claim.releaseCode && (
            <Card className="border-primary/30 bg-primary-container/20">
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-primary">key</span>
                  <h3 className="font-headline-md text-on-surface">Ready for Release</h3>
                </div>
                <p className="text-body-sm text-on-surface-variant mb-4">
                  The custodian has released your payout. Enter the release code they gave you
                  (in person or by message) to confirm receipt and complete this claim.
                </p>
                <Button className="w-full gap-2" onClick={() => { setReceiptCode(''); setReceiptError(''); setConfirmingReceipt(true); }}>
                  <span className="material-symbols-outlined text-[18px]">check_circle</span> Enter Code to Confirm
                </Button>
              </CardContent>
            </Card>
          )}

          <Card className="flex-1">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-6">
                <span className="material-symbols-outlined text-primary">history</span>
                <h3 className="font-headline-md text-on-surface">History</h3>
              </div>
              <div className="relative space-y-8 before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-outline-variant">
                {history.map((h) => {
                  const user = users.find(u => u.id === h.changedBy);
                  const isSubmit = h.newStatus === ClaimStatus.SUBMITTED;
                  return (
                    <div key={h.id} className="relative flex items-start gap-4">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-4 ring-surface-container-lowest z-10 ${isSubmit ? 'bg-primary-fixed text-primary-fixed-dim' : 'bg-green-100 text-green-600'}`}>
                        <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>{isSubmit ? 'send' : 'check'}</span>
                      </div>
                      <div className="flex flex-col">
                        <p className="font-label-md text-on-surface">{user?.name || 'System User'} <span className="font-normal text-on-surface-variant">• {h.newStatus}</span></p>
                        <p className="font-body-sm text-outline">{formatDateTime(h.timestamp)}</p>
                        {h.comment && (
                          <div className="mt-2 p-3 bg-surface-container-low rounded-lg border border-outline-variant/30">
                            <p className="font-body-sm text-on-surface-variant italic">"{h.comment}"</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Receipt Preview Modal */}
      {activeReceipt && (
        <Portal>
        
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-surface-container-lowest rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-outline-variant pb-3">
              <h3 className="font-headline-sm text-on-surface">Receipt Attachment</h3>
              <button onClick={() => setActiveReceipt(null)} className="text-outline hover:text-on-surface">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-4 bg-surface-container-low rounded-lg border border-outline-variant text-center">
              {(() => {
                const url = uploadUrl(activeReceipt.receiptUrl);
                if (!url) return null;
                if (url.startsWith('blob:') || url.startsWith('data:image') || url.match(/\.(jpeg|jpg|gif|png)($|\?)/i)) {
                  return <img src={url} alt="Receipt preview" className="max-h-64 mx-auto object-contain rounded" />;
                }
                if (url.match(/\.pdf($|\?)/i)) {
                  return <iframe title="Receipt attachment" src={url} className="w-full h-64 rounded border border-outline-variant" />;
                }
                return (
                  <div className="py-8">
                    <span className="material-symbols-outlined text-[56px] text-primary mb-2">description</span>
                    <p className="font-bold text-on-surface">{activeReceipt.receiptFileName || 'Receipt_Document.pdf'}</p>
                  </div>
                );
              })()}
            </div>

            <div className="space-y-1 text-sm text-on-surface">
              <p><span className="text-outline">Vendor:</span> {activeReceipt.vendor || 'N/A'}</p>
              <p><span className="text-outline">Category:</span> {activeReceipt.category}</p>
              <p><span className="text-outline">Amount:</span> {formatMoney(activeReceipt.amount)}</p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-outline-variant">
              {activeReceipt.receiptUrl && (
                <a href={uploadUrl(activeReceipt.receiptUrl)} target="_blank" rel="noreferrer" download={activeReceipt.receiptFileName || 'receipt.pdf'}>
                  <Button variant="outline" size="sm" className="gap-1">
                    <span className="material-symbols-outlined text-[16px]">download</span> Download
                  </Button>
                </a>
              )}
              <Button size="sm" onClick={() => setActiveReceipt(null)}>Close</Button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {/* Confirm Receipt Modal — requestor closes out the payout */}
      {confirmingReceipt && (
        <Portal>
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-surface-container-lowest rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-outline-variant pb-3">
                <h3 className="font-headline-sm text-on-surface">Confirm Receipt of Funds</h3>
                <button onClick={() => setConfirmingReceipt(false)} className="text-outline hover:text-on-surface">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <p className="text-body-sm text-on-surface-variant">
                Enter the release code provided by your custodian to confirm you received the
                payout for <span className="font-semibold text-on-surface">{claim.ref}</span> ({formatMoney(claim.total)}).
                This completes your reimbursement.
              </p>

              <div>
                <input
                  autoFocus
                  value={receiptCode}
                  onChange={e => { setReceiptCode(e.target.value); setReceiptError(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') handleConfirmReceipt(); }}
                  placeholder="Release code"
                  className={`w-full bg-white border ${receiptError ? 'border-error' : 'border-[#CBD5E1]'} rounded-[6px] px-4 py-2.5 font-mono-data tracking-widest text-body-base focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none uppercase`}
                />
                {receiptError && <p className="text-error text-xs mt-1">{receiptError}</p>}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-outline-variant">
                <Button variant="ghost" onClick={() => setConfirmingReceipt(false)} disabled={submittingReceipt}>Cancel</Button>
                <Button className="gap-2" onClick={handleConfirmReceipt} disabled={submittingReceipt}>
                  {submittingReceipt ? <span className="material-symbols-outlined animate-spin text-[18px]">sync</span> : null}
                  Confirm &amp; Complete
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* Revise & Resubmit Modal — returned Reimbursements re-enter approval here */}
      {revising && (
        <Portal>
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-surface-container-lowest rounded-xl max-w-3xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center border-b border-outline-variant pb-3">
                <h3 className="font-headline-sm text-on-surface">Revise &amp; Resubmit {claim.ref}</h3>
                <button onClick={() => setRevising(false)} className="text-outline hover:text-on-surface">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              {history[0]?.comment && (
                <div className="p-3 bg-error-container/20 border border-error/20 rounded-lg">
                  <p className="text-body-sm font-medium text-error mb-1">Approver's note:</p>
                  <p className="text-body-sm text-on-surface-variant italic">"{history[0].comment}"</p>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-left min-w-[700px]">
                  <thead className="bg-brand-table-header text-on-surface-variant font-label-sm uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2">Vendor</th>
                      <th className="px-3 py-2">Purpose</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2">Receipt</th>
                      <th className="px-3 py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-border">
                    {reviseLineItems.map((item, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2">
                          <select
                            className="w-full py-1 px-2 text-xs border border-outline-variant rounded"
                            value={item.category || ''}
                            onChange={e => setReviseLineItems(p => p.map((li, i) => i === idx ? { ...li, category: e.target.value } : li))}
                          >
                            <option value="">Select Category</option>
                            <option>Meals</option>
                            <option>Travel</option>
                            <option>Supplies</option>
                            <option>Lodging</option>
                            <option>Transportation</option>
                            <option>Utilities</option>
                            <option>Entertainment</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="w-full py-1 px-2 text-xs border border-outline-variant rounded"
                            value={item.vendor || ''}
                            onChange={e => setReviseLineItems(p => p.map((li, i) => i === idx ? { ...li, vendor: e.target.value } : li))}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="w-full py-1 px-2 text-xs border border-outline-variant rounded"
                            value={item.businessPurpose || ''}
                            onChange={e => setReviseLineItems(p => p.map((li, i) => i === idx ? { ...li, businessPurpose: e.target.value } : li))}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            className="w-full py-1 px-2 text-xs text-right font-mono-data border border-outline-variant rounded"
                            value={item.amount || ''}
                            onChange={e => setReviseLineItems(p => p.map((li, i) => i === idx ? { ...li, amount: Number(e.target.value) } : li))}
                          />
                        </td>
                        <td className="px-3 py-2">
                          {item.receiptFile ? (
                            <span className="text-xs text-primary truncate max-w-[100px] inline-block">{item.receiptFile.name}</span>
                          ) : item.receiptUrl ? (
                            <span className="text-xs text-outline">Existing receipt</span>
                          ) : (
                            <span className="text-xs text-error">No receipt</span>
                          )}
                          <label className="ml-2 cursor-pointer text-xs text-primary hover:underline">
                            {item.receiptUrl || item.receiptFile ? 'Replace' : 'Attach'}
                            <input
                              type="file"
                              accept="image/*,.pdf"
                              className="hidden"
                              onChange={e => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                setReviseLineItems(p => p.map((li, i) => i === idx ? { ...li, receiptFile: file, receiptUrl: URL.createObjectURL(file) } : li));
                              }}
                            />
                          </label>
                        </td>
                        <td className="px-3 py-2">
                          <button onClick={() => setReviseLineItems(p => p.filter((_, i) => i !== idx))} className="text-error hover:opacity-70">
                            <span className="material-symbols-outlined text-[18px]">delete_outline</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={() => setReviseLineItems(p => [...p, { expenseDate: new Date().toISOString().split('T')[0], amount: 0, paymentMethod: 'Personal Card', vendor: '', category: 'Meals' }])}
              >
                <span className="material-symbols-outlined text-[16px]">add</span> Add Row
              </Button>

              <div className="flex justify-end gap-2 pt-2 border-t border-outline-variant">
                <Button variant="ghost" onClick={() => setRevising(false)} disabled={submittingRevision}>Cancel</Button>
                <Button className="gap-2" onClick={handleResubmit} disabled={submittingRevision}>
                  {submittingRevision ? <span className="material-symbols-outlined animate-spin text-[18px]">sync</span> : null}
                  Resubmit for Approval
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}

