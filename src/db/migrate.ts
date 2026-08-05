/**
 * Applies the reviewed migration files in `drizzle/` to `DATABASE_URL` via
 * Drizzle's own migration runner, tracked in Postgres by its
 * `drizzle.__drizzle_migrations` table so re-running this is a no-op once a
 * migration has already landed.
 *
 * This is the release-pipeline counterpart to `db:push` (see
 * docs/project-handoff/DATABASE-MIGRATION.md, "Still open" #4): `db:push`
 * diffs schema.ts against the live database and applies the diff directly,
 * which is fast for local iteration but produces no reviewable record of
 * what changed or when. `db:generate` + this script instead: (1) generate
 * turns a schema.ts edit into a numbered SQL file under `drizzle/`, (2) that
 * file gets reviewed like any other code change, (3) this script applies
 * exactly those files, in order, tracking which have already run.
 *
 * Usage: `npm run db:migrate` (requires DATABASE_URL; see .env.example).
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[db:migrate] DATABASE_URL is not set — nothing to migrate against. See .env.example.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  console.log('[db:migrate] Applying pending migrations from ./drizzle ...');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('[db:migrate] Done — database is up to date with schema.ts.');

  await pool.end();
}

main().catch(err => {
  console.error('[db:migrate] Migration failed:', err);
  process.exit(1);
});
