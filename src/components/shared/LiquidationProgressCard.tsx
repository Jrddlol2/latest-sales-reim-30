import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/Button';
import { Claim, ClaimStatus } from '../../types';

const LIQUIDATION_DEADLINE_DAYS = 7; // mirrors server.ts's LIQUIDATION_DEADLINE_DAYS

/** Shared between the Requestor dashboard and the Approver's "My Requests"
 *  (approvers submit claims too, and get the same requestor-style summary). */
export function LiquidationProgressCard({ claims }: { claims: Claim[] }) {
  const navigate = useNavigate();

  // An advance is only liquidatable if it's Released AND doesn't already have a
  // liquidation started against it — otherwise the "Start a Liquidation" CTA
  // leads straight to a dead end (the submit picker excludes those too).
  const liquidatedCaIds = useMemo(
    () => new Set(claims.filter(c => c.type === 'Liquidation' && c.cashAdvanceId).map(c => c.cashAdvanceId)),
    [claims]
  );
  const openAdvances = useMemo(
    () => claims.filter(c => c.type === 'Cash Advance' && c.status === ClaimStatus.RELEASED && !liquidatedCaIds.has(c.id)),
    [claims, liquidatedCaIds]
  );
  const overdueAdvances = useMemo(
    () => openAdvances.filter(c => {
      if (!c.releaseDate) return false;
      const daysSinceRelease = (Date.now() - new Date(c.releaseDate).getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceRelease > LIQUIDATION_DEADLINE_DAYS;
    }),
    [openAdvances]
  );

  return (
    <div className="bg-primary-container text-white p-6 rounded-container shadow-sm relative overflow-hidden">
      <div className="relative z-10">
        <h4 className="font-headline-md mb-2">Liquidation Progress</h4>
        {openAdvances.length === 0 ? (
          <p className="font-body-base opacity-80 mb-2">You have no outstanding cash advances to liquidate.</p>
        ) : (
          <>
            <p className="font-body-base opacity-80 mb-6">
              You have {openAdvances.length} cash advance{openAdvances.length === 1 ? '' : 's'} outstanding
              {overdueAdvances.length > 0 && <>, <span className="font-bold">{overdueAdvances.length} past the {LIQUIDATION_DEADLINE_DAYS}-day deadline</span></>}.
            </p>
            <Button variant="secondary" className="w-full font-bold" onClick={() => navigate('/claims/new?type=liquidation')}>Start a Liquidation</Button>
          </>
        )}
      </div>
    </div>
  );
}
