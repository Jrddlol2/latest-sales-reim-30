/**
 * Persistence for the reimbursement core loop — moms, claims,
 * expense_line_items, approvals, and claim-scoped status_histories. Second
 * domain migrated per docs/DATABASE-MIGRATION.md's order (users first, then
 * this).
 *
 * Unlike the small `users` table (see usersRepo.ts, whole-array sync), this
 * domain can grow to thousands of rows, so writes here are targeted —
 * upsert the one row a mutation touched, not the whole array.
 *
 * Boot-time load only replaces the in-memory arrays when DEMO_MODE=false
 * (server.ts): the seed generator (seedYearOfData) that runs while demoing
 * is deeply intertwined with the not-yet-migrated cash-advance/liquidation
 * seed logic in the same function, and unconditionally clears these same
 * arrays on every boot. Rather than risk a subtle bug threading a bypass
 * through that ~1400-line function, every real route still writes through to
 * Postgres regardless of DEMO_MODE — so real transactions are durable and
 * ready the moment DEMO_MODE actually flips to false at cutover — but the
 * demo experience itself (reseed-on-every-restart) is intentionally
 * unchanged for now. See docs/DATABASE-MIGRATION.md for the follow-up once
 * cash advances/liquidations are also migrated and the seed function can be
 * safely gated end to end.
 */
import { eq } from 'drizzle-orm';
import { getDb } from './index';
import { moms as momsTable, claims as claimsTable, expenseLineItems as expenseLineItemsTable, approvals as approvalsTable, statusHistories as statusHistoriesTable } from './schema';
import type { Mom, Claim, ExpenseLineItem, Approval, StatusHistory, MomStatus, MinutesSource, ClaimStatus } from '../serverTypes';

export const isDbConfigured = () => !!process.env.DATABASE_URL;

// --- moms -------------------------------------------------------------

function momToRow(m: Mom) {
  return {
    id: m.id,
    claimId: m.claim_id ?? null,
    requestorId: m.requestor_id ?? null,
    documentType: m.document_type === 'LOA' ? 'LOA' as const : 'MoM' as const,
    client: m.client ?? null,
    contactPerson: m.contact_person ?? null,
    contactPersonEmail: m.contact_person_email ?? null,
    ccClient: !!m.cc_client,
    meetingDate: m.meeting_date,
    meetingTime: m.meeting_time ?? null,
    location: m.location ?? null,
    purpose: m.purpose ?? null,
    discussion: m.discussion ?? null,
    agreements: m.agreements ?? null,
    actionItems: m.action_items ?? null,
    preparedBy: m.prepared_by ?? null,
    preparedByDepartment: m.prepared_by_department ?? null,
    preparedByJobTitle: m.prepared_by_job_title ?? null,
    summary: m.summary ?? null,
    fileUrl: m.file_url ?? null,
    fileName: m.file_name ?? null,
    status: m.status,
    minutesSource: m.minutes_source,
    meetingType: m.meeting_type ?? null,
    participantsInternal: m.participants_internal ?? null,
    participantsExternal: m.participants_external ?? null,
    customFields: m.custom_fields ? JSON.stringify(m.custom_fields) : null,
  };
}

function momFromRow(r: typeof momsTable.$inferSelect): Mom {
  return {
    id: r.id,
    claim_id: r.claimId ?? undefined,
    requestor_id: r.requestorId ?? undefined,
    document_type: r.documentType,
    client: r.client ?? undefined,
    contact_person: r.contactPerson ?? undefined,
    contact_person_email: r.contactPersonEmail ?? undefined,
    cc_client: r.ccClient,
    meeting_date: r.meetingDate,
    meeting_time: r.meetingTime ?? undefined,
    location: r.location ?? undefined,
    purpose: r.purpose ?? undefined,
    discussion: r.discussion ?? undefined,
    agreements: r.agreements ?? undefined,
    action_items: r.actionItems ?? undefined,
    prepared_by: r.preparedBy ?? undefined,
    prepared_by_department: r.preparedByDepartment ?? undefined,
    prepared_by_job_title: r.preparedByJobTitle ?? undefined,
    summary: r.summary ?? undefined,
    file_url: r.fileUrl ?? undefined,
    file_name: r.fileName ?? undefined,
    status: r.status as MomStatus,
    created_at: r.createdAt.toISOString(),
    minutes_source: r.minutesSource as MinutesSource,
    meeting_type: r.meetingType ?? undefined,
    participants_internal: r.participantsInternal ?? undefined,
    participants_external: r.participantsExternal ?? undefined,
    custom_fields: r.customFields ? JSON.parse(r.customFields) : undefined,
  };
}

