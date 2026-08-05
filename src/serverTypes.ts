export enum UserRole {
  REQUESTOR = 'Requestor',
  APPROVER = 'Approver',
  CUSTODIAN = 'Custodian',
  FINANCE = 'Finance',
  ADMIN = 'Admin',
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  job_title?: string;
  reports_to: string | null; // ID of the Approver they report to

  // Simulated Entra ID hierarchy sync fields — see docs/hierarchy-sync-design.md.
  // reports_to above is the field that sync writes; these two track the
  // consequences of a sync-driven org-chart change (approval authority is
  // derived from headcount but Admin-overridable; employment status flags
  // departures so their pending approvals get escalated the same as a demotion).
  employment_status?: 'Active' | 'Inactive';
  can_approve_reimbursements?: boolean;
  notification_prefs?: Record<string, { inApp: boolean; email: boolean }>;
  avatar_url?: string;

  // Phase 3 (O365/Entra ID) prep — see docs/PROTOTYPE-AUDIT.md, "Target
  // integration: Office 365 / Microsoft Entra ID". These are the join keys a
  // validated Entra JWT will actually carry (`oid` claim, `preferred_username`
  // UPN); populating them on the seed now — even with fake values — means
  // getUser() and every id-shaped field below can resolve on them today, so
  // swapping the auth source later doesn't require touching the data model.
  entra_object_id?: string;
  user_principal_name?: string;
}

export enum DelegationStatus {
  PENDING = 'Pending',
  ACTIVE = 'Active',
  DECLINED = 'Declined',
  EXPIRED = 'Expired',
  CANCELLED = 'Cancelled',
}

export interface ApproverDelegation {
  id: string;
  approver_id: string;
  delegate_id: string;
  start_date: string;
  end_date: string;
  status: DelegationStatus;
  decline_reason?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  // Enriched by the API for display - not stored fields.
  approver?: User;
  delegate?: User;
}

export enum MomStatus {
  DRAFT = 'Draft',
  COMPLETED = 'Completed',
}

export enum MinutesSource {
  TEMPLATE = 'Template',
  UPLOADED = 'Uploaded',
}

export interface Mom {
  id: string;
  claim_id?: string;
  requestor_id?: string;
  /** 'MoM' (minutes of meeting) or 'LOA' (letter of agreement). Defaults to MoM. */
  document_type?: 'MoM' | 'LOA';
  client?: string;
  contact_person?: string;
  contact_person_email?: string;
  cc_client?: boolean;
  meeting_date: string;
  meeting_time?: string;
  location?: string;
  purpose?: string;
  discussion?: string;
  agreements?: string;
  action_items?: string;
  prepared_by?: string;
  prepared_by_department?: string;
  prepared_by_job_title?: string;
  summary?: string;
  file_url?: string;
  file_name?: string;
  status: MomStatus;
  created_at: string;
  minutes_source: MinutesSource;
  meeting_type?: string;
  participants_internal?: string;
  participants_external?: string;
  // Phase 2 MDM: admin-configured dynamic fields (see FieldDefinition below),
  // keyed by FieldDefinition.key. Additive — nothing reads/writes this until
  // a field definition for entity 'mom' exists.
  custom_fields?: Record<string, string>;
}

// Phase 2 MDM: admin-configurable form fields, rendered by
// src/components/DynamicFieldRenderer.tsx wherever an entity's form opts in.
// `entity` scopes a field to the form it appears on — only 'mom' is wired up
// so far (Type of Account / Category / Contact Person Designation, replacing
// the dead ClientMeetingDetails type), but the shape supports adding another
// entity's forms later without a new mechanism.
export type FieldInputType = 'text' | 'number' | 'dropdown' | 'date' | 'textarea';

export interface FieldValidationRule {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
}

export interface FieldDefinition {
  id: string;
  // 'claim' scopes a field to the reimbursement/advance/liquidation form; the
  // new UI relies on it, and applicableClaimTypes narrows a claim field to
  // specific types (empty/undefined = all).
  entity: 'mom' | 'claim';
  applicableClaimTypes?: ('Reimbursement' | 'Transport Reimbursement' | 'Cash Advance' | 'Liquidation')[];
  key: string;
  label: string;
  input_type: FieldInputType;
  required: boolean;
  active: boolean;
  default_value?: string;
  display_order: number;
  // Only meaningful when input_type === 'dropdown'. Exactly one of
  // `options` (static list) or `master_data_entity` (live-sourced from the
  // Phase 1 Master Data catalogs) should be set.
  options?: string[];
  master_data_entity?: 'departments' | 'costCenters' | 'businessUnits' | 'branches' | 'projectCodes' | 'vendors';
  // "Specify own value" fallback for a dropdown field, per CLAUDE.md's MOM
  // field spec (Category / Company Name allow this; Type of Account doesn't).
  allow_other?: boolean;
  validation?: FieldValidationRule;
  created_at: string;
  updated_at: string;
}

