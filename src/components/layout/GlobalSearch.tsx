import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../AppContext';
import { Claim, ClaimStatus, DelegationStatus, UserRole } from '../../types';
import { isCustodianProcessingClaim, isFinanceVisibleClaim } from '../../lib/claimWorkflow';
import { formatMoney } from '../../lib/money';
import { rankSearchMatch } from '../../lib/globalSearch';

interface SearchResult {
  id: string;
  kind: 'Claim' | 'Meeting' | 'Receipt' | 'Support';
  title: string;
  subtitle: string;
  path: string;
  icon: string;
  searchable: string;
  score?: number;
}

const MAX_RESULTS = 10;

export function GlobalSearch() {
  const {
    currentUser, users, claims, lineItems, moms, supportRequests, delegations,
  } = useAppContext();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const userName = (id?: string) => users.find(user => user.id === id)?.name || 'Unknown user';

  const canOpenClaim = (claim: Claim) => {
    if (currentUser.role === UserRole.ADMIN) return true;
    if (currentUser.role === UserRole.FINANCE) return isFinanceVisibleClaim(claim);
    if (currentUser.role === UserRole.CUSTODIAN) {
      return isCustodianProcessingClaim(claim) || claim.status === ClaimStatus.READY_FOR_CLAIM;
    }
    if (claim.requestorId === currentUser.id) return true;
    if (currentUser.role !== UserRole.APPROVER || claim.status === ClaimStatus.DRAFT) return false;

    const requestor = users.find(user => user.id === claim.requestorId);
    const isDelegate = delegations.some(delegation =>
      delegation.delegate_id === currentUser.id &&
      delegation.approver_id === requestor?.reportsTo &&
      delegation.status === DelegationStatus.ACTIVE
    );
    return claim.approverId === currentUser.id || requestor?.reportsTo === currentUser.id || isDelegate;
  };

  const searchableItems = useMemo<SearchResult[]>(() => {
    const accessibleClaims = claims.filter(canOpenClaim);
    const accessibleClaimIds = new Set(accessibleClaims.map(claim => claim.id));
    const items: SearchResult[] = accessibleClaims.map(claim => ({
      id: `claim-${claim.id}`,
      kind: 'Claim',
      title: claim.ref,
      subtitle: `${claim.type} · ${claim.purpose} · ${formatMoney(claim.total)} · ${claim.status}`,
      path: `/claims/${claim.id}`,
      icon: claim.type === 'Cash Advance' ? 'account_balance_wallet' : claim.type === 'Liquidation' ? 'request_quote' : 'receipt_long',
      searchable: [claim.ref, claim.type, claim.purpose, claim.client, claim.location, claim.status, userName(claim.requestorId)].join(' '),
    }));

    if ([UserRole.REQUESTOR, UserRole.APPROVER].includes(currentUser.role)) {
      const reporteeIds = new Set(users.filter(user => user.reportsTo === currentUser.id).map(user => user.id));
      const delegatedApproverIds = new Set(delegations
        .filter(delegation => delegation.delegate_id === currentUser.id && delegation.status === DelegationStatus.ACTIVE)
        .map(delegation => delegation.approver_id));

      moms.forEach(mom => {
        const owner = users.find(user => user.id === mom.requestorId);
        const visible = mom.requestorId === currentUser.id || (
          currentUser.role === UserRole.APPROVER &&
          !!mom.requestorId &&
          (reporteeIds.has(mom.requestorId) || (!!owner?.reportsTo && delegatedApproverIds.has(owner.reportsTo)))
        );
        if (!visible) return;
        items.push({
          id: `meeting-${mom.id}`,
          kind: 'Meeting',
          title: mom.purposeOfMeeting || mom.companyName || 'Meeting record',
          subtitle: [mom.companyName, mom.meetingDate, mom.contactPerson, mom.status].filter(Boolean).join(' · '),
          path: `/moms/${mom.id}`,
          icon: mom.documentType === 'LOA' ? 'handshake' : 'meeting_room',
          searchable: [mom.id, mom.purposeOfMeeting, mom.companyName, mom.location, mom.contactPerson, mom.contactPersonEmail, mom.preparedBy, mom.status].join(' '),
        });
      });
    }

    if ([UserRole.REQUESTOR, UserRole.APPROVER, UserRole.FINANCE].includes(currentUser.role)) {
      lineItems.forEach(lineItem => {
        if (!accessibleClaimIds.has(lineItem.claimId)) return;
        const claim = claims.find(candidate => candidate.id === lineItem.claimId);
        items.push({
          id: `receipt-${lineItem.id}`,
          kind: 'Receipt',
          title: lineItem.receiptFileName || lineItem.vendor || 'Expense receipt',
          subtitle: `${claim?.ref || 'Unlinked claim'} · ${lineItem.category} · ${formatMoney(lineItem.amount)}`,
          path: `/claims/${lineItem.claimId}`,
          icon: lineItem.receiptUrl ? 'receipt' : 'receipt_long',
          searchable: [lineItem.vendor, lineItem.category, lineItem.businessPurpose, lineItem.receiptFileName, lineItem.orNumber, claim?.ref, claim?.client].join(' '),
        });
      });
    }

    supportRequests
      .filter(ticket => currentUser.role === UserRole.ADMIN || ticket.requestorId === currentUser.id)
      .forEach(ticket => items.push({
        id: `support-${ticket.id}`,
        kind: 'Support',
        title: ticket.subject,
        subtitle: `${ticket.id} · ${ticket.priority} priority · ${ticket.status}`,
        path: `/support?ticket=${encodeURIComponent(ticket.id)}`,
        icon: 'support_agent',
        searchable: [ticket.id, ticket.subject, ticket.description, ticket.priority, ticket.status, userName(ticket.requestorId)].join(' '),
      }));

    return items;
  }, [claims, currentUser, delegations, lineItems, moms, supportRequests, users]);

  const results = useMemo(() => {
    if (query.trim().length < 2) return [];
    return searchableItems
      .map(result => ({ ...result, score: rankSearchMatch(result.title, result.searchable, query) }))
      .filter(result => result.score > 0)
      .sort((a, b) => (b.score || 0) - (a.score || 0) || a.title.localeCompare(b.title))
      .slice(0, MAX_RESULTS);
  }, [query, searchableItems]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  useEffect(() => {
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
      if (event.key === 'Escape') setOpen(false);
    };
    const handleClickOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', handleDocumentKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const chooseResult = (result: SearchResult) => {
    setQuery('');
    setOpen(false);
    navigate(result.path);
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!results.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(index => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(index => (index - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      chooseResult(results[activeIndex]);
    }
  };

  return (
    <div ref={rootRef} className="relative ml-0 w-10 shrink-0 sm:w-full sm:max-w-md md:ml-8">
      <span aria-hidden="true" className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">search</span>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="Global search"
        aria-autocomplete="list"
        aria-controls="global-search-results"
        aria-expanded={open}
        aria-activedescendant={open && results[activeIndex] ? `global-search-${results[activeIndex].id}` : undefined}
        value={query}
        placeholder="Search claims, meetings, receipts..."
        className="h-10 w-10 rounded-full border border-outline-variant bg-surface-container py-2 pl-10 text-body-base text-on-surface outline-none transition-all placeholder:text-transparent focus:border-primary focus:bg-surface focus:ring-2 focus:ring-primary/20 sm:w-full sm:rounded-btn sm:pr-16 sm:placeholder:text-outline"
        onFocus={() => setOpen(true)}
        onChange={event => { setQuery(event.target.value); setOpen(true); }}
        onKeyDown={handleInputKeyDown}
      />
      {open && (
        <div id="global-search-results" role="listbox" className="fixed left-3 right-3 top-[64px] z-30 mt-2 overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-xl sm:absolute sm:left-0 sm:right-0 sm:top-full">
          {query.trim().length < 2 ? (
            <div className="px-4 py-5 text-center">
              <span aria-hidden="true" className="material-symbols-outlined text-[28px] text-outline">manage_search</span>
              <p className="mt-1 text-sm font-medium text-on-surface">Search the workspace</p>
              <p className="mt-1 text-xs text-on-surface-variant">Type at least 2 characters to find records available to your role.</p>
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-sm font-medium text-on-surface">No results for “{query.trim()}”</p>
              <p className="mt-1 text-xs text-on-surface-variant">Try a reference number, client, vendor, purpose, or person.</p>
            </div>
          ) : (
            <>
              <div className="max-h-[min(420px,calc(100vh-96px))] overflow-y-auto p-1.5">
                {results.map((result, index) => (
                  <button
                    key={result.id}
                    id={`global-search-${result.id}`}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${index === activeIndex ? 'bg-primary-container/35' : 'hover:bg-surface-container-high'}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => chooseResult(result)}
                  >
                    <span aria-hidden="true" className="material-symbols-outlined mt-0.5 text-[20px] text-primary">{result.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-on-surface">{result.title}</span>
                        <span className="shrink-0 rounded-full bg-surface-container-high px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">{result.kind}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-on-surface-variant">{result.subtitle}</span>
                    </span>
                    <span aria-hidden="true" className="material-symbols-outlined mt-1 text-[17px] text-outline">arrow_forward</span>
                  </button>
                ))}
              </div>
              <div className="border-t border-outline-variant bg-surface-container-lowest px-3 py-2 text-[11px] text-outline">
                Use ↑ ↓ to move · Enter to open · Esc to close
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