/** Upserts one MOM row. Safe to call before its claim exists (claim_id nullable). */
export async function persistMom(mom: Mom): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  const row = momToRow(mom);
  await db.insert(momsTable).values(row).onConflictDoUpdate({ target: momsTable.id, set: row });
}

// --- claims -------------------------------------------------------------

function claimToRow(c: Claim) {
  return {
    id: c.id,
    claimNumber: c.claim_number ?? null,
    requestorId: c.requestor_id,
    currentApproverId: c.current_approver_id,
    originalApproverId: c.original_approver_id ?? null,
    // `|| null`, not `??`: some call sites (e.g. the liquidation shortfall
    // claim in server.ts) set mom_id to '' rather than leaving it undefined
    // when there's no MOM — an empty string would otherwise be sent as a
    // literal (nonexistent) FK value instead of NULL.
    momId: c.mom_id || null,
    claimType: c.claim_type ?? 'Reimbursement',
    status: c.status,
    totalAmount: String(c.total_amount),
    approvedAmount: c.approved_amount !== undefined ? String(c.approved_amount) : null,
    paidAmount: c.paid_amount !== undefined ? String(c.paid_amount) : null,
    expenseCategory: c.expense_category ?? null,
    receiptUrl: c.receipt_url ?? null,
    remarks: c.remarks ?? null,
    supportingDocuments: c.supporting_documents ?? null,
    paymentReference: c.payment_reference ?? null,
    paymentMethod: c.payment_method ?? null,
    releaseCode: c.release_code ?? null,
    flaggedHighValue: !!c.flagged_high_value,
    approvedAt: c.approved_at ? new Date(c.approved_at) : null,
    paidAt: c.paid_at ? new Date(c.paid_at) : null,
    processedBy: c.processed_by ?? null,
    processingDate: c.processing_date ? new Date(c.processing_date) : null,
    // Liquidations are migrated (cashAdvanceRepo.ts) and a claim's
    // sourceLiquidationId is only ever set to a liquidation that already
    // went through create->submit->review, so it's always persisted by the
    // time a claim references it. import_batches is not migrated yet, so
    // that FK would still violate — dropped until that domain lands.
    sourceLiquidationId: c.sourceLiquidationId ?? null,
    importBatchId: null,
    updatedAt: new Date(),
    approverStaleSince: c.approver_stale_since ? new Date(c.approver_stale_since) : null,
    pendingTransferTo: c.pending_transfer_to ?? null,
    approverStaleReason: c.approver_stale_reason ?? null,
    escalatedToAdmin: !!c.escalated_to_admin,
  };
}

