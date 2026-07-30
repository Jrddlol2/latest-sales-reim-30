import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../ui/Card';
import { Claim, ClaimStatus, ClaimType, User } from '../../types';

const STAGE_FLOWS: Record<ClaimType, ClaimStatus[]> = {
  'Reimbursement': [ClaimStatus.PENDING_APPROVAL, ClaimStatus.APPROVED, ClaimStatus.PROCESSING, ClaimStatus.READY_FOR_CLAIM, ClaimStatus.COMPLETED],
  'Transport Reimbursement': [ClaimStatus.PENDING_APPROVAL, ClaimStatus.APPROVED, ClaimStatus.PROCESSING, ClaimStatus.READY_FOR_CLAIM, ClaimStatus.COMPLETED],
  'Cash Advance': [ClaimStatus.SUBMITTED, ClaimStatus.APPROVED, ClaimStatus.RELEASED, ClaimStatus.LIQUIDATED],
  'Liquidation': [ClaimStatus.SUBMITTED, ClaimStatus.REVIEWED, ClaimStatus.CLOSED],
};

const STAGE_LABELS: Partial<Record<ClaimStatus, string>> = {
  [ClaimStatus.PENDING_APPROVAL]: 'Submitted',
  [ClaimStatus.SUBMITTED]: 'Submitted',
  [ClaimStatus.APPROVED]: 'Approved',
  [ClaimStatus.PROCESSING]: 'Processing',
  [ClaimStatus.READY_FOR_CLAIM]: 'Ready for Claim',
  [ClaimStatus.COMPLETED]: 'Completed',
  [ClaimStatus.RELEASED]: 'Released',
  [ClaimStatus.LIQUIDATED]: 'Liquidated',
  [ClaimStatus.REVIEWED]: 'Reviewed',
  [ClaimStatus.CLOSED]: 'Closed',
};

const BRANCH_STATUSES = [ClaimStatus.REJECTED, ClaimStatus.RETURNED];

function currentlyWith(claim: Claim, users: User[]): string {
  const approverName = users.find(u => u.id === claim.approverId)?.name;
  switch (claim.status) {
    case ClaimStatus.DRAFT:
      return 'You — not yet submitted';
    case ClaimStatus.PENDING_APPROVAL:
    case ClaimStatus.SUBMITTED:
      return approverName ? `Awaiting ${approverName}` : 'Awaiting approver';
    case ClaimStatus.APPROVED:
    case ClaimStatus.PROCESSING:
    case ClaimStatus.REVIEWED:
      return 'Finance / Custodian';
    case ClaimStatus.READY_FOR_CLAIM:
      return 'Awaiting requestor confirmation';
    case ClaimStatus.RELEASED:
      return 'Awaiting liquidation';
    case ClaimStatus.COMPLETED:
    case ClaimStatus.LIQUIDATED:
    case ClaimStatus.CLOSED:
      return 'Done';
    case ClaimStatus.REJECTED:
      return 'Rejected — no further action';
    case ClaimStatus.RETURNED:
      return `Returned to you${approverName ? ` by ${approverName}` : ''} for revision`;
    default:
      return '—';
  }
}

/** The most recent claim's lifecycle at a glance: which stages are done,
 *  which is current, and whose court the ball is in right now. Shared
 *  between the Requestor dashboard and the Approver's "My Requests" (both
 *  show "your own" claims the same way). */
export function ClaimProgressTracker({ claim, users }: { claim: Claim | undefined; users: User[] }) {
  const navigate = useNavigate();

  if (!claim) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-outline">
          <span className="material-symbols-outlined text-3xl mb-2 opacity-50">timeline</span>
          <p className="text-sm">No claims yet to track.</p>
        </CardContent>
      </Card>
    );
  }

  const flow = STAGE_FLOWS[claim.type];
  const isBranched = BRANCH_STATUSES.includes(claim.status);
  const currentIndex = flow.indexOf(claim.status);

  return (
    <Card className="cursor-pointer hover:border-primary/40 transition-colors" onClick={() => navigate(`/claims/${claim.id}`)}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-1">
          <h4 className="font-headline-md text-on-surface">Most Recent Claim</h4>
          <span className="font-mono-data text-xs text-primary font-bold">{claim.ref}</span>
        </div>
        <p className="text-body-sm text-outline mb-5 truncate">{claim.purpose}</p>

        {isBranched ? (
          <div className={`flex items-center gap-2 p-3 rounded-lg ${claim.status === ClaimStatus.REJECTED ? 'bg-error-container/20 text-error' : 'bg-tertiary-container/20 text-tertiary'}`}>
            <span className="material-symbols-outlined text-[20px]">
              {claim.status === ClaimStatus.REJECTED ? 'cancel' : 'edit_note'}
            </span>
            <span className="font-label-md">{claim.status}</span>
          </div>
        ) : (
          <div className="grid mt-2 w-full" style={{ gridTemplateColumns: `repeat(${flow.length}, minmax(0, 1fr))` }}>
            {flow.map((stage, i) => {
              const isDone = currentIndex > i;
              const isCurrent = currentIndex === i;
              return (
                <div key={stage} className="relative flex flex-col items-center text-center">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 relative z-10 ${
                    isDone ? 'bg-primary text-white' : isCurrent ? 'bg-primary/20 text-primary ring-2 ring-primary' : 'bg-surface-container-high text-outline'
                  }`}>
                    {isDone ? (
                      <span className="material-symbols-outlined text-[16px]">check</span>
                    ) : (
                      <span className="text-[12px] font-bold">{i + 1}</span>
                    )}
                  </div>
                  <span className={`text-[11px] mt-1.5 block leading-tight break-words px-0.5 ${isCurrent ? 'text-primary font-bold' : 'text-outline'}`}>
                    {STAGE_LABELS[stage]}
                  </span>
                  
                  {i < flow.length - 1 && (
                    <div className={`absolute top-[13px] left-[50%] w-full h-0.5 ${isDone ? 'bg-primary' : 'bg-surface-container-high'}`} />
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-5 pt-4 border-t border-outline-variant flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-outline">person_pin_circle</span>
          <span className="text-body-sm text-on-surface-variant">
            {isBranched ? 'Ended:' : 'Currently with:'} <span className="font-semibold text-on-surface">{currentlyWith(claim, users)}</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
