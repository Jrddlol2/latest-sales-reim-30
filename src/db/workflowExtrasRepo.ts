/**
 * Persistence for approver delegations, review meetings, and support
 * requests/messages — real user-generated business data, migrated alongside
 * referenceDataRepo.ts as the last domain per docs/DATABASE-MIGRATION.md.
 *
 * Same pattern as the earlier repos: targeted upserts per mutation,
 * boot-time load only replaces the in-memory arrays when DEMO_MODE=false,
 * every real route writes through regardless of DEMO_MODE.
 *
 * Deliberately NOT migrated in this pass (still in-memory only): the mock
 * email/Teams outbox (ephemeral notification log, not business data —
 * README already documents mock delivery as a pre-production item),
 * last_seen (per-user "have I viewed this" UI state, safe to lose), and
 * import_batches (admin historical-import log, low value relative to the
 * effort of also migrating the import records it summarizes).
 */
import { isNotNull } from 'drizzle-orm';
import { getDb } from './index';
import {
  approverDelegations as delegationsTable, reviewMeetings as reviewMeetingsTable,
  supportRequests as supportRequestsTable, supportRequestMessages as supportMessagesTable,
  statusHistories as statusHistoriesTable,
} from './schema';
import type { ApproverDelegation, ReviewMeeting, SupportRequest, SupportRequestMessage, StatusHistory } from '../serverTypes';
import { DelegationStatus, ReviewMeetingStatus, SupportRequestPriority, SupportRequestStatus } from '../serverTypes';

export const isDbConfigured = () => !!process.env.DATABASE_URL;

// --- approver delegations ---------------------------------------------

function delegationToRow(d: ApproverDelegation) {
  return {
    id: d.id,
    approverId: d.approver_id,
    delegateId: d.delegate_id,
    startDate: d.start_date,
    endDate: d.end_date,
    status: d.status,
    declineReason: d.decline_reason ?? null,
    createdBy: d.created_by,
  };
}

function delegationFromRow(r: typeof delegationsTable.$inferSelect): ApproverDelegation {
  return {
    id: r.id,
    approver_id: r.approverId,
    delegate_id: r.delegateId,
    start_date: r.startDate,
    end_date: r.endDate,
    status: r.status as DelegationStatus,
    decline_reason: r.declineReason ?? undefined,
    created_by: r.createdBy,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

export async function persistDelegation(delegation: ApproverDelegation): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  const row = delegationToRow(delegation);
  await db.insert(delegationsTable).values(row).onConflictDoUpdate({ target: delegationsTable.id, set: row });
}

export async function loadDelegationsFromDb(): Promise<ApproverDelegation[]> {
  if (!isDbConfigured()) return [];
  const db = getDb();
  const rows = await db.select().from(delegationsTable);
  return rows.map(delegationFromRow);
}

function delegationHistoryFromRow(r: typeof statusHistoriesTable.$inferSelect): StatusHistory {
  return {
    id: r.id,
    claim_id: '',
    delegation_id: r.delegationId ?? undefined,
    old_status: r.oldStatus,
    new_status: r.newStatus,
    changed_by: r.changedBy,
    reason: r.reason ?? undefined,
    timestamp: r.timestamp.toISOString(),
  };
}

export async function loadDelegationHistoryFromDb(): Promise<StatusHistory[]> {
  if (!isDbConfigured()) return [];
  const db = getDb();
  const rows = await db.select().from(statusHistoriesTable).where(isNotNull(statusHistoriesTable.delegationId));
  return rows.map(delegationHistoryFromRow);
}

// --- review meetings ----------------------------------------------------

function reviewMeetingToRow(m: ReviewMeeting) {
  return {
    id: m.id,
    claimId: m.claim_id,
    requestorId: m.requestor_id,
    approverId: m.approver_id,
    meetingDate: m.meeting_date,
    meetingTime: m.meeting_time,
    status: m.status,
    declineReason: m.decline_reason ?? null,
  };
}

function reviewMeetingFromRow(r: typeof reviewMeetingsTable.$inferSelect): ReviewMeeting {
  return {
    id: r.id,
    claim_id: r.claimId,
    requestor_id: r.requestorId,
    approver_id: r.approverId,
    meeting_date: r.meetingDate,
    meeting_time: r.meetingTime,
    status: r.status as ReviewMeetingStatus,
    decline_reason: r.declineReason ?? undefined,
    created_at: r.createdAt.toISOString(),
  };
}

/** Upserts one review meeting. Call after its claim already exists (claim_id has no DB FK, but always references a real persisted claim in practice). */
export async function persistReviewMeeting(meeting: ReviewMeeting): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  const row = reviewMeetingToRow(meeting);
  await db.insert(reviewMeetingsTable).values(row).onConflictDoUpdate({ target: reviewMeetingsTable.id, set: row });
}

