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
import { eq, sql } from 'drizzle-orm';
import { getDb } from './index';
import { moms as momsTable, claims as claimsTable, expenseLineItems as expenseLineItemsTable, approvals as approvalsTable, statusHistories as statusHistoriesTable, importBatches as importBatchesTable } from './schema';
import type { Mom, Claim, ExpenseLineItem, Approval, StatusHistory, MomStatus, MinutesSource, ClaimStatus, ImportBatch } from '../serverTypes';

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
    releaseCodeExpiresAt: c.release_code_expires_at ? new Date(c.release_code_expires_at) : null,
    releaseCodeAttempts: c.release_code_attempts ?? 0,
    releaseCodeLockedUntil: c.release_code_locked_until ? new Date(c.release_code_locked_until) : null,
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
    release_code_expires_at: r.releaseCodeExpiresAt ? r.releaseCodeExpiresAt.toISOString() : undefined,
    release_code_attempts: r.releaseCodeAttempts ?? undefined,
    release_code_locked_until: r.releaseCodeLockedUntil ? r.releaseCodeLockedUntil.toISOString() : undefined,
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

/**
 * Persists a claim, its full set of expense line items, and any MOM
 * backfill(s) as one transaction — covers POST /api/claims (new submission,
 * one MOM) and the revise-and-resubmit route (claim + expenses, and up to
 * two MOMs when the requestor swapped which meeting the claim links to).
 * Previously these were separately-awaited upserts: a failure partway
 * through (e.g. the line-item insert) could leave a claim row committed
 * with no expenses, or expenses committed with a MOM link never backfilled.
 * Same write order as before (claim, then its line items, then MOM
 * backfill(s)) — the claim insert only needs each MOM row to already exist
 * (it references moms.id), which it does since a MOM is always created and
 * persisted before it can be selected/linked here; only the reverse link
 * (moms.claim_id) is backfilled after.
 */
export async function persistClaimWithLineItems(claim: Claim, items: ExpenseLineItem[], moms: Mom[] = []): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  await db.transaction(async (tx: typeof db) => {
    const claimRow = claimToRow(claim);
    await tx.insert(claimsTable).values(claimRow).onConflictDoUpdate({ target: claimsTable.id, set: claimRow });

    await tx.delete(expenseLineItemsTable).where(eq(expenseLineItemsTable.claimId, claim.id));
    for (const item of items) {
      await tx.insert(expenseLineItemsTable).values(expenseToRow(item));
    }

    for (const mom of moms) {
      const momRow = momToRow(mom);
      await tx.insert(momsTable).values(momRow).onConflictDoUpdate({ target: momsTable.id, set: momRow });
    }
  });
}

/**
 * Atomically allocates the next human-facing claim number from the
 * `claim_number_seq` Postgres sequence. Callers must only use this when
 * `isDbConfigured()` — Postgres's own sequence guarantee is what makes this
 * safe under concurrent requests and across restarts, unlike the in-memory
 * counter server.ts falls back to when no database is configured.
 */
export async function nextClaimNumberFromDb(): Promise<string> {
  const db = getDb();
  const result: any = await db.execute(sql`select nextval('claim_number_seq') as val`);
  const val = Number(result.rows[0].val);
  const year = new Date().getFullYear();
  return `REIM-${year}-${String(val).padStart(6, '0')}`;
}

/**
 * Fast-forwards the sequence so the next `nextval()` returns at least
 * `minNextValue`. Used to keep the database sequence in step with the
 * in-memory `claimCounter` after the demo seed generator or an admin reset
 * moves that counter — without this, a live-database demo could hand out a
 * claim_number that collides with (or trails behind) numbers the seeded,
 * in-memory-only demo data already displays.
 */
export async function syncClaimNumberSequenceFloor(minNextValue: number): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  await db.execute(sql`select setval('claim_number_seq', ${minNextValue}, false)`);
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
// delegation_id / user_id / (master_data_key + master_data_id) is set per row
// (server.ts's addHistory/addCaHistory/addLiqHistory/addDelegationHistory/
// addUserHistory/addMasterDataHistory each set a different one, matching the
// union shape StatusHistory already has). This is the one row-serializer
// every insert path (persistStatusHistoryFireAndForget, the historical-import
// transaction) shares, so it must map every scope, not just the claim one —
// a hardcoded `userId: null` here previously dropped user- and master-data-
// scoped entries even though addUserHistory/addMasterDataHistory pushed them
// into the in-memory array correctly.

function historyToRow(h: StatusHistory) {
  return {
    id: h.id,
    claimId: h.claim_id || null,
    cashAdvanceId: h.cash_advance_id || null,
    liquidationId: h.liquidation_id || null,
    delegationId: h.delegation_id || null,
    userId: h.user_id || null,
    masterDataKey: h.master_data_key || null,
    masterDataId: h.master_data_id || null,
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
 * addLiqHistory/addDelegationHistory/addUserHistory/addMasterDataHistory
 * helpers, which together have ~20 call sites across routes not otherwise
 * touched in this migration pass (custodian decisions, reassignment, admin
 * user edits, master-data edits, etc.). Making those helpers async would
 * ripple into all of them; the underlying record's own status (persisted via
 * persistClaim/persistCashAdvance/persistLiquidation/syncUsersToDb/
 * persistMasterDataRecord, always awaited) is the source of truth, so a
 * dropped audit row on a transient DB blip is an acceptable, self-logged
 * degradation rather than a reason to block the response.
 */
export function persistStatusHistoryFireAndForget(entry: StatusHistory): void {
  const hasScope = entry.claim_id || entry.cash_advance_id || entry.liquidation_id
    || entry.delegation_id || entry.user_id || (entry.master_data_key && entry.master_data_id);
  if (!isDbConfigured() || !hasScope) return;
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

// --- historical import (insert-only, one transaction per batch) -----------

function importBatchToRow(b: ImportBatch) {
  return {
    id: b.id,
    adminId: b.admin_id,
    filename: b.filename,
    totalRecords: b.total_records,
    importedAt: new Date(b.imported_at),
  };
}

/**
 * Persists one Historical Import batch — the batch row, every imported
 * claim and its line items, and the accompanying status-history entries —
 * as a single transaction. All-or-nothing: if any row fails (e.g. a
 * duplicate claim_number colliding with the unique constraint), the whole
 * batch rolls back instead of leaving a partially-imported, uncommitted
 * batch that only "exists" in the caller's in-memory arrays.
 */
export async function persistHistoricalImportBatch(
  batch: ImportBatch,
  claimsToInsert: Claim[],
  expensesToInsert: ExpenseLineItem[],
  historyToInsert: StatusHistory[],
): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  await db.transaction(async (tx: typeof db) => {
    await tx.insert(importBatchesTable).values(importBatchToRow(batch));
    for (const claim of claimsToInsert) {
      await tx.insert(claimsTable).values(claimToRow(claim));
    }
    for (const item of expensesToInsert) {
      await tx.insert(expenseLineItemsTable).values(expenseToRow(item));
    }
    for (const entry of historyToInsert) {
      await tx.insert(statusHistoriesTable).values(historyToRow(entry));
    }
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