function claimFromRow(r: typeof claimsTable.$inferSelect): Claim {
  return {
    id: r.id,
    claim_number: r.claimNumber ?? undefined,
    requestor_id: r.requestorId,
    current_approver_id: r.currentApproverId,
    original_approver_id: r.originalApproverId ?? undefined,
    mom_id: r.momId ?? undefined,
    claim_type: r.claimType as Claim['claim_type'],
    status: r.status as ClaimStatus,
    total_amount: Number(r.totalAmount),
    approved_amount: r.approvedAmount !== null ? Number(r.approvedAmount) : undefined,
    paid_amount: r.paidAmount !== null ? Number(r.paidAmount) : undefined,
    expense_category: r.expenseCategory ?? undefined,
    receipt_url: r.receiptUrl ?? undefined,
    remarks: r.remarks ?? undefined,
    supporting_documents: r.supportingDocuments ?? undefined,
    payment_reference: r.paymentReference ?? undefined,
    payment_method: r.paymentMethod ?? undefined,
    release_code: r.releaseCode ?? undefined,
    flagged_high_value: r.flaggedHighValue ?? undefined,
    approved_at: r.approvedAt ? r.approvedAt.toISOString() : undefined,
    paid_at: r.paidAt ? r.paidAt.toISOString() : undefined,
    processed_by: r.processedBy ?? undefined,
    processing_date: r.processingDate ? r.processingDate.toISOString() : undefined,
    sourceLiquidationId: r.sourceLiquidationId ?? undefined,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
    approver_stale_since: r.approverStaleSince ? r.approverStaleSince.toISOString() : null,
    pending_transfer_to: r.pendingTransferTo ?? null,
    approver_stale_reason: r.approverStaleReason ?? undefined,
    escalated_to_admin: r.escalatedToAdmin ?? undefined,
  };
}

/** Upserts one claim row. Call after its mom (if any) has already been persisted. */
export async function persistClaim(claim: Claim): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  const row = claimToRow(claim);
  await db.insert(claimsTable).values(row).onConflictDoUpdate({ target: claimsTable.id, set: row });
}

// --- expense line items ---------------------------------------------------

function expenseToRow(e: ExpenseLineItem) {
  return {
    id: e.id,
    claimId: e.claim_id,
    expenseDate: e.expense_date,
    vendor: e.vendor,
    category: e.category,
    amount: String(e.amount),
    paymentMethod: e.payment_method,
    businessPurpose: e.business_purpose,
    receiptUrl: e.receipt_url ?? null,
    orNumber: e.or_number ?? null,
  };
}

function expenseFromRow(r: typeof expenseLineItemsTable.$inferSelect): ExpenseLineItem {
  return {
    id: r.id,
    claim_id: r.claimId,
    expense_date: r.expenseDate,
    vendor: r.vendor,
    category: r.category,
    amount: Number(r.amount),
    payment_method: r.paymentMethod,
    business_purpose: r.businessPurpose,
    receipt_url: r.receiptUrl ?? undefined,
    or_number: r.orNumber ?? undefined,
  };
}

/**
 * Replaces every expense line item for one claim. Line items don't have
 * their own edit route today (a claim's items are set at creation/resubmit
 * time as a whole set) — delete-then-reinsert is simplest and matches that
 * "whole set" semantics exactly, without needing to diff individual rows.
 */
export async function persistExpenseLineItems(claimId: string, items: ExpenseLineItem[]): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  await db.transaction(async (tx: typeof db) => {
    await tx.delete(expenseLineItemsTable).where(eq(expenseLineItemsTable.claimId, claimId));
    for (const item of items) {
      await tx.insert(expenseLineItemsTable).values(expenseToRow(item));
    }
  });
}

// --- approvals (insert-only — an approval decision is never edited) -------

function approvalToRow(a: Approval) {
  return {
    id: a.id,
    claimId: a.claim_id,
    approverId: a.approver_id,
    decision: a.decision,
    comment: a.comment,
    timestamp: new Date(a.timestamp),
  };
}

function approvalFromRow(r: typeof approvalsTable.$inferSelect): Approval {
  return {
    id: r.id,
    claim_id: r.claimId,
    approver_id: r.approverId,
    decision: r.decision,
    comment: r.comment,
    timestamp: r.timestamp.toISOString(),
  };
}

export async function insertApproval(approval: Approval): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  await db.insert(approvalsTable).values(approvalToRow(approval)).onConflictDoNothing();
}