export async function loadReviewMeetingsFromDb(): Promise<ReviewMeeting[]> {
  if (!isDbConfigured()) return [];
  const db = getDb();
  const rows = await db.select().from(reviewMeetingsTable);
  return rows.map(reviewMeetingFromRow);
}

// --- support requests + messages -------------------------------------------

function supportRequestToRow(s: SupportRequest) {
  return {
    id: s.id,
    requestorId: s.requestor_id,
    subject: s.subject,
    description: s.description,
    relatedEntityType: s.related_entity_type ?? null,
    relatedEntityId: s.related_entity_id ?? null,
    priority: s.priority,
    status: s.status,
    assignedAdminId: s.assigned_admin_id ?? null,
  };
}

function supportRequestFromRow(r: typeof supportRequestsTable.$inferSelect): SupportRequest {
  return {
    id: r.id,
    requestor_id: r.requestorId,
    subject: r.subject,
    description: r.description,
    related_entity_type: (r.relatedEntityType ?? undefined) as SupportRequest['related_entity_type'],
    related_entity_id: r.relatedEntityId ?? undefined,
    priority: r.priority as SupportRequestPriority,
    status: r.status as SupportRequestStatus,
    assigned_admin_id: r.assignedAdminId ?? undefined,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

export async function persistSupportRequest(request: SupportRequest): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  const row = supportRequestToRow(request);
  await db.insert(supportRequestsTable).values(row).onConflictDoUpdate({ target: supportRequestsTable.id, set: row });
}

function supportMessageToRow(m: SupportRequestMessage) {
  return {
    id: m.id,
    requestId: m.request_id,
    senderId: m.sender_id,
    message: m.message,
    timestamp: new Date(m.timestamp),
  };
}

function supportMessageFromRow(r: typeof supportMessagesTable.$inferSelect): SupportRequestMessage {
  return {
    id: r.id,
    request_id: r.requestId,
    sender_id: r.senderId,
    message: r.message,
    timestamp: r.timestamp.toISOString(),
  };
}

export async function insertSupportMessage(message: SupportRequestMessage): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  await db.insert(supportMessagesTable).values(supportMessageToRow(message)).onConflictDoNothing();
}

export async function loadSupportRequestsFromDb(): Promise<{ requests: SupportRequest[]; messages: SupportRequestMessage[] }> {
  if (!isDbConfigured()) return { requests: [], messages: [] };
  const db = getDb();
  const [requestRows, messageRows] = await Promise.all([
    db.select().from(supportRequestsTable),
    db.select().from(supportMessagesTable),
  ]);
  return {
    requests: requestRows.map(supportRequestFromRow),
    messages: messageRows.map(supportMessageFromRow),
  };
}

/**
 * Deletes every delegation, review meeting, and support request/message row.
 * Used only by POST /api/admin/reset — delegation-scoped status_histories is
 * cleared once, wholesale, by coreLoopRepo.ts's clearCoreLoopInDb(), not here.
 */
export async function clearWorkflowExtrasInDb(): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  await db.transaction(async (tx: typeof db) => {
    await tx.delete(supportMessagesTable);
    await tx.delete(supportRequestsTable);
    await tx.delete(reviewMeetingsTable);
    await tx.delete(delegationsTable);
  });
}
