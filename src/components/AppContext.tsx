import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { User, Claim, StatusHistory, ClaimStatus, ExpenseLineItem, MOM, FieldDefinition, MasterData, ReviewMeeting, SupportRequest, ImportBatch, ApproverDelegation, Company, SystemEmail } from '../types';
import { mockImportBatches } from '../data';
import {
  loadWorkspace, setCurrentUserId, decideOnClaim,
  markReadyForClaim, confirmReceipt, releaseCashAdvance, markEmailsRead,
  collectLiquidationRefund,
} from '../lib/api';

interface AppContextType {
  currentUser: User;
  setCurrentUser: (user: User) => void;
  users: User[];
  claims: Claim[];
  statusHistory: StatusHistory[];
  /** Resolves once the server has applied the transition and state has reloaded. */
  updateClaimStatus: (claimId: string, newStatus: ClaimStatus, changedBy: string, comment?: string, updates?: Partial<Claim>) => Promise<void>;
  /** Re-pull the whole workspace from the server. */
  refresh: () => Promise<void>;
  lineItems: ExpenseLineItem[];
  moms: MOM[];
  emails: SystemEmail[];
  markEmailsRead: (ids: string[]) => void;
  fieldDefinitions: FieldDefinition[];
  masterData: MasterData[];
  companies: Company[];
  reviewMeetings: ReviewMeeting[];
  supportRequests: SupportRequest[];
  importBatches: ImportBatch[];
  delegations: ApproverDelegation[];
  /** Admin-configurable list of valid payment methods; drives every payment picker. */
  paymentMethods: string[];
  /** Admin-configurable amount above which a line item is flagged high-value. */
  highValueThreshold: number;
  /** Company spending policy: max amount per line item, keyed by expense category. */
  categoryLimits: Record<string, number>;
  resetData: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  // Server-backed state. Empty until the first load resolves; `loading` gates
  // render so no page ever sees a half-populated workspace.
  const [currentUser, setCurrentUserState] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [statusHistory, setStatusHistory] = useState<StatusHistory[]>([]);
  const [lineItems, setLineItems] = useState<ExpenseLineItem[]>([]);
  const [moms, setMoms] = useState<MOM[]>([]);
  const [fieldDefinitions, setFieldDefinitions] = useState<FieldDefinition[]>([]);
  const [masterData, setMasterData] = useState<MasterData[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [reviewMeetings, setReviewMeetings] = useState<ReviewMeeting[]>([]);
  const [emails, setEmails] = useState<SystemEmail[]>([]);
  const [supportRequests, setSupportRequests] = useState<SupportRequest[]>([]);
  const [delegations, setDelegations] = useState<ApproverDelegation[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [highValueThreshold, setHighValueThreshold] = useState<number>(15000);
  const [categoryLimits, setCategoryLimits] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Import batches have no read endpoint wired yet — still generated.
  const [importBatches, setImportBatches] = useState<ImportBatch[]>(mockImportBatches);

  const refresh = useCallback(async () => {
    try {
      const data = await loadWorkspace();
      setCurrentUserState(data.currentUser);
      setUsers(data.users);
      setClaims(data.claims);
      setStatusHistory(data.statusHistory);
      setLineItems(data.lineItems);
      setMoms(data.moms);
      setReviewMeetings(data.reviewMeetings);
      setMasterData(data.masterData);
      setCompanies(data.companies);
      setFieldDefinitions(data.fieldDefinitions);
      setEmails(data.emails);
      setSupportRequests(data.supportRequests);
      setDelegations(data.delegations);
      setPaymentMethods(data.paymentMethods);
      setHighValueThreshold(data.highValueThreshold);
      setCategoryLimits(data.categoryLimits);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err?.message || 'Could not reach the server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  /** Role switch: change the mock identity, then reload everything as them. */
  const setCurrentUser = useCallback((user: User) => {
    setCurrentUserId(user.id);
    setLoading(true);
    refresh();
  }, [refresh]);

  const resetData = useCallback(async () => {
    const headers = { 'Content-Type': 'application/json', 'X-User-Id': currentUser?.id || '' };
    // Reset alone empties every transactional table — immediately reseed a full
    // year so the demo lands on populated data, not a blank app.
    await fetch('/api/admin/reset', { method: 'POST', headers });
    await fetch('/api/admin/seed-year', {
      method: 'POST', headers,
      body: JSON.stringify({ options: { demoClaims: true, demoCashAdvances: true, delegations: true, historicalBackfill: true } }),
    });
    setLoading(true);
    refresh();
  }, [refresh, currentUser]);

  /** Mark outbox emails read, optimistically, and tell the server. */
  const markEmailsReadLocal = useCallback((ids: string[]) => {
    setEmails(prev => prev.map(e => ids.includes(e.id) ? { ...e, read: true } : e));
    markEmailsRead(ids);
  }, []);

  /**
   * Drive a claim to a new status. Call sites keep passing a target status;
   * this maps that intent onto whichever server route owns the transition, then
   * reloads so the authoritative result — including any workflow side effects
   * the server applies, like routing or emails — is what the UI shows.
   *
   * Status is no longer set locally: the server decides, and a transition it
   * rejects surfaces as a thrown error rather than a UI that lies.
   */
  const updateClaimStatus = useCallback(async (
    claimId: string,
    newStatus: ClaimStatus,
    _changedBy: string,
    comment?: string,
    updates?: Partial<Claim>,
  ) => {
    const claim = claims.find(c => c.id === claimId);
    if (!claim) throw new Error(`Unknown claim ${claimId}`);

    switch (newStatus) {
      case ClaimStatus.APPROVED:
        await decideOnClaim(claim, 'Approved', comment || '');
        break;
      case ClaimStatus.REJECTED:
        await decideOnClaim(claim, 'Rejected', comment || '');
        break;
      case ClaimStatus.RETURNED:
        await decideOnClaim(claim, 'Returned', comment || '');
        break;
      case ClaimStatus.READY_FOR_CLAIM:
        await markReadyForClaim(claimId, updates?.paymentMethod);
        break;
      case ClaimStatus.COMPLETED:
        // Completion is the requestor confirming receipt with the release code,
        // so it needs that code. Routed through confirmReceipt at the call site
        // (ClaimDetail) rather than here, where the code isn't available.
        if (!updates?.releaseCode) {
          throw new Error('Completing a claim requires the release code — use confirmReceipt.');
        }
        await confirmReceipt(claimId, updates.releaseCode);
        break;
      case ClaimStatus.RELEASED:
        if (!updates?.paymentMethod) {
          throw new Error('Releasing a Cash Advance requires a payment method.');
        }
        await releaseCashAdvance(
          claimId,
          updates?.releaseReference || `REF-${claimId.slice(0, 4).toUpperCase()}`,
          updates.paymentMethod
        );
        break;
      case ClaimStatus.CLOSED:
        // Custodian closing out a Reviewed liquidation's refund. Only valid
        // when the liquidation is already Reviewed (refund due) — the server
        // enforces that and rejects otherwise.
        if (!updates?.paymentMethod) {
          throw new Error('Closing a Liquidation requires a refund method.');
        }
        await collectLiquidationRefund(claimId, updates.paymentMethod, updates?.releaseReference);
        break;
      default:
        throw new Error(`No server route maps to status "${newStatus}"`);
    }

    await refresh();
  }, [claims, refresh]);

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 text-center">
        <div>
          <h1 className="font-headline-md mb-2">Can't reach the server</h1>
          <p className="text-on-surface-variant mb-4">{loadError}</p>
          <button
            onClick={() => { setLoading(true); setLoadError(null); refresh(); }}
            className="px-5 py-2 rounded-full bg-primary text-white font-label-md"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Every consumer treats currentUser as non-null, so hold render until it is.
  if (loading || !currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-primary text-[32px]">sync</span>
      </div>
    );
  }

  return (
    <AppContext.Provider value={{
      currentUser, setCurrentUser, users, refresh,
      claims, statusHistory, updateClaimStatus,
      lineItems, moms,
      emails, markEmailsRead: markEmailsReadLocal,
      fieldDefinitions,
      masterData,
      companies,
      reviewMeetings,
      supportRequests,
      importBatches,
      delegations,
      paymentMethods,
      highValueThreshold,
      categoryLimits,
      resetData
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
