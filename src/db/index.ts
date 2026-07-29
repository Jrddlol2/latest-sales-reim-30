/**
 * Drizzle client factory. Not imported by server.ts yet — see
 * docs/DATABASE-MIGRATION.md for what's left before the in-memory arrays
 * are actually replaced. This exists now so the schema (./schema.ts) has
 * something real to run migrations against once DATABASE_URL is set.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

let pool: Pool | undefined;

/** Lazily creates the pool so importing this module is safe even when
 *  DATABASE_URL isn't set yet (e.g. during the current in-memory-only
 *  server, or in any test that never calls getDb()). */
export function getDb() {
  if (!process.env.DATABASE_URL) {
    console.warn('[AI Studio] DATABASE_URL is not set — using mock db instance');
    const noOp = {
      findMany: async () => [],
      findFirst: async () => null,
      findUnique: async () => null,
      create: async (d: any) => d?.data ?? {},
      update: async (d: any) => d?.data ?? {},
      delete: async () => ({}),
    };
    return new Proxy({}, {
      get: (_, prop) => prop === 'query'
        ? new Proxy({}, { get: () => noOp })
        : async () => [],
    }) as any;
  }
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof getDb>;
