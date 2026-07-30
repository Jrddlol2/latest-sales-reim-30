/**
 * Transport + model adapter between server.ts and the new UI.
 *
 * The two sides model the domain differently and neither was changed to suit
 * the other: the server keeps Claim / CashAdvance / Liquidation as three
 * separate entities with their own status enums and snake_case fields, while
 * every page in this UI is written against one unified camelCase `Claim`
 * discriminated by `type`. Everything in this file exists to bridge that.
 *
 * Direction of travel: server shapes come in through the `from*` adapters and
 * are never handed to a component raw. Anything going back out goes through
 * the mutation helpers at the bottom, which speak the server's vocabulary.
 */
import {
  Claim, ClaimStatus, ClaimType, ExpenseLineItem, MOM, User, UserRole,
  StatusHistory, MasterData, FieldDefinition, MinutesSource,
  ReviewMeeting, ReviewMeetingStatus, Company, SystemEmail,
  SupportRequest, SupportRequestStatus, ApproverDelegation, DelegationStatus,
  NotificationPrefs,
} from '../types';

// --- transport ------------------------------------------------------------

/** The mock-auth identity every API route reads. Set by AppContext on role switch. */
export const CURRENT_USER_KEY = 'mockUserId';

/**
 * Identity lives in sessionStorage, not localStorage, so each browser TAB
 * holds its own signed-in role. That's what lets a presenter open one tab per
 * role (Requestor, Approver, Custodian, Admin) against the same shared backend
 * and watch a claim flow between them — signing in as someone in one tab no
 * longer clobbers the others. sessionStorage survives an in-tab reload but is
 * scoped to the tab, which is exactly the demo behaviour we want.
 */
export const getCurrentUserId = () => sessionStorage.getItem(CURRENT_USER_KEY) || 'u15';
export const setCurrentUserId = (id: string) => sessionStorage.setItem(CURRENT_USER_KEY, id);

/**
 * Distinct from CURRENT_USER_KEY (which always has a default so the API
 * layer never has no identity to send). This one tracks whether *this tab*
 * went through the explicit Login screen — see App.tsx's login gate.
 */
const SESSION_KEY = 'hasLoggedIn';
export const isLoggedIn = () => sessionStorage.getItem(SESSION_KEY) === 'true';
export const login = (userId: string) => {
  setCurrentUserId(userId);
  sessionStorage.setItem(SESSION_KEY, 'true');
};
export const logout = () => {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(CURRENT_USER_KEY);
};

/**
 * Canonical demo account for each role, so a presenter can deep-link straight
 * into a role's tab (e.g. `/?role=approver`) without clicking through the
 * account picker. These ids match buildDefaultUsers() in server.ts.
 */
const ROLE_DEEP_LINK: Record<string, string> = {
  requestor: 'u1', // Alice Reyes
  approver: 'u2',  // Bob Santos (Alice's manager)
  custodian: 'u3', // Carol Ramos
  admin: 'u4',     // Dave Lopez
};

/**
 * Honour a `?role=` or `?uid=` query param by signing this tab in as that
 * account, then strip the param from the URL so a reload doesn't force the
 * identity back. Returns true if it logged the tab in. Called once at startup
 * before the login gate is evaluated.
 */
export const applyDeepLinkLogin = (): boolean => {
  const params = new URLSearchParams(window.location.search);
  const roleParam = params.get('role')?.toLowerCase();
  const uidParam = params.get('uid');
  const targetId = uidParam || (roleParam ? ROLE_DEEP_LINK[roleParam] : undefined);
  if (!targetId) return false;

  login(targetId);
  params.delete('role');
  params.delete('uid');
  const cleaned = params.toString();
  const url = window.location.pathname + (cleaned ? `?${cleaned}` : '') + window.location.hash;
  window.history.replaceState({}, '', url);
  return true;
};

export interface ApiError extends Error {
  status?: number;
  body?: any;
}

export async function apiFetch<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': getCurrentUserId(),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({} as any));
    // Prefer a human-readable `message` (e.g. the orphan warning) over the
    // machine `error` code, and attach the full body + status so callers that
    // need to branch on a specific condition (like a 409 confirm-to-proceed)
    // can, without re-reading the response.
    const err = new Error(body.message || body.error || `${options.method || 'GET'} ${url} failed (${res.status})`) as ApiError;
    err.status = res.status;
    err.body = body;
    throw err;
  }

  // 204s and empty bodies are legitimate responses from several mutation routes.
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/**
 * Attachments are served by a route that gates on identity, and browsers don't
 * send custom headers for <img> src — so the uid rides along as a query param.
 * Mirrors the carve-out server.ts documents on GET /uploads/:filename.
 */
export const uploadUrl = (url?: string) => {
  if (!url) return undefined;
  if (!url.startsWith('/uploads/')) return url;
  return `${url}?uid=${encodeURIComponent(getCurrentUserId())}`;
};

// --- status mapping -------------------------------------------------------

/**
 * Three server enums collapse into this UI's single ClaimStatus. The overlaps
 * are deliberate and lossy in one direction only: 'Approved' means the same
 * thing on a claim and a cash advance, so mapping back out requires knowing
 * the claim's `type` (see toServerStatus).
 */
