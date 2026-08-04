/**
 * Persistence for cash advances, liquidations, and liquidation line items —
 * third domain migrated per docs/DATABASE-MIGRATION.md's order (users, then
 * the core reimbursement loop, then this).
 *
 * Same pattern as coreLoopRepo.ts: targeted upserts per mutation (this
 * domain can also grow to hundreds of rows, so no whole-array sync like
 * users.ts), boot-time load only replaces the in-memory arrays when
 * DEMO_MODE=false, and every real route writes through to Postgres
 * regardless of DEMO_MODE. See coreLoopRepo.ts's file header for the full
 * rationale — it applies identically here.
 */
import { eq, or, isNotNull } from 'drizzle-orm';
import { getDb } from './index';
import { cashAdvances as cashAdvancesTable, liquidations as liquidationsTable, liquidationLineItems as liquidationLineItemsTable, statusHistories as statusHistoriesTable } from './schema';
import type { CashAdvance, Liquidation, LiquidationLineItem, StatusHistory } from '../serverTypes';
import { CashAdvanceStatus, LiquidationStatus, LiquidationVarianceType } from '../serverTypes';

export const isDbConfigured = () => !!process.env.DATABASE_URL;

// --- cash advances ----------------------------------------------------

function cashAdvanceToRow(c: CashAdvance) {
  return {
    id: c.id,
    requestorId: c.requestorId,
    amount: String(c.amount),
    purpose: c.purpose,
    momId: c.momId ?? null,
    approverId: c.approverId,
    approvedAt: c.approvedAt ? new Date(c.approvedAt) : null,
    paidAmount: c.paidAmount !== undefined ? String(c.paidAmount) : null,
    releasedBy: c.releasedBy ?? null,
    releaseDate: c.releaseDate ? new Date(c.releaseDate) : null,
    releaseReference: c.releaseReference ?? null,
    releaseMethod: c.releaseMethod ?? null,
    status: c.status,
    reminderSent: c.reminderSent ?? false,
  };
}

function cashAdvanceFromRow(r: typeof cashAdvancesTable.$inferSelect): CashAdvance {
  return {
    id: r.id,
    requestorId: r.requestorId,
    amount: Number(r.amount),
    purpose: r.purpose,
    momId: r.momId ?? undefined,
    approverId: r.approverId,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : undefined,
    paidAmount: r.paidAmount !== null ? Number(r.paidAmount) : undefined,
    releasedBy: r.releasedBy ?? undefined,
    releaseDate: r.releaseDate ? r.releaseDate.toISOString() : undefined,
    releaseReference: r.releaseReference ?? undefined,
    releaseMethod: r.releaseMethod ?? undefined,
    status: r.status as CashAdvanceStatus,
    reminderSent: r.reminderSent ?? undefined,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Upserts one cash advance row. Call before persisting a liquidation that references it. */
export async function persistCashAdvance(cashAdvance: CashAdvance): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  const row = cashAdvanceToRow(cashAdvance);
  await db.insert(cashAdvancesTable).values({ ...row, createdAt: new Date(cashAdvance.createdAt) })
    .onConflictDoUpdate({ target: cashAdvancesTable.id, set: row });
}

// --- liquidations -------------------------------------------------------

function liquidationToRow(l: Liquidation) {
  return {
    id: l.id,
    cashAdvanceId: l.cashAdvanceId,
    requestorId: l.requestorId,
    totalSpent: String(l.totalSpent),
    varianceAmount: String(l.varianceAmount),
    varianceType: l.varianceType,
    status: l.status,
    refundMethod: l.refundMethod ?? null,
  };
}

function liquidationFromRow(r: typeof liquidationsTable.$inferSelect): Liquidation {
  return {
    id: r.id,
    cashAdvanceId: r.cashAdvanceId,
    requestorId: r.requestorId,
    totalSpent: Number(r.totalSpent),
    varianceAmount: Number(r.varianceAmount),
    varianceType: r.varianceType as LiquidationVarianceType,
    status: r.status as LiquidationStatus,
    createdAt: r.createdAt.toISOString(),
    refundMethod: r.refundMethod ?? undefined,
  };
}

/** Upserts one liquidation row. Call after its cash advance already exists. */
export async function persistLiquidation(liquidation: Liquidation): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  const row = liquidationToRow(liquidation);
  await db.insert(liquidationsTable).values({ ...row, createdAt: new Date(liquidation.createdAt) })
    .onConflictDoUpdate({ target: liquidationsTable.id, set: row });
}