export enum ReviewMeetingStatus {
  PENDING_CONFIRMATION = 'PendingConfirmation', // Requestor proposed a time; Approver hasn't responded yet
  CONFIRMED = 'Confirmed',                      // Approver agreed to the proposed time
  DECLINE_REQUESTED = 'DeclineRequested',        // Approver declined; Requestor needs to propose a new time
  COMPLETED = 'Completed',                       // The meeting actually happened
}

export interface ReviewMeeting {
  id: string;
  claim_id: string;
  requestor_id: string;
  approver_id: string;
  meeting_date: string;
  meeting_time: string;
  status: ReviewMeetingStatus;
  decline_reason?: string;
  created_at: string;
}

export enum ClaimStatus {
  DRAFT = 'Draft',
  PENDING_APPROVAL = 'Pending Approval',
  APPROVED = 'Approved',
  PROCESSING = 'Processing',
  READY_FOR_CLAIM = 'Ready for Claim',
  COMPLETED = 'Completed',
  REJECTED = 'Rejected',
  RETURNED = 'Returned',
}

export interface ExpenseLineItem {
  id: string;
  claim_id: string;
  expense_date: string;
  vendor: string;
  category: string;
  amount: number;
  payment_method: string;
  business_purpose: string;
  receipt_url?: string;
  or_number?: string;
}

export interface Claim {
  id: string;
  claim_number?: string; // REIM-2026-000123
  requestor_id: string;
  current_approver_id: string;
  original_approver_id?: string;
  mom_id?: string;
  claim_type?: 'Reimbursement' | 'Transport Reimbursement';
  status: ClaimStatus;
  total_amount: number;
  approved_amount?: number;
  paid_amount?: number;
  expense_category?: string;
  receipt_url?: string;
  remarks?: string;
  supporting_documents?: string;
  payment_reference?: string;
  payment_method?: string;
  release_code?: string;
  flagged_high_value?: boolean;
  approved_at?: string;
  paid_at?: string;
  processed_by?: string;
  processing_date?: string;
  sourceLiquidationId?: string;
  import_batch_id?: string;
  created_at: string;
  updated_at: string;
  reviewMeeting?: ReviewMeeting; // enriched by GET /api/claims and GET /api/claims/:id

  // Set when the requestor's manager changes (simulated Entra ID sync) while
  // this claim is still Pending Approval under their old approver. See
  // docs/hierarchy-sync-design.md §5 — the claim stays with the old approver,
  // who is notified and can keep it or transfer to pending_transfer_to.
  approver_stale_since?: string | null;
  pending_transfer_to?: string | null;
  approver_stale_reason?: string;
  escalated_to_admin?: boolean;
}

export interface ImportBatch {
  id: string;
  admin_id: string;
  filename: string;
  total_records: number;
  imported_at: string;
}

export interface Approval {
  id: string;
  claim_id: string;
  approver_id: string;
  decision: 'Approved' | 'Rejected' | 'Returned';
  comment: string;
  timestamp: string;
}

export interface StatusHistory {  id: string;  claim_id: string;  cash_advance_id?: string;  liquidation_id?: string;  delegation_id?: string;  user_id?: string;  master_data_key?: string;  master_data_id?: string;  old_status: string;  new_status: string;  changed_by: string;  changedBy?: User;  reason?: string;  timestamp: string;}

