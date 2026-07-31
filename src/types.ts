export enum UserRole {
  REQUESTOR = 'Requestor',
  APPROVER = 'Approver',
  CUSTODIAN = 'Custodian',
  FINANCE = 'Finance',
  ADMIN = 'Admin'
}

export enum ClaimStatus {
  DRAFT = 'Draft',
  SUBMITTED = 'Submitted',
  REVIEW_MEETING_SCHEDULED = 'Review Meeting Scheduled',
  PENDING_APPROVAL = 'Pending Approval',
  APPROVED = 'Approved',
  PROCESSING = 'Processing',
  READY_FOR_CLAIM = 'Ready for Claim',
  COMPLETED = 'Completed',
  REJECTED = 'Rejected',
  RETURNED = 'Returned for Revision',
  // Cash Advance / Liquidation specific
  RELEASED = 'Released',
  LIQUIDATED = 'Liquidated',
  REVIEWED = 'Reviewed',
  CLOSED = 'Closed'
}

export enum DelegationStatus {
  PENDING = 'Pending',
  ACTIVE = 'Active',
  DECLINED = 'Declined',
  EXPIRED = 'Expired',
  CANCELLED = 'Cancelled'
}

export enum ReviewMeetingStatus {
  PENDING_CONFIRMATION = 'PendingConfirmation',
  CONFIRMED = 'Confirmed',
  DECLINE_REQUESTED = 'DeclineRequested',
  COMPLETED = 'Completed'
}

export enum SupportRequestStatus {
  OPEN = 'Open',
  IN_PROGRESS = 'In Progress',
  RESOLVED = 'Resolved'
}

export enum MinutesSource {
  TEMPLATE = 'Template',
  UPLOADED = 'Uploaded'
}

/** The kind of meeting document anchoring a claim: minutes of a meeting, or a
 *  letter of agreement. Same record shape, different intent and labelling. */
export type MomDocumentType = 'MoM' | 'LOA';

/** Human labels for a document type — used in headings, badges and pickers. */
export const DOCUMENT_TYPE_LABEL: Record<MomDocumentType, string> = {
  MoM: 'Minutes of Meeting',
  LOA: 'Letter of Agreement',
};

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
}

export interface Company {
  id: string;
  name: string;
  industry?: string;
  notes?: string;
  address?: string;
  contactPerson?: string;
  contactEmail?: string;
}

export const FIELD_ENTITIES = [
  { value: 'mom', label: 'Meeting Minutes (MOM)' },
  { value: 'claim', label: 'Claim (Reimbursement / Cash Advance / Liquidation)' },
] as const;
export type FieldDefinitionEntity = typeof FIELD_ENTITIES[number]['value'];

export type FieldInputType = 'text' | 'number' | 'dropdown' | 'date' | 'textarea';

export interface FieldDefinition {
  id: string;
  entity: FieldDefinitionEntity;
  key: string;
  label: string;
  input_type: FieldInputType;
  required: boolean;
  active: boolean;
  default_value?: string;
  display_order: number;
  options?: string[];
  master_data_entity?: string;
  allow_other?: boolean;
  applicableClaimTypes?: ClaimType[];
  validation?: {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
  };
}

export interface NotificationPrefs {
  submitted: { inApp: boolean; teams: boolean; email?: boolean };
  approved: { inApp: boolean; teams: boolean; email?: boolean };
  returned: { inApp: boolean; teams: boolean; email?: boolean };
  ready: { inApp: boolean; teams: boolean; email?: boolean };
  delegation: { inApp: boolean; teams: boolean; email?: boolean };
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  jobTitle: string;
  reportsTo?: string; // User ID
  employmentStatus: 'Active' | 'Inactive';
  canApproveReimbursements: boolean;
  avatarUrl?: string;
  notificationPrefs?: NotificationPrefs;
}

export interface ExpenseLineItem {
  id: string;
  claimId: string;
  expenseDate: string;
  vendor: string;
  category: string;
  amount: number;
  paymentMethod: string;
  businessPurpose: string;
  receiptUrl?: string;
  receiptFileName?: string;
  orNumber?: string;
}