// --- liquidation line items ------------------------------------------------

function lineItemToRow(item: LiquidationLineItem) {
  return {
    id: item.id,
    liquidationId: item.liquidationId,
    expenseDate: item.expense_date,
    vendor: item.vendor,
    category: item.category,
    amount: String(item.amount),
    paymentMethod: item.payment_method,
    businessPurpose: item.business_purpose,
    receiptUrl: item.receipt_url ?? null,
    attachmentType: item.attachment_type ?? null,
    orNumber: item.or_number ?? null,
  };
}

function lineItemFromRow(r: typeof liquidationLineItemsTable.$inferSelect): LiquidationLineItem {
  return {
    id: r.id,
    liquidationId: r.liquidationId,
    expense_date: r.expenseDate,
    vendor: r.vendor,
    category: r.category,
    amount: Number(r.amount),
    payment_method: r.paymentMethod,
    business_purpose: r.businessPurpose,
    receipt_url: r.receiptUrl ?? undefined,
    attachment_type: r.attachmentType ?? undefined,
    or_number: r.orNumber ?? undefined,
  };
}

/**
 * Replaces every line item for one liquidation. Mirrors
 * coreLoopRepo.ts's persistExpenseLineItems — line items are always set as
 * a whole set from the in-memory array, so delete-then-reinsert is simplest.
 */
export async function persistLiquidationLineItems(liquidationId: string, items: LiquidationLineItem[]): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  await db.transaction(async (tx: typeof db) => {
    await tx.delete(liquidationLineItemsTable).where(eq(liquidationLineItemsTable.liquidationId, liquidationId));
    for (const item of items) {
      await tx.insert(liquidationLineItemsTable).values(lineItemToRow(item));
    }
  });
}

/** Upserts a single line item (add/edit one row without touching the rest of the set). */
export async function persistLiquidationLineItem(item: LiquidationLineItem): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  const row = lineItemToRow(item);
  await db.insert(liquidationLineItemsTable).values(row).onConflictDoUpdate({ target: liquidationLineItemsTable.id, set: row });
}

export async function deleteLiquidationLineItem(itemId: string): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  await db.delete(liquidationLineItemsTable).where(eq(liquidationLineItemsTable.id, itemId));
}

/**
 * Deletes every cash advance/liquidation/line-item row. Used only by
 * POST /api/admin/reset — status_histories is cleared once, wholesale, by
 * coreLoopRepo.ts's clearCoreLoopInDb(), not here (avoids a redundant
 * second delete of the same shared table).
 */
export async function clearCashAdvanceLoopInDb(): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  await db.transaction(async (tx: typeof db) => {
    await tx.delete(liquidationLineItemsTable);
    await tx.delete(liquidationsTable);
    await tx.delete(cashAdvancesTable);
  });
}

// --- boot-time load (DEMO_MODE=false only — see file header) --------------

function historyFromRow(r: typeof statusHistoriesTable.$inferSelect): StatusHistory {
  return {
    id: r.id,
    claim_id: '',
    cash_advance_id: r.cashAdvanceId ?? undefined,
    liquidation_id: r.liquidationId ?? undefined,
    old_status: r.oldStatus,
    new_status: r.newStatus,
    changed_by: r.changedBy,
    reason: r.reason ?? undefined,
    timestamp: r.timestamp.toISOString(),
  };
}

export async function loadCashAdvanceLoopFromDb(): Promise<{
  cashAdvances: CashAdvance[]; liquidations: Liquidation[]; liquidationLineItems: LiquidationLineItem[]; statusHistories: StatusHistory[];
}> {
  if (!isDbConfigured()) return { cashAdvances: [], liquidations: [], liquidationLineItems: [], statusHistories: [] };
  const db = getDb();
  const [caRows, liqRows, lineItemRows, historyRows] = await Promise.all([
    db.select().from(cashAdvancesTable),
    db.select().from(liquidationsTable),
    db.select().from(liquidationLineItemsTable),
    db.select().from(statusHistoriesTable).where(or(isNotNull(statusHistoriesTable.cashAdvanceId), isNotNull(statusHistoriesTable.liquidationId))),
  ]);
  return {
    cashAdvances: caRows.map(cashAdvanceFromRow),
    liquidations: liqRows.map(liquidationFromRow),
    liquidationLineItems: lineItemRows.map(lineItemFromRow),
    statusHistories: historyRows.map(historyFromRow),
  };
}
