/**
 * Builds an in-process, pg-mem-backed Drizzle instance from this repo's real
 * `drizzle/*.sql` migration files — no Docker, no local Postgres binary, no
 * network. This is what lets test/db-persistence.test.ts exercise the actual
 * repo write/read functions (coreLoopRepo.ts, usersRepo.ts, …) against real
 * generated SQL, instead of only against the in-memory arrays every other
 * test in this suite uses (test/setup.ts forces DATABASE_URL='').
 *
 * Fidelity note: pg-mem is a SQL emulator, not real Postgres — it's a net for
 * catching schema/code drift (a column a repo function writes that a
 * migration never added, a type mismatch, an FK violation), not a substitute
 * for verifying against the real Supabase instance before a production
 * cutover. One known gap, worked around below: pg-mem's parser doesn't
 * support positional `ALTER TYPE … ADD VALUE 'x' BEFORE/AFTER 'y'` (only
 * plain append). This app only ever compares its status enums by equality/
 * membership, never by ordinal position, so dropping the positional clause
 * for test purposes doesn't hide anything real.
 */
import fs from 'fs';
import path from 'path';
import { newDb } from 'pg-mem';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/db/schema';

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'drizzle');

function readMigrationFiles(): string[] {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * Creates a fresh pg-mem instance with the given migration files (in order)
 * replayed against it, and returns a Drizzle client wired to it — the same
 * `drizzle-orm/node-postgres` dialect src/db/index.ts uses for the real
 * Postgres connection, so repo code sees an identical API surface.
 *
 * @param upToMigration Optional filename (inclusive) to stop at — lets a test
 *   build a database that's missing a later migration on purpose, to prove a
 *   schema-drift scenario the same way the real Supabase DB drifted behind
 *   migration 0006 in production (see PRODUCTION-PUNCHLIST.md #5).
 */
export function buildPgMemDb(upToMigration?: string) {
  const db = newDb({ autoCreateForeignKeyIndices: true });

  let files = readMigrationFiles();
  if (upToMigration) {
    const cutoffIndex = files.indexOf(upToMigration);
    if (cutoffIndex === -1) {
      throw new Error(`buildPgMemDb: no migration file named "${upToMigration}" (available: ${files.join(', ')})`);
    }
    files = files.slice(0, cutoffIndex + 1);
  }

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    for (const rawStatement of sql.split('--> statement-breakpoint')) {
      const statement = rawStatement
        .trim()
        // See the fidelity note above.
        .replace(/\s+(BEFORE|AFTER)\s+'[^']*'(?=;?\s*$)/i, '');
      if (!statement) continue;
      db.public.none(statement);
    }
  }

  const { Pool } = db.adapters.createPg();
  const pool = new Pool();

  // Two gaps between what drizzle-orm/node-postgres always sends and what
  // pg-mem's adapter accepts — neither is a pg-mem bug, both are guards
  // against real-Postgres wire-protocol features pg-mem doesn't need to
  // implement because it never parses a wire format in the first place:
  //
  // 1. `query.types.getTypeParser` — drizzle attaches a custom type-parser
  //    override to every query (it wants raw timestamp/date/interval
  //    strings back, not the `pg` driver's default Date coercion; it does
  //    its own parsing from the schema types). pg-mem throws on seeing this
  //    key at all. Stripping it changes nothing about the values that come
  //    back — pg-mem already returns JS-native values, there's no byte
  //    stream for a type parser to apply to.
  // 2. `query.rowMode = 'array'` — drizzle's select() path asks for
  //    positional-array rows (it maps them to columns using its own
  //    compiled field list, not the driver's). pg-mem only returns
  //    object-shaped rows (`{col: value}`) and throws if rowMode is set at
  //    all. pg-mem's object rows preserve the query's SELECT-list column
  //    order via normal V8 insertion-order semantics (verified directly
  //    against pg-mem before adopting this) — so converting each row to
  //    `Object.values(row)` reproduces exactly what real array mode would
  //    have returned, which is what drizzle's mapResultRow() needs. The
  //    round-trip tests in db-persistence.test.ts are the actual proof:
  //    every field written comes back correctly through this path.
  const originalQuery = pool.query.bind(pool);
  pool.query = (async (queryConfig: any, ...rest: any[]) => {
    if (!queryConfig || typeof queryConfig !== 'object') {
      return originalQuery(queryConfig, ...rest);
    }
    const wantsArrayRows = queryConfig.rowMode === 'array';
    const { types: _types, rowMode: _rowMode, ...cleaned } = queryConfig;
    const result = await originalQuery(cleaned, ...rest);
    if (wantsArrayRows && result && Array.isArray(result.rows)) {
      return { ...result, rows: result.rows.map((row: Record<string, unknown>) => Object.values(row)) };
    }
    return result;
  }) as typeof pool.query;

  return drizzle(pool, { schema });
}