export interface MOM {
  id: string;
  claimId: string;
  requestorId?: string;
  documentType?: MomDocumentType;
  meetingDate?: string;
  status?: string;
  source?: MinutesSource;
  fileUrl?: string;
  fileName?: string;
  typeOfAccount?: string;
  companyName?: string;
  purposeOfMeeting?: string;
  category?: string;
  location?: string;
  contactPerson?: string;
  contactPersonDesignation?: string;
  contactPersonEmail?: string;
  ccClient?: boolean;
  description?: string;
  agreements?: string;
  actionItems?: string;
  preparedBy?: string;
  summary?: string;
  meetingType?: string;
  participantsInternal?: string;
  participantsExternal?: string;
  customFields?: Record<string, string>;
}

export interface ReviewMeeting {
  id: string;
  claimId: string;
  meetingDate: string;
  meetingTime: string;
  approverId: string;
  status: ReviewMeetingStatus;
  // Enriched by the API for display — not stored fields.
  requestorId?: string;
  requestorName?: string;
  approverName?: string;
  claimNumber?: string;
  declineReason?: string;
}

export interface Approval {
  id: string;
  claimId: string;
  approverId: string;
  decision: 'Approved' | 'Rejected' | 'Returned';
  comment?: string;
  timestamp: string;
}

export interface StatusHistory {
  id: string;
  claimId: string;
  oldStatus?: ClaimStatus;
  newStatus: ClaimStatus;
  changedBy: string; // User ID
  timestamp: string;
  comment?: string;
}

export type ClaimType = 'Reimbursement' | 'Transport Reimbursement' | 'Cash Advance' | 'Liquidation';

export interface Claim {
  id: string;
  ref: string;
  requestorId: string;
  status: ClaimStatus;
  total: number;
  /** Amount originally requested/reported. `total` remains as a compatibility alias. */
  claimedAmount: number;
  /** Amount approved for release. Undefined until an approval/review decision exists. */
  approvedAmount?: number;
  /** Amount actually released. Liquidation spend is never counted a second time here. */
  paidAmount: number;
  submittedAt?: string;
  approvedAt?: string;
  paidAt?: string;
  completedAt?: string;
  createdAt: string;
  type: ClaimType;
  reimbursementType?: 'Standard' | 'Transport';
  purpose: string; // derived from MOM usually, but useful at top level
  client?: string;
  location?: string;
  
  // Custom flags
  flaggedHighValue?: boolean;
  
  // Custodian processing
  releaseCode?: string;
  paymentReference?: string;
  paymentMethod?: string;
  processedBy?: string;
  processingDate?: string;
  
  // Cash Advance / Liquidation specifics
  approverId?: string;
  releasedBy?: string;
  releaseDate?: string;
  releaseReference?: string;
  reminderSent?: boolean;
  cashAdvanceId?: string; // For liquidation
  varianceAmount?: number;
  varianceType?: 'Settled' | 'RefundDue' | 'ReimbursementDue';
  
  // Org sync routing
  approverStaleSince?: string;
  approverStaleReason?: string;
  pendingTransferTo?: string;
  escalatedToAdmin?: boolean;
  
  // Historical Import
  importBatchId?: string;
  customFields?: Record<string, string>;
}

export interface Notification {
  id: string;
  recipientId: string;
  from?: string;
  to?: string;
  subject?: string;
  claimId?: string;
  type: 'heads_up' | 'confirmation' | 'calendar_invite' | 'actionable' | 'approved' | 'processing' | 'rejected' | 'returned';
  read: boolean;
  timestamp: string;
  message: string;
}

export interface MasterData {
  id: string;
  type: 'department' | 'costCenter' | 'businessUnit' | 'branch' | 'projectCode' | 'vendor';
  name: string;
  code?: string;
  active: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupportRequestMessage {
  id: string;
  senderId: string;
  message: string;
  timestamp: string;
}

export interface SupportRequest {
  id: string;
  requestorId: string;
  subject: string;
  description: string;
  relatedEntityType?: 'Claim' | 'CashAdvance' | 'Liquidation' | 'MOM';
  relatedEntityId?: string;
  priority: 'Low' | 'Medium' | 'High';
  status: SupportRequestStatus;
  assignedAdminId?: string;
  createdAt: string;
  updatedAt: string;
  messages: SupportRequestMessage[];
}

export interface ImportBatch {
  id: string;
  adminId: string;
  filename: string;
  totalRecords: number;
  importedAt: string;
}

/** A system-generated email, as served by /api/outbox. */
export interface SystemEmail {
  id: string;
  recipientId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  channel?: 'Email' | 'Teams';
  deliveryStatus?: 'Logged' | 'Delivered' | 'Failed';
  read: boolean;
  timestamp: string;
  channel?: 'Email' | 'Teams';
}
