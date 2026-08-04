/**
 * Persistence for the `users` table — the first domain migrated off the
 * in-memory arrays (docs/DATABASE-MIGRATION.md's recommended order: users
 * first, since almost everything else joins against it).
 *
 * Pattern: server.ts keeps its module-level `users: User[]` array as a live
 * in-process read cache (every existing synchronous `users.find(...)` call
 * site is untouched — zero read-path risk). Writes go through `syncUsersToDb`
 * so Postgres stays the durable source of truth; `loadUsersFromDb` populates
 * the cache at boot. This app runs as a single long-lived Node process (not
 * serverless), so a same-process cache kept in sync on every write is safe —
 * there's no second instance to diverge from.
 *
 * All functions are no-ops (loadUsersFromDb returns []; syncUsersToDb does
 * nothing) when DATABASE_URL isn't set, so the existing test suite — which
 * never sets it — keeps running purely in-memory with unchanged behavior.
 */
import { eq } from 'drizzle-orm';
import { getDb } from './index';
import { users as usersTable } from './schema';
import type { User } from '../serverTypes';

export const isDbConfigured = () => !!process.env.DATABASE_URL;

function toRow(u: User) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    department: u.department,
    jobTitle: u.job_title ?? null,
    reportsTo: u.reports_to ?? null,
    employmentStatus: u.employment_status ?? 'Active',
    canApproveReimbursements: u.can_approve_reimbursements ?? false,
    notificationPrefs: u.notification_prefs ? JSON.stringify(u.notification_prefs) : null,
    avatarUrl: u.avatar_url ?? null,
    entraObjectId: u.entra_object_id ?? null,
    userPrincipalName: u.user_principal_name ?? null,
  };
}

function fromRow(r: typeof usersTable.$inferSelect): User {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role as User['role'],
    department: r.department,
    job_title: r.jobTitle ?? undefined,
    reports_to: r.reportsTo,
    employment_status: (r.employmentStatus ?? undefined) as User['employment_status'],
    can_approve_reimbursements: r.canApproveReimbursements ?? undefined,
    notification_prefs: r.notificationPrefs ? JSON.parse(r.notificationPrefs) : undefined,
    avatar_url: r.avatarUrl ?? undefined,
    entra_object_id: r.entraObjectId ?? undefined,
    user_principal_name: r.userPrincipalName ?? undefined,
  };
}

/** Loads every user row from Postgres. Returns [] if no DATABASE_URL is set. */
export async function loadUsersFromDb(): Promise<User[]> {
  if (!isDbConfigured()) return [];
  const db = getDb();
  const rows = await db.select().from(usersTable);
  return rows.map(fromRow);
}

/**
 * Upserts every given user into Postgres. Called after any mutation to the
 * in-memory `users` array (role/department/reporting-line changes, seed,
 * reset) so the array and the database never drift. A per-row loop rather
 * than a single batch statement — users.length is small (dozens, not
 * thousands) and writes are infrequent (admin actions), so this trades a
 * little throughput for a simpler, easier-to-verify upsert.
 *
 * Two passes, one transaction: `reports_to` self-references another row in
 * this same table, and the org chart isn't topologically sorted (a manager
 * can come after their report in the array). Pass 1 upserts every row with
 * reports_to nulled out so no row can ever violate the FK by referencing a
 * manager that hasn't been inserted yet; pass 2 backfills the real
 * reports_to now that every id exists.
 */
export async function syncUsersToDb(users: User[]): Promise<void> {
  if (!isDbConfigured() || users.length === 0) return;
  const db = getDb();
  // getDb()'s return type is loosely `any` (see its own no-DATABASE_URL
  // fallback branch in ./index.ts), so the transaction callback's `tx`
  // isn't contextually typed — annotate it explicitly to satisfy noImplicitAny.
  await db.transaction(async (tx: typeof db) => {
    for (const user of users) {
      const row = { ...toRow(user), reportsTo: null };
      await tx.insert(usersTable).values(row).onConflictDoUpdate({ target: usersTable.id, set: row });
    }
    for (const user of users) {
      if (user.reports_to) {
        await tx.update(usersTable).set({ reportsTo: user.reports_to }).where(eq(usersTable.id, user.id));
      }
    }
  });
}

/** Deletes every row from the users table. Used by the demo reset/reseed routes. */
export async function clearUsersInDb(): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  await db.delete(usersTable);
}