export interface Company {
  id: string;
  name: string;
  industry?: string;
  notes?: string;
  // Phase 1 MDM enrichment — all optional, additive. Populates the "Company
  // Auto-Fill" behavior (see docs/hierarchy-sync-design.md-style ADRs) once a
  // form reads it; nothing reads these yet as of Phase 1.
  address?: string;
  business_unit_id?: string;
  cost_center_id?: string;
  default_department_id?: string;
  currency?: string;
  tax_id?: string;
  contact_person?: string;
  contact_email?: string;
  // Informational reference only — e.g. "usual account owner for this
  // client." Never read for claim approval routing, which is always derived
  // from the requestor's reports_to / an active ApproverDelegation per
  // CLAUDE.md's hard rule. No code path may branch on this field.
  default_approver_id?: string;
  // True for a company auto-created from free-text entry (a requestor typing
  // an unlisted client name) rather than deliberately added by an admin.
  // Surfaces in Company Directory as a to-review queue; never blocks the
  // company from being used on a claim/MoM in the meantime — set/cleared by
  // getOrCreateCompany() and the admin company routes in server.ts.
  pending_review?: boolean;
  created_by?: string;
}

// Shared shape for the generic Master Data catalog entities managed in the
// Admin > Master Data module (server.ts's registerMasterDataRoutes). Each
// entity below is intentionally a bare extension today (structurally
// identical) so it can grow entity-specific fields later without disturbing
// the others, and so each maps 1:1 to its own table if this ever becomes a
// real Prisma-backed model.
export interface MasterDataRecord {
  id: string;
  name: string;
  code?: string;
  active: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Department extends MasterDataRecord {}
export interface CostCenter extends MasterDataRecord {}
export interface BusinessUnit extends MasterDataRecord {}
export interface Branch extends MasterDataRecord {}
export interface ProjectCode extends MasterDataRecord {}
export interface Vendor extends MasterDataRecord {}

export interface Email {
  id: string;
  recipient_id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  read: boolean;
  timestamp: string;
  channel?: 'Email' | 'Teams';
}

export enum CashAdvanceStatus {
  DRAFT = 'Draft',
  SUBMITTED = 'Submitted',
  APPROVED = 'Approved',
  REJECTED = 'Rejected',
  RELEASED = 'Released',
  LIQUIDATED = 'Liquidated',
}

export interface CashAdvance {
  id: string;
  requestorId: string;
  amount: number;
  purpose: string;
  momId?: string;
  approverId: string;
  approvedAt?: string;
  paidAmount?: number;
  releasedBy?: string;
  releaseDate?: string;
  releaseReference?: string;
  releaseMethod?: string;
  status: CashAdvanceStatus;
  reminderSent?: boolean;
  createdAt: string;
}

export enum LiquidationVarianceType {
  SETTLED = 'Settled',
  REFUND_DUE = 'RefundDue',
  REIMBURSEMENT_DUE = 'ReimbursementDue',
}

export enum LiquidationStatus {
  DRAFT = 'Draft',
  SUBMITTED = 'Submitted',
  RETURNED_FOR_REVISION = 'ReturnedForRevision',
  REVIEWED = 'Reviewed',
  CLOSED = 'Closed',
}

export interface Liquidation {
  id: string;
  cashAdvanceId: string;
  requestorId: string;
  totalSpent: number;
  varianceAmount: number;
  varianceType: LiquidationVarianceType;
  status: LiquidationStatus;
  createdAt: string;
  /** For a refund-due variance: how the requestor said they'd return the balance
   *  (declared at submission), then the actual method the custodian recorded on
   *  collection. Surfaced to the custodian's Close Liquidation step. */
  refundMethod?: string;
}

export enum SupportRequestPriority {
  LOW = 'Low',
  MEDIUM = 'Medium',
  HIGH = 'High',
}

export enum SupportRequestStatus {
  OPEN = 'Open',
  IN_PROGRESS = 'In Progress',
  RESOLVED = 'Resolved',
}

export interface SupportRequestMessage {
  id: string;
  request_id: string;
  sender_id: string;
  message: string;
  timestamp: string;
}

export interface SupportRequest {
  id: string;
  requestor_id: string;
  subject: string;
  description: string;
  related_entity_type?: 'Claim' | 'CashAdvance' | 'Liquidation' | 'MOM';
  related_entity_id?: string;
  priority: SupportRequestPriority;
  status: SupportRequestStatus;
  assigned_admin_id?: string;
  created_at: string;
  updated_at: string;
}

export interface LiquidationLineItem {
  id: string;
  liquidationId: string;
  expense_date: string;
  vendor: string;
  category: string;
  amount: number;
  payment_method: string;
  business_purpose: string;
  receipt_url?: string;
  attachment_type?: string;
  or_number?: string;
}
