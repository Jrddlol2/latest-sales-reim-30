/**
 * Drizzle schema for Phase 3's persistent-database migration
 * (docs/PROTOTYPE-AUDIT.md, PRODUCTION-PASS #3, P0). Mirrors every in-memory
 * collection in server.ts / src/serverTypes.ts, table for table — this is
 * schema + migrations only; server.ts still runs on the in-memory arrays
 * until a live DATABASE_URL exists to test the swap against (see
 * src/db/index.ts and docs/DATABASE-MIGRATION.md for what's left).
 *
 * DB columns are snake_case (idiomatic Postgres, and it's what server.ts's
 * wire format already uses for most entities); JS/TS property names are
 * camelCase throughout (idiomatic Drizzle) regardless of which casing the
 * historical serverTypes.ts interface happened to use for that entity.
 */
import {
  pgTable, pgEnum, text, integer, boolean, numeric, timestamp, primaryKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// --- enums ------------------------------------------------------------

export const userRoleEnum = pgEnum('user_role', ['Requestor', 'Approver', 'Custodian', 'Finance', 'Admin']);
export const employmentStatusEnum = pgEnum('employment_status', ['Active', 'Inactive']);
export const delegationStatusEnum = pgEnum('delegation_status', ['Pending', 'Active', 'Declined', 'Expired', 'Cancelled']);
export const momStatusEnum = pgEnum('mom_status', ['Draft', 'Completed']);
export const minutesSourceEnum = pgEnum('minutes_source', ['Template', 'Uploaded']);
export const momDocumentTypeEnum = pgEnum('mom_document_type', ['MoM', 'LOA']);
export const fieldEntityEnum = pgEnum('field_entity', ['mom', 'claim']);
export const fieldInputTypeEnum = pgEnum('field_input_type', ['text', 'number', 'dropdown', 'date', 'textarea']);
export const reviewMeetingStatusEnum = pgEnum('review_meeting_status', [
  'PendingConfirmation', 'Confirmed', 'DeclineRequested', 'Completed',
]);
export const claimStatusEnum = pgEnum('claim_status', [
  'Draft', 'Pending Approval', 'Approved', 'Processing', 'Ready for Claim',
  'Completed', 'Rejected', 'Returned',
]);
export const approvalDecisionEnum = pgEnum('approval_decision', ['Approved', 'Rejected', 'Returned']);
export const cashAdvanceStatusEnum = pgEnum('cash_advance_status', [
  'Draft', 'Submitted', 'Approved', 'Rejected', 'Released', 'Liquidated',
]);
export const liquidationVarianceTypeEnum = pgEnum('liquidation_variance_type', ['Settled', 'RefundDue', 'ReimbursementDue']);
export const liquidationStatusEnum = pgEnum('liquidation_status', [
  'Draft', 'Submitted', 'ReturnedForRevision', 'Reviewed', 'Closed',
]);
export const supportPriorityEnum = pgEnum('support_priority', ['Low', 'Medium', 'High']);
export const supportStatusEnum = pgEnum('support_status', ['Open', 'In Progress', 'Resolved']);

// --- identity -----------------------------------------------------------

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  role: userRoleEnum('role').notNull(),
  department: text('department').notNull(),
  jobTitle: text('job_title'),
  // Self-referencing FK — AnyPgColumn is Drizzle's documented workaround for
  // referencing a table from within its own column definition.
  reportsTo: text('reports_to').references((): AnyPgColumn => users.id),
  employmentStatus: employmentStatusEnum('employment_status').default('Active'),
  canApproveReimbursements: boolean('can_approve_reimbursements').default(false),
  notificationPrefs: text('notification_prefs'), // JSON-serialized Record<string, {inApp, email}>
  avatarUrl: text('avatar_url'),
  // Phase 3 (O365/Entra ID) join keys — see server.ts's getUser() and
  // docs/PROTOTYPE-AUDIT.md's O365 section. Fake-but-stable today.
  entraObjectId: text('entra_object_id').unique(),
  userPrincipalName: text('user_principal_name').unique(),
});