// --- status history (insert-only) ------------------------------------------
// Shared table: exactly one of claim_id / cash_advance_id / liquidation_id /
// delegation_id is set per row (server.ts's addHistory/addCaHistory/
// addLiqHistory/addDelegationHistory each set a different one, matching the
// union shape StatusHistory already has).

function historyToRow(h: StatusHistory) {
  return {
    id: h.id,
    claimId: h.claim_id || null,
    cashAdvanceId: h.cash_advance_id || null,
    liquidationId: h.liquidation_id || null,
    delegationId: h.delegation_id || null,
    userId: null,
    oldStatus: h.old_status,
    newStatus: h.new_status,
    changedBy: h.changed_by,
    reason: h.reason ?? null,
    timestamp: new Date(h.timestamp),
  };
}

function historyFromRow(r: typeof statusHistoriesTable.$inferSelect): StatusHistory {
  return {
    id: r.id,
    claim_id: r.claimId!,
    old_status: r.oldStatus,
    new_status: r.newStatus,
    changed_by: r.changedBy,
    reason: r.reason ?? undefined,
    timestamp: r.timestamp.toISOString(),
  };
}

/**
 * Fire-and-forget: called from server.ts's addHistory/addCaHistory/
 * addLiqHistory helpers, which together have ~15 call sites across routes
 * not otherwise touched in this migration pass (custodian decisions,
 * reassignment, etc.). Making those helpers async would ripple into all of
 * them; the underlying record's own status (persisted via persistClaim/
 * persistCashAdvance/persistLiquidation, always awaited) is the source of
 * truth, so a dropped audit row on a transient DB blip is an acceptable,
 * self-logged degradation rather than a reason to block the response.
 */
export function persistStatusHistoryFireAndForget(entry: StatusHistory): void {
  if (!isDbConfigured() || (!entry.claim_id && !entry.cash_advance_id && !entry.liquidation_id && !entry.delegation_id)) return;
  const db = getDb();
  db.insert(statusHistoriesTable).values(historyToRow(entry)).onConflictDoNothing()
    .catch((err: unknown) => console.error('[db] Could not persist status history entry:', err));
}

/**
 * Deletes every row in this domain, INCLUDING the entire shared
 * status_histories table (not just claim-scoped rows) — used only by
 * POST /api/admin/reset, which wipes every domain's history at once, so
 * there's no need for each domain's clear function to scope its own slice.
 * claims.mom_id and moms.claim_id reference each other, so claims' mom_id is
 * nulled first to break the cycle before either table is cleared.
 */
export async function clearCoreLoopInDb(): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  await db.transaction(async (tx: typeof db) => {
    await tx.delete(statusHistoriesTable);
    await tx.delete(expenseLineItemsTable);
    await tx.delete(approvalsTable);
    await tx.update(claimsTable).set({ momId: null });
    await tx.delete(momsTable);
    await tx.delete(claimsTable);
  });
}

// --- boot-time load (DEMO_MODE=false only — see file header) --------------

export async function loadCoreLoopFromDb(): Promise<{
  moms: Mom[]; claims: Claim[]; expenses: ExpenseLineItem[]; approvals: Approval[]; statusHistories: StatusHistory[];
}> {
  if (!isDbConfigured()) return { moms: [], claims: [], expenses: [], approvals: [], statusHistories: [] };
  const db = getDb();
  const [momRows, claimRows, expenseRows, approvalRows, historyRows] = await Promise.all([
    db.select().from(momsTable),
    db.select().from(claimsTable),
    db.select().from(expenseLineItemsTable),
    db.select().from(approvalsTable),
    db.select().from(statusHistoriesTable),
  ]);
  return {
    moms: momRows.map(momFromRow),
    claims: claimRows.map(claimFromRow),
    expenses: expenseRows.map(expenseFromRow),
    approvals: approvalRows.map(approvalFromRow),
    statusHistories: historyRows.filter((r: typeof statusHistoriesTable.$inferSelect) => r.claimId).map(historyFromRow),
  };
}
