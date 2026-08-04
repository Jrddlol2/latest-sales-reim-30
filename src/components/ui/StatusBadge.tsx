import { ClaimStatus } from '../../types';

export function StatusBadge({ status }: { status: ClaimStatus }) {
  let bgColor = 'bg-surface-container-highest';
  let textColor = 'text-on-surface-variant';
  
  switch (status) {
    case ClaimStatus.DRAFT:
      bgColor = 'bg-slate-500/10';
      textColor = 'text-slate-700';
      break;
    case ClaimStatus.SUBMITTED:
    case ClaimStatus.REVIEW_MEETING_SCHEDULED:
      bgColor = 'bg-blue-500/10';
      textColor = 'text-blue-700';
      break;
    case ClaimStatus.PENDING_APPROVAL:
      bgColor = 'bg-amber-500/10';
      textColor = 'text-amber-800';
      break;
    case ClaimStatus.APPROVED:
    case ClaimStatus.PROCESSING:
      bgColor = 'bg-purple-500/10';
      textColor = 'text-purple-700';
      break;
    case ClaimStatus.READY_FOR_CLAIM:
    case ClaimStatus.COMPLETED:
      bgColor = 'bg-teal-500/10';
      textColor = 'text-teal-700';
      break;
    case ClaimStatus.REJECTED:
      bgColor = 'bg-rose-500/10';
      textColor = 'text-rose-700';
      break;
    case ClaimStatus.RETURNED:
      bgColor = 'bg-orange-500/10';
      textColor = 'text-orange-800';
      break;
  }

  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-input text-[12px] font-bold uppercase tracking-wider ${bgColor} ${textColor}`}>
      {status}
    </span>
  );
}