export const approverDelegations = pgTable('approver_delegations', {
  id: text('id').primaryKey(),
  approverId: text('approver_id').notNull().references(() => users.id),
  delegateId: text('delegate_id').notNull().references(() => users.id),
  startDate: text('start_date').notNull(), // date-only string, e.g. "2026-01-15"
  endDate: text('end_date').notNull(),
  status: delegationStatusEnum('status').notNull(),
  declineReason: text('decline_reason'),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- minutes of meeting ---------------------------------------------------

export const moms = pgTable('moms', {
  id: text('id').primaryKey(),
  // A MOM is created before the claim that links to it (claims.mom_id is
  // NOT NULL and required at claim-creation time); this side is nullable and
  // gets backfilled once that claim exists — breaks what would otherwise be
  // a circular NOT NULL <-> NOT NULL dependency between the two tables.
  claimId: text('claim_id').references((): AnyPgColumn => claims.id),
  requestorId: text('requestor_id').references(() => users.id),
  documentType: momDocumentTypeEnum('document_type').notNull().default('MoM'),
  client: text('client'),
  contactPerson: text('contact_person'),
  contactPersonEmail: text('contact_person_email'),
  ccClient: boolean('cc_client').notNull().default(false),
  meetingDate: text('meeting_date').notNull(),
  meetingTime: text('meeting_time'),
  location: text('location'),
  purpose: text('purpose'),
  discussion: text('discussion'),
  agreements: text('agreements'),
  actionItems: text('action_items'),
  preparedBy: text('prepared_by'),
  preparedByDepartment: text('prepared_by_department'),
  preparedByJobTitle: text('prepared_by_job_title'),
  summary: text('summary'),
  fileUrl: text('file_url'),
  fileName: text('file_name'),
  status: momStatusEnum('status').notNull().default('Draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  minutesSource: minutesSourceEnum('minutes_source').notNull().default('Template'),
  meetingType: text('meeting_type'),
  participantsInternal: text('participants_internal'),
  participantsExternal: text('participants_external'),
  customFields: text('custom_fields'), // JSON-serialized Record<string, string>
});

// --- dynamic field definitions (Master Data admin) ------------------------

export const fieldDefinitions = pgTable('field_definitions', {
  id: text('id').primaryKey(),
  entity: fieldEntityEnum('entity').notNull(),
  applicableClaimTypes: text('applicable_claim_types').array(), // ClaimType[]
  key: text('key').notNull(),
  label: text('label').notNull(),
  inputType: fieldInputTypeEnum('input_type').notNull(),
  required: boolean('required').notNull().default(false),
  active: boolean('active').notNull().default(true),
  defaultValue: text('default_value'),
  displayOrder: integer('display_order').notNull().default(0),
  options: text('options').array(), // static dropdown options
  masterDataEntity: text('master_data_entity'), // 'departments'|'costCenters'|'businessUnits'|'branches'|'projectCodes'|'vendors'
  allowOther: boolean('allow_other').default(false),
  validation: text('validation'), // JSON-serialized FieldValidationRule
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- review meetings --------------------------------------------------

export const reviewMeetings = pgTable('review_meetings', {
  id: text('id').primaryKey(),
  claimId: text('claim_id').notNull(), // FK to claims added below
  requestorId: text('requestor_id').notNull().references(() => users.id),
  approverId: text('approver_id').notNull().references(() => users.id),
  meetingDate: text('meeting_date').notNull(),
  meetingTime: text('meeting_time').notNull(),
  status: reviewMeetingStatusEnum('status').notNull(),
  declineReason: text('decline_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- claims (reimbursements) -----------------------------------------

export const claims = pgTable('claims', {
  id: text('id').primaryKey(),
  claimNumber: text('claim_number'), // e.g. "REIM-2026-000123"
  requestorId: text('requestor_id').notNull().references(() => users.id),
  currentApproverId: text('current_approver_id').notNull().references(() => users.id),
  originalApproverId: text('original_approver_id').references(() => users.id),
  momId: text('mom_id').references(() => moms.id),
  claimType: text('claim_type').notNull().default('Reimbursement'),
  status: claimStatusEnum('status').notNull(),
  totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
  approvedAmount: numeric('approved_amount', { precision: 12, scale: 2 }),
  paidAmount: numeric('paid_amount', { precision: 12, scale: 2 }),
  expenseCategory: text('expense_category'),
  receiptUrl: text('receipt_url'),
  remarks: text('remarks'),
  supportingDocuments: text('supporting_documents'),
  paymentReference: text('payment_reference'),
  paymentMethod: text('payment_method'),
  releaseCode: text('release_code'),
  flaggedHighValue: boolean('flagged_high_value').default(false),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  processedBy: text('processed_by').references(() => users.id),
  processingDate: timestamp('processing_date', { withTimezone: true }),
  sourceLiquidationId: text('source_liquidation_id').references((): AnyPgColumn => liquidations.id),
  importBatchId: text('import_batch_id').references((): AnyPgColumn => importBatches.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Simulated Entra ID hierarchy sync — docs/hierarchy-sync-design.md §5.
  approverStaleSince: timestamp('approver_stale_since', { withTimezone: true }),
  pendingTransferTo: text('pending_transfer_to').references(() => users.id),
  approverStaleReason: text('approver_stale_reason'),
  escalatedToAdmin: boolean('escalated_to_admin').default(false),
});

export const expenseLineItems = pgTable('expense_line_items', {
  id: text('id').primaryKey(),
  claimId: text('claim_id').notNull().references(() => claims.id),
  expenseDate: text('expense_date').notNull(),
  vendor: text('vendor').notNull(),
  category: text('category').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  paymentMethod: text('payment_method').notNull(),
  businessPurpose: text('business_purpose').notNull(),
  receiptUrl: text('receipt_url'),
  orNumber: text('or_number'),
});

export const approvals = pgTable('approvals', {
  id: text('id').primaryKey(),
  claimId: text('claim_id').notNull().references(() => claims.id),
  approverId: text('approver_id').notNull().references(() => users.id),
  decision: approvalDecisionEnum('decision').notNull(),
  comment: text('comment').notNull().default(''),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
});

// One shared immutable event feed across claims, cash advances,
// liquidations, delegations, and master data — exactly one of the *_id
// columns below is set per row, matching the union shape StatusHistory
// already has in serverTypes.ts.
export const statusHistories = pgTable('status_histories', {
  id: text('id').primaryKey(),
  claimId: text('claim_id').references(() => claims.id),
  cashAdvanceId: text('cash_advance_id').references((): AnyPgColumn => cashAdvances.id),
  liquidationId: text('liquidation_id').references((): AnyPgColumn => liquidations.id),
  delegationId: text('delegation_id').references(() => approverDelegations.id),
  userId: text('user_id').references(() => users.id),
  masterDataKey: text('master_data_key'),
  masterDataId: text('master_data_id'),
  oldStatus: text('old_status').notNull(),
  newStatus: text('new_status').notNull(),
  changedBy: text('changed_by').notNull(), // 'system' or a users.id — not FK'd so the literal 'system' stays valid
  reason: text('reason'),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
});

// --- import batches (Historical Import admin) -----------------------------

export const importBatches = pgTable('import_batches', {
  id: text('id').primaryKey(),
  adminId: text('admin_id').notNull().references(() => users.id),
  filename: text('filename').notNull(),
  totalRecords: integer('total_records').notNull(),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- company directory ------------------------------------------------

export const companies = pgTable('companies', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  industry: text('industry'),
  notes: text('notes'),
  address: text('address'),
  businessUnitId: text('business_unit_id').references((): AnyPgColumn => businessUnits.id),
  costCenterId: text('cost_center_id').references((): AnyPgColumn => costCenters.id),
  defaultDepartmentId: text('default_department_id').references((): AnyPgColumn => departments.id),
  currency: text('currency'),
  taxId: text('tax_id'),
  contactPerson: text('contact_person'),
  contactEmail: text('contact_email'),
  // Informational only — never read for approval routing. See serverTypes.ts's
  // own comment on this field; the DB layer must not add a code path that does.
  defaultApproverId: text('default_approver_id').references(() => users.id),
});

// --- master data catalogs -------------------------------------------------
// Six structurally-identical tables (not one polymorphic table) — matches the
// existing serverTypes.ts comment: "so it can grow entity-specific fields
// later without disturbing the others, and so each maps 1:1 to its own table
// if this ever becomes a real [ORM]-backed model." This is that migration.

const masterDataColumns = {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code'),
  active: boolean('active').notNull().default(true),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const departments = pgTable('departments', masterDataColumns);
export const costCenters = pgTable('cost_centers', masterDataColumns);
export const businessUnits = pgTable('business_units', masterDataColumns);
export const branches = pgTable('branches', masterDataColumns);
export const projectCodes = pgTable('project_codes', masterDataColumns);
export const vendors = pgTable('vendors', masterDataColumns);

// --- system emails (mock outbox) ---------------------------------------

export const emails = pgTable('emails', {
  id: text('id').primaryKey(),
  recipientId: text('recipient_id').notNull().references(() => users.id),
  from: text('from').notNull(),
  to: text('to').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  read: boolean('read').notNull().default(false),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
});

// --- cash advances & liquidations --------------------------------------

export const cashAdvances = pgTable('cash_advances', {
  id: text('id').primaryKey(),
  requestorId: text('requestor_id').notNull().references(() => users.id),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  purpose: text('purpose').notNull(),
  momId: text('mom_id').references(() => moms.id),
  approverId: text('approver_id').notNull().references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  paidAmount: numeric('paid_amount', { precision: 12, scale: 2 }),
  releasedBy: text('released_by').references(() => users.id),
  releaseDate: timestamp('release_date', { withTimezone: true }),
  releaseReference: text('release_reference'),
  releaseMethod: text('release_method'),
  status: cashAdvanceStatusEnum('status').notNull(),
  reminderSent: boolean('reminder_sent').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const liquidations = pgTable('liquidations', {
  id: text('id').primaryKey(),
  cashAdvanceId: text('cash_advance_id').notNull().references(() => cashAdvances.id),
  requestorId: text('requestor_id').notNull().references(() => users.id),
  totalSpent: numeric('total_spent', { precision: 12, scale: 2 }).notNull().default('0'),
  varianceAmount: numeric('variance_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  varianceType: liquidationVarianceTypeEnum('variance_type').notNull(),
  status: liquidationStatusEnum('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Refund-due variance: declared at submission, then the actual method the
  // custodian recorded on collection — see Liquidation.refundMethod's own
  // comment in serverTypes.ts.
  refundMethod: text('refund_method'),
});

export const liquidationLineItems = pgTable('liquidation_line_items', {
  id: text('id').primaryKey(),
  liquidationId: text('liquidation_id').notNull().references(() => liquidations.id),
  expenseDate: text('expense_date').notNull(),
  vendor: text('vendor').notNull(),
  category: text('category').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  paymentMethod: text('payment_method').notNull(),
  businessPurpose: text('business_purpose').notNull(),
  receiptUrl: text('receipt_url'),
  attachmentType: text('attachment_type'),
  orNumber: text('or_number'),
});

// --- support helpdesk ---------------------------------------------------

export const supportRequests = pgTable('support_requests', {
  id: text('id').primaryKey(),
  requestorId: text('requestor_id').notNull().references(() => users.id),
  subject: text('subject').notNull(),
  description: text('description').notNull(),
  relatedEntityType: text('related_entity_type'), // 'Claim'|'CashAdvance'|'Liquidation'|'MOM'
  relatedEntityId: text('related_entity_id'),
  priority: supportPriorityEnum('priority').notNull(),
  status: supportStatusEnum('status').notNull(),
  assignedAdminId: text('assigned_admin_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const supportRequestMessages = pgTable('support_request_messages', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull().references(() => supportRequests.id),
  senderId: text('sender_id').notNull().references(() => users.id),
  message: text('message').notNull(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
});

// --- system settings (singleton) & per-user "last seen" -----------------

// A single row (id = 'default') rather than a key/value table — mirrors the
// server's `systemSettings` object exactly, and there is and will only ever
// be one tenant's worth of settings in this prototype.
export const systemSettings = pgTable('system_settings', {
  id: text('id').primaryKey().default('default'),
  expenseCategories: text('expense_categories').array().notNull(),
  highValueThreshold: numeric('high_value_threshold', { precision: 12, scale: 2 }).notNull(),
  paymentMethods: text('payment_methods').array().notNull(),
  // JSON-serialized Record<string, number> — per-category reimbursement caps.
  // Currently always {} in practice (see server.ts's own comment on the
  // in-memory field) but is a real, admin-editable field via PUT
  // /api/admin/settings, so it needs a column like any other mutable state.
  categoryLimits: text('category_limits'),
});

// Replaces `lastSeenStore: Record<userId, Record<section, isoTimestamp>>` —
// one row per (user, section) instead of a nested object.
export const lastSeen = pgTable('last_seen', {
  userId: text('user_id').notNull().references(() => users.id),
  section: text('section').notNull(),
  seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.section] }),
}));
