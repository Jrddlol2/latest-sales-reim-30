import { useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { ClaimStatus, Claim } from '../../types';
import { ConfirmModal } from './ConfirmModal';
import { useAppContext } from '../AppContext';
import { useToast } from './ToastContext';

interface ApproverActionButtonsProps {
  claim: Claim;
  size?: 'sm' | 'md';
}

// Approve/Return/Reject for a claim awaiting this approver's decision. Shared
// by ApprovalQueue (row actions) and ClaimDetail (full-context review) so the
// decision rules (per-type button visibility, required reason text) live in
// exactly one place.
export function ApproverActionButtons({ claim, size = 'sm' }: ApproverActionButtonsProps) {
  const { currentUser, updateClaimStatus } = useAppContext();
  const { addToast } = useToast();

  const [activeModal, setActiveModal] = useState<'approve' | 'reject' | 'return' | null>(null);
  const [comment, setComment] = useState('');
  const [reviewMeetingDate, setReviewMeetingDate] = useState('');
  const [reviewMeetingTime, setReviewMeetingTime] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAction = (action: 'approve' | 'reject' | 'return') => {
    setComment('');
    setReviewMeetingDate('');
    setReviewMeetingTime('');
    setActiveModal(action);
  };

  const handleConfirm = async () => {
    if (!activeModal) return;
    if ((reviewMeetingDate && !reviewMeetingTime) || (!reviewMeetingDate && reviewMeetingTime)) {
      addToast('Choose both a review meeting date and time, or leave both blank.', 'error');
      return;
    }

    let newStatus: ClaimStatus;
    let toastMsg = '';
    let toastType: 'success' | 'error' | 'info' = 'success';

    switch (activeModal) {
      case 'approve':
        newStatus = ClaimStatus.APPROVED;
        toastMsg = 'Claim approved successfully.';
        break;
      case 'reject':
        newStatus = ClaimStatus.REJECTED;
        toastMsg = 'Claim rejected.';
        toastType = 'error';
        break;
      case 'return':
        newStatus = ClaimStatus.RETURNED;
        toastMsg = 'Claim returned to requestor.';
        toastType = 'info';
        break;
    }

    setIsSubmitting(true);
    try {
      await updateClaimStatus(claim.id, newStatus, currentUser.id, comment, {
        reviewMeetingDate: reviewMeetingDate || undefined,
        reviewMeetingTime: reviewMeetingTime || undefined,
      });
      addToast(toastMsg, toastType);
      setActiveModal(null);
    } catch (err: any) {
      // Routing rules (delegation expiry, stale approver, self-approval) are
      // enforced server-side; surface the refusal rather than faking success.
      addToast(err?.message || 'Could not action this claim.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isConfirmDisabled = (activeModal === 'reject' || activeModal === 'return') && comment.trim() === '';
  const reviewMeetingFields = (
    <div className="mt-4 pt-4 border-t border-outline-variant">
      <p className="font-label-md text-on-surface mb-1">Optional Review Meeting</p>
      <p className="text-body-sm text-outline mb-3">Schedule time with the requestor to discuss this decision.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-label-sm text-on-surface mb-1">Date</label>
          <Input type="date" value={reviewMeetingDate} onChange={event => setReviewMeetingDate(event.target.value)} disabled={isSubmitting} />
        </div>
        <div>
          <label className="block text-label-sm text-on-surface mb-1">Time</label>
          <Input type="time" value={reviewMeetingTime} onChange={event => setReviewMeetingTime(event.target.value)} disabled={isSubmitting} />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap" onClick={e => e.stopPropagation()}>
        <Button size={size} variant="outline" className="text-primary border-primary hover:bg-primary/10" onClick={() => handleAction('approve')}>Approve</Button>
        {/* Each entity's decision vocabulary is server-enforced and differs:
            a reimbursement claim takes Approve/Reject/Return; a Cash Advance
            has no "return to revise" concept (Approve/Reject only); a
            Liquidation has no "reject" concept once cash is already out
            with the requestor (Approve/Return only). */}
        {claim.type !== 'Cash Advance' && (
          <Button size={size} variant="outline" className="text-tertiary border-tertiary hover:bg-tertiary/10" onClick={() => handleAction('return')}>Return</Button>
        )}
        {claim.type !== 'Liquidation' && (
          <Button size={size} variant="outline" className="text-error border-error hover:bg-error/10" onClick={() => handleAction('reject')}>Reject</Button>
        )}
      </div>

      <ConfirmModal
        isOpen={activeModal === 'approve'}
        onClose={() => setActiveModal(null)}
        onConfirm={handleConfirm}
        title="Approve Claim"
        confirmLabel={isSubmitting ? "Approving..." : "Approve"}
        disabled={isSubmitting}
      >
        <p className="mb-4">Are you sure you want to approve this claim? It will be forwarded to the custodian for processing.</p>
        <div>
          <label className="block text-label-md text-on-surface mb-1">Comment (Optional)</label>
          <textarea
            className="w-full p-3 rounded-lg border border-outline-variant bg-surface text-on-surface focus:outline-primary resize-none"
            rows={3}
            placeholder="Add any notes..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={isSubmitting}
          />
        </div>
      </ConfirmModal>

      <ConfirmModal
        isOpen={activeModal === 'return'}
        onClose={() => setActiveModal(null)}
        onConfirm={handleConfirm}
        title="Return for Revision"
        confirmLabel={isSubmitting ? "Returning..." : "Return to Requestor"}
        variant="warning"
        disabled={isConfirmDisabled || isSubmitting}
      >
        <p className="mb-4">Return this claim to the requestor for corrections. They will be notified to resubmit.</p>
        <div>
          <label className="block text-label-md text-on-surface mb-1">Reason for Return <span className="text-error">*</span></label>
          <textarea
            className="w-full p-3 rounded-lg border border-outline-variant bg-surface text-on-surface focus:outline-primary resize-none"
            rows={3}
            placeholder="Please explain what needs to be fixed..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={isSubmitting}
          />
          {isConfirmDisabled && (
            <p className="text-error text-body-sm mt-1">A reason is required to return a claim.</p>
          )}
        </div>
        {reviewMeetingFields}
      </ConfirmModal>

      <ConfirmModal
        isOpen={activeModal === 'reject'}
        onClose={() => setActiveModal(null)}
        onConfirm={handleConfirm}
        title="Reject Claim"
        confirmLabel={isSubmitting ? "Rejecting..." : "Reject Claim"}
        variant="error"
        disabled={isConfirmDisabled || isSubmitting}
      >
        <p className="mb-4 text-error">Rejecting a claim is final. The requestor will have to create a new claim if they wish to try again.</p>
        <div>
          <label className="block text-label-md text-on-surface mb-1">Reason for Rejection <span className="text-error">*</span></label>
          <textarea
            className="w-full p-3 rounded-lg border border-outline-variant bg-surface text-on-surface focus:outline-primary resize-none"
            rows={3}
            placeholder="Please explain why this claim is rejected..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={isSubmitting}
          />
          {isConfirmDisabled && (
            <p className="text-error text-body-sm mt-1">A reason is required to reject a claim.</p>
          )}
        </div>
        {reviewMeetingFields}
      </ConfirmModal>
    </>
  );
}