const CLAIM_STATUS: Record<string, ClaimStatus> = {
  'Draft': ClaimStatus.DRAFT,
  'Pending Approval': ClaimStatus.PENDING_APPROVAL,
  'Approved': ClaimStatus.APPROVED,
  'Processing': ClaimStatus.PROCESSING,
  'Ready for Claim': ClaimStatus.READY_FOR_CLAIM,
  'Completed': ClaimStatus.COMPLETED,
  'Rejected': ClaimStatus.REJECTED,
  // The server spells this 'Returned'; the UI enum's value is 'Returned for Revision'.
  'Returned': ClaimStatus.RETURNED,
};

const CASH_ADVANCE_STATUS: Record<string, ClaimStatus> = {
  'Draft': ClaimStatus.DRAFT,
  'Submitted': ClaimStatus.SUBMITTED,
  'Approved': ClaimStatus.APPROVED,
  'Rejected': ClaimStatus.REJECTED,
  'Released': ClaimStatus.RELEASED,
  'Liquidated': ClaimStatus.LIQUIDATED,
};

const LIQUIDATION_STATUS: Record<string, ClaimStatus> = {
  'Draft': ClaimStatus.DRAFT,
  'Submitted': ClaimStatus.SUBMITTED,
  'ReturnedForRevision': ClaimStatus.RETURNED,
  'Reviewed': ClaimStatus.REVIEWED,
  'Closed': ClaimStatus.CLOSED,
};

/** Reverse of the tables above. `type` disambiguates the shared labels. */
export function toServerStatus(status: ClaimStatus, type: ClaimType): string {
  const table = type === 'Cash Advance' ? CASH_ADVANCE_STATUS
    : type === 'Liquidation' ? LIQUIDATION_STATUS
    : CLAIM_STATUS;
  const hit = Object.entries(table).find(([, ui]) => ui === status);
  return hit ? hit[0] : status;
}

// --- inbound adapters -----------------------------------------------------

export function fromServerUser(u: any): User {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as UserRole,
    department: u.department || '',
    jobTitle: u.job_title || '',
    // Server uses null for "reports to nobody"; the UI treats absent as the same.
    reportsTo: u.reports_to || undefined,
    employmentStatus: u.employment_status === 'Inactive' ? 'Inactive' : 'Active',
    canApproveReimbursements: Boolean(u.can_approve_reimbursements),
    notificationPrefs: u.notification_prefs || undefined,
    avatarUrl: u.avatar_url || undefined,
  };
}

function fromServerExpense(e: any, claimId: string): ExpenseLineItem {
  return {
    id: e.id,
    claimId,
    expenseDate: (e.expense_date || '').split('T')[0],
    vendor: e.vendor || '',
    category: e.category || '',
    amount: Number(e.amount) || 0,
    paymentMethod: e.payment_method || '',
    businessPurpose: e.business_purpose || '',
    receiptUrl: e.receipt_url || undefined,
    // The server carries an OR number rather than a filename; surface it as the
    // label so Receipt Archive and the detail modal have something to show.
    receiptFileName: e.or_number || undefined,
  };
}

export function fromServerMom(m: any): MOM | null {
  if (!m) return null;
  return {
    id: m.id,
    claimId: m.claim_id || '',
    requestorId: m.requestor_id || undefined,
    documentType: m.document_type === 'LOA' ? 'LOA' : 'MoM',
    meetingDate: m.meeting_date || undefined,
    status: m.status || undefined,
    source: m.minutes_source === 'Uploaded' ? MinutesSource.UPLOADED : MinutesSource.TEMPLATE,
    fileUrl: m.file_url || undefined,
    fileName: m.file_name || undefined,
    companyName: m.client_name || m.client || undefined,
    purposeOfMeeting: m.purpose || undefined,
    location: m.location || undefined,
    contactPerson: m.contact_person || undefined,
    contactPersonDesignation: m.custom_fields?.contact_person_designation || undefined,
    contactPersonEmail: m.contact_person_email || undefined,
    description: m.discussion || undefined,
    agreements: m.agreements || undefined,
    actionItems: m.action_items || undefined,
    preparedBy: m.prepared_by || undefined,
    summary: m.summary || undefined,
    meetingType: m.meeting_type || undefined,
    participantsInternal: m.participants_internal || undefined,
    participantsExternal: m.participants_external || undefined,
    customFields: m.custom_fields || undefined,
    // Admin-defined dynamic fields live in custom_fields; lift the two the
    // MOM form treats as first-class so existing components keep working.
    typeOfAccount: m.custom_fields?.type_of_account || undefined,
    category: m.custom_fields?.category || undefined,
  };
}

const REVIEW_MEETING_STATUS: Record<string, ReviewMeetingStatus> = {
  PendingConfirmation: ReviewMeetingStatus.PENDING_CONFIRMATION,
  Confirmed: ReviewMeetingStatus.CONFIRMED,
  DeclineRequested: ReviewMeetingStatus.DECLINE_REQUESTED,
  Completed: ReviewMeetingStatus.COMPLETED,
};

export function fromServerReviewMeeting(r: any): ReviewMeeting {
  return {
    id: r.id,
    claimId: r.claim_id,
    meetingDate: (r.meeting_date || '').split('T')[0],
    meetingTime: r.meeting_time || '',
    approverId: r.approver_id,
    status: REVIEW_MEETING_STATUS[r.status] ?? (r.status as ReviewMeetingStatus),
    requestorId: r.requestor_id || undefined,
    requestorName: r.requestor_name || undefined,
    approverName: r.approver_name || undefined,
    claimNumber: r.claim_number || undefined,
    declineReason: r.decline_reason || undefined,
  };
}

function fromServerHistory(h: any, claimId: string): StatusHistory {
  return {
    id: h.id,
    claimId,
    // '' is the server's sentinel for "no previous status" on the first entry.
    oldStatus: h.old_status ? (h.old_status as ClaimStatus) : undefined,
    newStatus: h.new_status as ClaimStatus,
    changedBy: h.changed_by,
    timestamp: h.timestamp,
    // The server calls the free-text note `reason`; the UI renders it as a comment.
    comment: h.reason || undefined,
  };
}

/** A reimbursement claim. The server's `Claim` maps almost 1:1 onto the UI's. */
export function fromServerClaim(c: any): Claim {
  const submitted = (c.history || []).find((h: any) => h.new_status === 'Pending Approval');
  return {
    id: c.id,
    ref: c.claim_number || `REIM-${String(c.id).slice(0, 6)}`,
    requestorId: c.requestor_id,
    status: CLAIM_STATUS[c.status] ?? (c.status as ClaimStatus),
    total: Number(c.total_amount) || 0,
    submittedAt: submitted?.timestamp,
    createdAt: c.created_at,
    type: 'Reimbursement',
    purpose: c.remarks || c.mom?.purpose || c.expense_category || 'Reimbursement',
    flaggedHighValue: Boolean(c.flagged_high_value),
    releaseCode: c.release_code || undefined,
    paymentReference: c.payment_reference || undefined,
    paymentMethod: c.payment_method || undefined,
    processedBy: c.processed_by || undefined,
    processingDate: c.processing_date || undefined,
    approverId: c.current_approver_id || undefined,
    approverStaleSince: c.approver_stale_since || undefined,
    approverStaleReason: c.approver_stale_reason || undefined,
    pendingTransferTo: c.pending_transfer_to || undefined,
    escalatedToAdmin: Boolean(c.escalated_to_admin),
    importBatchId: c.import_batch_id || undefined,
  };
}

/** A cash advance, flattened into the unified Claim shape. */
export function fromServerCashAdvance(ca: any): Claim {
  return {
    id: ca.id,
    ref: `CADV-${String(ca.id).slice(0, 6)}`,
    requestorId: ca.requestorId,
    status: CASH_ADVANCE_STATUS[ca.status] ?? (ca.status as ClaimStatus),
    total: Number(ca.amount) || 0,
    createdAt: ca.createdAt,
    submittedAt: ca.status === 'Draft' ? undefined : ca.createdAt,
    type: 'Cash Advance',
    purpose: ca.purpose || 'Cash Advance',
    approverId: ca.approverId || undefined,
    releasedBy: ca.releasedBy || undefined,
    releaseDate: ca.releaseDate || undefined,
    releaseReference: ca.releaseReference || undefined,
    paymentMethod: ca.releaseMethod || undefined,
    reminderSent: Boolean(ca.reminderSent),
  };
}

/** A liquidation, flattened the same way and carrying its variance across. */
export function fromServerLiquidation(l: any): Claim {
  return {
    id: l.id,
    ref: `LIQ-${String(l.id).slice(0, 6)}`,
    requestorId: l.requestorId,
    status: LIQUIDATION_STATUS[l.status] ?? (l.status as ClaimStatus),
    total: Number(l.totalSpent) || 0,
    createdAt: l.createdAt,
    submittedAt: l.status === 'Draft' ? undefined : l.createdAt,
    type: 'Liquidation',
    // A liquidation has no purpose of its own — it inherits the advance's.
    purpose: l.cashAdvance?.purpose || 'Liquidation',
    cashAdvanceId: l.cashAdvanceId,
    varianceAmount: Number(l.varianceAmount) || 0,
    varianceType: l.varianceType as Claim['varianceType'],
    paymentMethod: l.refundMethod || undefined,
  };
}

export function fromServerEmail(e: any): SystemEmail {
  return {
    id: e.id,
    recipientId: e.recipient_id,
    from: e.from || 'no-reply@mgenesis.com',
    to: e.to || '',
    subject: e.subject || '',
    body: e.body || '',
    read: Boolean(e.read),
    timestamp: e.timestamp,
  };
}

function fromServerSupportMessage(m: any) {
  return {
    id: m.id,
    senderId: m.sender_id,
    message: m.message,
    timestamp: m.timestamp,
  };
}

export function fromServerSupport(s: any): SupportRequest {
  return {
    id: s.id,
    requestorId: s.requestor_id,
    subject: s.subject,
    description: s.description,
    relatedEntityType: s.related_entity_type || undefined,
    relatedEntityId: s.related_entity_id || undefined,
    priority: s.priority,
    status: s.status as SupportRequestStatus,
    assignedAdminId: s.assigned_admin_id || undefined,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    messages: (s.messages || []).map(fromServerSupportMessage),
  };
}

export function fromServerDelegation(d: any): ApproverDelegation {
  return {
    id: d.id,
    approver_id: d.approver_id,
    delegate_id: d.delegate_id,
    start_date: d.start_date,
    end_date: d.end_date,
    status: d.status as DelegationStatus,
    decline_reason: d.decline_reason || undefined,
    created_by: d.created_by,
    created_at: d.created_at,
    updated_at: d.updated_at,
  };
}

export function fromServerMasterData(all: any): MasterData[] {
  // Server exposes one catalog per entity; the UI wants a flat list keyed by type.
  const catalogs: Array<[string, MasterData['type']]> = [
    ['departments', 'department'],
    ['costCenters', 'costCenter'],
    ['businessUnits', 'businessUnit'],
    ['branches', 'branch'],
    ['projectCodes', 'projectCode'],
    ['vendors', 'vendor'],
  ];
  return catalogs.flatMap(([key, type]) =>
    (all?.[key] || []).map((r: any) => ({
      id: r.id,
      type,
      name: r.name,
      code: r.code || undefined,
      active: r.active !== false,
      notes: r.notes || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
  );
}

/**
 * The server's master_data_entity values are the plural catalog keys
 * ('costCenters'); the UI's MasterData.type is singular ('costCenter').
 */
const MASTER_ENTITY_SINGULAR: Record<string, string> = {
  departments: 'department',
  costCenters: 'costCenter',
  businessUnits: 'businessUnit',
  branches: 'branch',
  projectCodes: 'projectCode',
  vendors: 'vendor',
};

export function fromServerFieldDefinition(fd: any): FieldDefinition {
  return {
    id: fd.id,
    entity: fd.entity,
    key: fd.key,
    label: fd.label,
    input_type: fd.input_type,
    required: Boolean(fd.required),
    active: fd.active !== false,
    default_value: fd.default_value || undefined,
    display_order: Number(fd.display_order) || 0,
    options: fd.options || undefined,
    master_data_entity: fd.master_data_entity
      ? MASTER_ENTITY_SINGULAR[fd.master_data_entity] || fd.master_data_entity
      : undefined,
    allow_other: Boolean(fd.allow_other),
    applicableClaimTypes: fd.applicableClaimTypes || undefined,
    validation: fd.validation || undefined,
  };
}

// --- aggregate load -------------------------------------------------------

export interface WorkspaceData {
  currentUser: User;
  users: User[];
  claims: Claim[];
  lineItems: ExpenseLineItem[];
  moms: MOM[];
  reviewMeetings: ReviewMeeting[];
  statusHistory: StatusHistory[];
  masterData: MasterData[];
  fieldDefinitions: FieldDefinition[];
  companies: Company[];
  emails: SystemEmail[];
  supportRequests: SupportRequest[];
  delegations: ApproverDelegation[];
  paymentMethods: string[];
  /** Admin-configurable amount above which a line item is flagged high-value. */
  highValueThreshold: number;
  /** Company spending policy: max amount per line item, keyed by expense category. */
  categoryLimits: Record<string, number>;
}

/**
 * One shot at everything the app's context needs. The three claim-ish
 * collections are fetched separately (they're separate resources server-side)
 * and merged here so components only ever see one list.
 */
export async function loadWorkspace(): Promise<WorkspaceData> {
  const [me, users, rawClaims, rawAdvances, rawLiquidations, masterAll, rawFields, rawMoms, rawReviewMeetings, rawCompanies, rawOutbox, rawSupport, rawDelegations, rawSettings] =
    await Promise.all([
      apiFetch('/api/me'),
      apiFetch('/api/users'),
      apiFetch('/api/claims'),
      apiFetch('/api/cash-advances'),
      apiFetch('/api/liquidations'),
      apiFetch('/api/master-data/all'),
      apiFetch('/api/field-definitions'),
      apiFetch('/api/moms'),
      apiFetch('/api/review-meetings'),
      apiFetch('/api/companies'),
      apiFetch('/api/outbox'),
      apiFetch('/api/support'),
      apiFetch('/api/delegations'),
      apiFetch('/api/admin/settings'),
    ]);

  const claims: Claim[] = [
    ...(rawClaims || []).map(fromServerClaim),
    ...(rawAdvances || []).map(fromServerCashAdvance),
    ...(rawLiquidations || []).map(fromServerLiquidation),
  ];

  const lineItems: ExpenseLineItem[] = [
    ...(rawClaims || []).flatMap((c: any) =>
      (c.expenses || []).map((e: any) => fromServerExpense(e, c.id))
    ),
    ...(rawLiquidations || []).flatMap((l: any) =>
      (l.lineItems || []).map((e: any) => fromServerExpense(e, l.id))
    ),
  ];

  // The dedicated endpoint returns every MOM (including standalone ones not yet
  // attached to a claim), so it supersedes the claim-embedded copies.
  const moms = (rawMoms || []).map(fromServerMom).filter(Boolean) as MOM[];

  const statusHistory = (rawClaims || []).flatMap((c: any) =>
    (c.history || []).map((h: any) => fromServerHistory(h, c.id))
  );

  return {
    currentUser: fromServerUser(me),
    users: (users || []).map(fromServerUser),
    claims: claims.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ),
    lineItems,
    moms,
    reviewMeetings: (rawReviewMeetings || []).map(fromServerReviewMeeting),
    statusHistory,
    masterData: fromServerMasterData(masterAll),
    fieldDefinitions: (rawFields || []).map(fromServerFieldDefinition),
    companies: (rawCompanies || []).map((c: any): Company => ({
      id: c.id, name: c.name, industry: c.industry || undefined, notes: c.notes || undefined,
      address: c.address || undefined,
      contactPerson: c.contact_person || undefined,
      contactEmail: c.contact_email || undefined,
    })),
    emails: (rawOutbox || []).map(fromServerEmail),
    supportRequests: (rawSupport || []).map(fromServerSupport),
    delegations: (rawDelegations || []).map(fromServerDelegation),
    paymentMethods: rawSettings?.paymentMethods || ['Cash', 'GCash', 'Bank Transfer', 'Check'],
    highValueThreshold: Number(rawSettings?.highValueThreshold) || 15000,
    categoryLimits: (rawSettings?.categoryLimits && typeof rawSettings.categoryLimits === 'object') ? rawSettings.categoryLimits : {},
  };
}

/** Admin: update system settings (payment methods, high-value threshold, category limits). */
export const updateAdminSettings = (body: Record<string, unknown>) =>
  apiFetch('/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) });

// --- audit / support / delegation reads and mutations ---------------------

function toQueryString(params?: Record<string, string | number | undefined>): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  /** Present on /api/outbox only: unread count across the whole (unsearched) set. */
  unreadTotal?: number;
}

/**
 * Full immutable event feed — admin only. Fetched on demand by the Audit page.
 * With no args, returns the plain array (AdminDashboard's "recent activity"
 * call, via `limit`). With `page`/`pageSize`, the server returns a
 * `PageResult` instead — that's the shape AuditLog.tsx uses.
 */
export const fetchAuditHistory = (params?: { page?: number; pageSize?: number; search?: string; limit?: number }) =>
  apiFetch(`/api/history${toQueryString(params as any)}`);

/**
 * Admin's full outbox, paginated + searched server-side. With no args this
 * is the same plain array `loadWorkspace` has always fetched; with
 * `page`/`pageSize` the server returns a `PageResult` — used by the
 * System Emails admin page instead of paging through the context copy.
 */
export const fetchOutbox = (params?: { page?: number; pageSize?: number; search?: string }) =>
  apiFetch(`/api/outbox${toQueryString(params as any)}`);

/** One support request with its full message thread. */
export const fetchSupportRequest = (id: string) => apiFetch(`/api/support/${id}`);

export const createSupportRequest = (body: {
  subject: string; description: string; priority: string;
  related_entity_type?: string; related_entity_id?: string;
}) => apiFetch('/api/support', { method: 'POST', body: JSON.stringify(body) });

export const addSupportMessage = (id: string, message: string) =>
  apiFetch(`/api/support/${id}/messages`, { method: 'POST', body: JSON.stringify({ message }) });

export const updateSupportStatus = (id: string, status: string) =>
  apiFetch(`/api/support/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });

/** Mark outbox emails read. Ignore failures — it's a cosmetic read-state update. */
export const markEmailsRead = (ids: string[]) =>
  apiFetch('/api/outbox/read', { method: 'PUT', body: JSON.stringify({ ids }) }).catch(() => {});

// --- delegation lifecycle ---------------------------------------------------

/** Approver requests coverage. Starts Pending — routing doesn't change until accepted. */
export const requestDelegation = (delegateId: string, startDate: string, endDate: string) =>
  apiFetch('/api/delegations', {
    method: 'POST',
    body: JSON.stringify({ delegate_id: delegateId, start_date: startDate, end_date: endDate }),
  });

export const acceptDelegation = (id: string) => apiFetch(`/api/delegations/${id}/accept`, { method: 'POST' });

export const declineDelegation = (id: string, reason?: string) =>
  apiFetch(`/api/delegations/${id}/decline`, { method: 'POST', body: JSON.stringify({ reason }) });

/** Approver-side cancel; valid while Pending or Active. */
export const cancelDelegation = (id: string) => apiFetch(`/api/delegations/${id}/cancel`, { method: 'POST' });

// --- self-service settings --------------------------------------------------

export const updateNotificationPrefs = (prefs: NotificationPrefs) =>
  apiFetch('/api/me/notification-prefs', { method: 'PUT', body: JSON.stringify(prefs) });

// --- outbound mutations ---------------------------------------------------

/**
 * Approve / reject / return, routed to whichever endpoint owns the entity.
 * The UI calls this with its own vocabulary and stays out of the server's.
 */
export async function decideOnClaim(
  claim: Claim,
  decision: 'Approved' | 'Rejected' | 'Returned',
  comment: string
) {
  if (claim.type === 'Cash Advance') {
    return apiFetch(`/api/cash-advances/${claim.id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ decision, comment }),
    });
  }
  if (claim.type === 'Liquidation') {
    return apiFetch(`/api/liquidations/${claim.id}/review`, {
      method: 'POST',
      body: JSON.stringify({ decision, comment }),
    });
  }
  return apiFetch(`/api/claims/${claim.id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ decision, comment }),
  });
}

/**
 * Approver (or Admin): hand a claim off to another approver after an
 * org-chart change flags it stale. `to` defaults server-side to the claim's
 * own `pending_transfer_to` suggestion if omitted.
 */
export const transferApprover = (claimId: string, to?: string) =>
  apiFetch(`/api/claims/${claimId}/transfer-approver`, {
    method: 'POST',
    body: JSON.stringify(to ? { to } : {}),
  });

/** Admin: force-move a claim to a different approver outside the normal org-change flow. */
export const reassignApprover = (claimId: string, newApproverId: string, reason: string) =>
  apiFetch(`/api/claims/${claimId}/reassign`, {
    method: 'PUT',
    body: JSON.stringify({ new_approver_id: newApproverId, reason }),
  });

/** Admin: manually trigger the fallback-escalation sweep (normally a cron). */
export const runFallbackCheck = (force = false) =>
  apiFetch('/api/admin/run-fallback-check', {
    method: 'POST',
    body: JSON.stringify({ force }),
  });

// --- review-meeting scheduling loop -----------------------------------------

/** Approver (or active delegate) confirms the requestor's proposed time. */
export const confirmReviewMeeting = (id: string) =>
  apiFetch(`/api/review-meetings/${id}/confirm`, { method: 'POST' });

/** Approver (or active delegate) can't make the proposed time. */
export const declineReviewMeeting = (id: string, reason?: string) =>
  apiFetch(`/api/review-meetings/${id}/decline`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

/** Requestor proposes a new date/time — re-opens pending confirmation. */
export const rescheduleReviewMeeting = (id: string, meetingDate: string, meetingTime: string) =>
  apiFetch(`/api/review-meetings/${id}/reschedule`, {
    method: 'PUT',
    body: JSON.stringify({ meeting_date: meetingDate, meeting_time: meetingTime }),
  });

/**
 * Custodian: issue (or regenerate) the release code the requestor quotes at
 * payout. The server mints one itself if `code` is omitted.
 */
export const generateClaimCode = (claimId: string, code?: string) =>
  apiFetch(`/api/claims/${claimId}/claim-code`, {
    method: 'PUT',
    body: JSON.stringify({ code }),
  });

/** Custodian: mark an approved claim ready for the requestor to collect. */
export const markReadyForClaim = (claimId: string, paymentMethod?: string) =>
  apiFetch(`/api/claims/${claimId}/ready-for-claim`, {
    method: 'POST',
    body: JSON.stringify({ payment_method: paymentMethod }),
  });

/**
 * Requestor: confirm receipt of funds by quoting the release code the custodian
 * issued. This is the two-party anti-fraud gate — the server verifies both that
 * the caller owns the claim and that the code matches, then completes it.
 */
export const confirmReceipt = (claimId: string, code: string) =>
  apiFetch(`/api/claims/${claimId}/claim`, {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

export const releaseCashAdvance = (id: string, releaseReference: string, releaseMethod: string) =>
  apiFetch(`/api/cash-advances/${id}/release`, {
    method: 'POST',
    body: JSON.stringify({ releaseReference, releaseMethod }),
  });

/** A line item as the wizard holds it, before receipts have been uploaded. */
export interface DraftLineItem {
  category?: string;
  amount?: number;
  vendor?: string;
  businessPurpose?: string;
  expenseDate?: string;
  paymentMethod?: string;
  orNumber?: string;
  receiptFile?: File;
  receiptUrl?: string;
}

export interface SubmitClaimInput {
  lineItems: DraftLineItem[];
  /** Core MOM columns the server models as first-class fields. */
  mom: {
    client?: string;
    purpose?: string;
    location?: string;
    contactPerson?: string;
    contactPersonEmail?: string;
    discussion?: string;
    meetingDate?: string;
    meetingTime?: string;
    source: MinutesSource;
    documentType?: 'MoM' | 'LOA';
    file?: File;
  };
  /** Admin-defined dynamic fields, keyed by FieldDefinition.key. */
  customFields?: Record<string, string>;
  meetingDate: string;
  meetingTime: string;
  remarks?: string;
  isDraft?: boolean;
}

/**
 * The server models submission as three dependent writes — receipts must exist
 * before line items can reference them, and a completed MOM must exist before a
 * claim can attach to it. Ordering matters and a failure part-way leaves the
 * earlier writes in place, which is why the error message names the stage.
 */
export async function submitClaimFlow(input: SubmitClaimInput) {
  const { lineItems, mom, customFields, meetingDate, meetingTime, remarks, isDraft } = input;

  // 1. Receipts. The server rejects any line item without a receipt_url.
  let uploaded: DraftLineItem[];
  try {
    uploaded = await Promise.all(
      lineItems.map(async (li) => {
        if (li.receiptFile) {
          const { url } = await uploadFile(li.receiptFile);
          return { ...li, receiptUrl: url };
        }
        return li;
      })
    );
  } catch {
    throw new Error('Could not upload one or more receipts.');
  }

  const missing = uploaded.findIndex((li) => !li.receiptUrl);
  if (missing !== -1) {
    throw new Error(`Expense row ${missing + 1} needs a receipt attached before you can submit.`);
  }

  // 2. MOM. Must be Completed for a real submission; a draft claim may carry a draft MOM.
  let momFileUrl: string | undefined;
  let momFileName: string | undefined;
  if (mom.file) {
    const up = await uploadFile(mom.file);
    momFileUrl = up.url;
    momFileName = mom.file.name;
  }

  const createdMom = await apiFetch('/api/moms', {
    method: 'POST',
    body: JSON.stringify({
      client: mom.client || '',
      purpose: mom.purpose || '',
      location: mom.location || '',
      contact_person: mom.contactPerson || '',
      contact_person_email: mom.contactPersonEmail || '',
      discussion: mom.discussion || '',
      meeting_date: mom.meetingDate || meetingDate || new Date().toISOString().split('T')[0],
      meeting_time: mom.meetingTime || meetingTime || '',
      minutes_source: mom.source,
      document_type: mom.documentType || 'MoM',
      file_url: momFileUrl,
      file_name: momFileName,
      status: isDraft ? 'Draft' : 'Completed',
      custom_fields: customFields,
    }),
  });

  // 3. Claim.
  return apiFetch('/api/claims', {
    method: 'POST',
    body: JSON.stringify({
      mom_id: createdMom.id,
      remarks: remarks || mom.purpose || '',
      meeting_date: meetingDate,
      meeting_time: meetingTime,
      is_draft: Boolean(isDraft),
      line_items: uploaded.map((li) => ({
        category: li.category,
        amount: Number(li.amount) || 0,
        receipt_url: li.receiptUrl,
        or_number: li.orNumber || '',
        // Per-row detail the requestor entered — previously dropped here, so the
        // server backfilled vendor/date/method from the meeting. Send them through.
        vendor: li.vendor || '',
        expense_date: li.expenseDate || '',
        payment_method: li.paymentMethod || '',
        business_purpose: li.businessPurpose || '',
      })),
    }),
  });
}

export interface ResubmitClaimInput {
  claimId: string;
  momId: string;
  lineItems: DraftLineItem[];
  remarks?: string;
}

/**
 * Revise & Resubmit — a Returned Reimbursement re-enters the approval queue
 * via PUT /api/claims/:id/resubmit. The server requires the MOM this claim
 * already carries (re-linking a different one is possible but out of scope
 * here) and re-derives category/total from the edited line items, same as
 * a fresh submission's receipt-then-claim ordering.
 */
export async function resubmitClaimFlow(input: ResubmitClaimInput) {
  const { claimId, momId, lineItems, remarks } = input;

  let uploaded: DraftLineItem[];
  try {
    uploaded = await Promise.all(
      lineItems.map(async (li) => {
        if (li.receiptFile) {
          const { url } = await uploadFile(li.receiptFile);
          return { ...li, receiptUrl: url };
        }
        return li;
      })
    );
  } catch {
    throw new Error('Could not upload one or more receipts.');
  }

  const missing = uploaded.findIndex((li) => !li.receiptUrl);
  if (missing !== -1) {
    throw new Error(`Expense row ${missing + 1} needs a receipt attached before you can resubmit.`);
  }

  return apiFetch(`/api/claims/${claimId}/resubmit`, {
    method: 'PUT',
    body: JSON.stringify({
      mom_id: momId,
      remarks: remarks || '',
      line_items: uploaded.map((li) => ({
        category: li.category,
        amount: Number(li.amount) || 0,
        receipt_url: li.receiptUrl,
        or_number: li.orNumber || '',
        vendor: li.vendor || '',
        expense_date: li.expenseDate || '',
        payment_method: li.paymentMethod || '',
        business_purpose: li.businessPurpose || '',
      })),
    }),
  });
}

export interface SubmitCashAdvanceInput {
  amount: number;
  purpose: string;
  momId?: string;
  isDraft?: boolean;
}

/**
 * A Cash Advance has no expense line items — it's just an amount + purpose
 * routed to the requestor's approver. Draft creation and submission are two
 * separate server calls (POST /api/cash-advances, then .../submit) so a draft
 * can be created and left for later without ever hitting `submit`.
 */
export async function submitCashAdvanceFlow(input: SubmitCashAdvanceInput) {
  const ca = await apiFetch('/api/cash-advances', {
    method: 'POST',
    body: JSON.stringify({
      amount: input.amount,
      purpose: input.purpose,
      momId: input.momId,
    }),
  });
  if (input.isDraft) return ca;
  return apiFetch(`/api/cash-advances/${ca.id}/submit`, { method: 'POST' });
}

export interface SubmitLiquidationInput {
  cashAdvanceId: string;
  lineItems: DraftLineItem[];
  /** How the requestor will return an over-advance (only when a refund is due). */
  refundMethod?: string;
  isDraft?: boolean;
}

/**
 * A Liquidation settles a Released Cash Advance: create the (empty) report
 * against it, attach each expense as its own line item (receipts upload
 * first, same as a reimbursement), then submit for the approver's review.
 * The server computes total/variance itself on every line-item write.
 */
export async function submitLiquidationFlow(input: SubmitLiquidationInput) {
  const liquidation = await apiFetch('/api/liquidations', {
    method: 'POST',
    body: JSON.stringify({ cashAdvanceId: input.cashAdvanceId }),
  });

  for (const li of input.lineItems) {
    let receiptUrl = li.receiptUrl;
    if (li.receiptFile) {
      const up = await uploadFile(li.receiptFile);
      receiptUrl = up.url;
    }
    if (!receiptUrl) {
      throw new Error('Every liquidation expense needs a receipt attached before you can submit.');
    }
    await apiFetch(`/api/liquidations/${liquidation.id}/line-items`, {
      method: 'POST',
      body: JSON.stringify({
        expense_date: li.expenseDate,
        vendor: li.vendor,
        category: li.category,
        amount: Number(li.amount) || 0,
        payment_method: li.paymentMethod,
        business_purpose: li.businessPurpose || 'Liquidation expense',
        receipt_url: receiptUrl,
        or_number: li.orNumber,
      }),
    });
  }

  if (input.isDraft) return liquidation;
  return apiFetch(`/api/liquidations/${liquidation.id}/submit`, {
    method: 'POST',
    body: JSON.stringify({ refundMethod: input.refundMethod }),
  });
}

/**
 * Custodian: close out a Reviewed liquidation with a refund due, once the
 * cash has actually been collected back from the requestor.
 */
export const collectLiquidationRefund = (liquidationId: string, refundMethod: string, referenceNote?: string) =>
  apiFetch(`/api/liquidations/${liquidationId}/collect-refund`, {
    method: 'POST',
    body: JSON.stringify({ referenceNote, refundMethod }),
  });

/**
 * The master-data route key is the plural-kebab form; the UI's MasterData.type
 * is singular-camel. This is the single place that bridges the two.
 */
const MASTER_ROUTE_KEY: Record<MasterData['type'], string> = {
  department: 'departments',
  costCenter: 'cost-centers',
  businessUnit: 'business-units',
  branch: 'branches',
  projectCode: 'project-codes',
  vendor: 'vendors',
};

type MasterDataInput = { name?: string; code?: string; notes?: string; active?: boolean };

export const createMasterData = (type: MasterData['type'], body: MasterDataInput) =>
  apiFetch(`/api/master-data/${MASTER_ROUTE_KEY[type]}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const updateMasterData = (type: MasterData['type'], id: string, body: MasterDataInput) =>
  apiFetch(`/api/master-data/${MASTER_ROUTE_KEY[type]}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

/** Field definitions — admin-configurable dynamic form fields. */
export const createFieldDefinition = (body: Record<string, unknown>) =>
  apiFetch('/api/field-definitions', { method: 'POST', body: JSON.stringify(body) });

export const updateFieldDefinition = (id: string, body: Record<string, unknown>) =>
  apiFetch(`/api/field-definitions/${id}`, { method: 'PUT', body: JSON.stringify(body) });

/** Users — the admin can edit an account (role, manager, status, etc.). */
export const updateUser = (id: string, body: Record<string, unknown>) =>
  apiFetch(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(body) });

/** Company directory. */
export const createCompany = (body: Record<string, unknown>) =>
  apiFetch('/api/companies', { method: 'POST', body: JSON.stringify(body) });

export const updateCompany = (id: string, body: Record<string, unknown>) =>
  apiFetch(`/api/companies/${id}`, { method: 'PUT', body: JSON.stringify(body) });

/** One row of a parsed historical-import CSV, already resolved to a requestor. */
export interface HistoricalImportRecord {
  requestor_id: string;
  total_amount: number;
  expense_category: string;
  remarks?: string;
  created_at?: string;
  lineItems: Array<{
    expense_date: string;
    vendor: string;
    category: string;
    amount: number;
    payment_method: string;
    business_purpose: string;
  }>;
}

/** Admin: bulk-create historical (already-completed) claims from a parsed import file. */
export const importHistoricalClaims = (filename: string, records: HistoricalImportRecord[]) =>
  apiFetch('/api/imports', {
    method: 'POST',
    body: JSON.stringify({ filename, records }),
  });

export async function uploadFile(file: File): Promise<{ url: string; filename: string }> {
  const form = new FormData();
  form.append('file', file);
  // Content-Type is omitted deliberately so the browser sets the multipart boundary.
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'X-User-Id': getCurrentUserId() },
    body: form,
  });
  if (!res.ok) throw new Error('Upload failed');
  return res.json();
}
