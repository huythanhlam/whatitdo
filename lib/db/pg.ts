import { Pool } from 'pg'
import type { Db } from './driver'

// Direct Postgres driver for production: a `pg` Pool against Supabase's
// Supavisor pooler (`DATABASE_URL`). Because PGlite and Postgres speak the same
// SQL dialect, this lets every query in lib/db/index.ts be written once — no
// PostgREST query-builder, no per-function dialect branch.
//
// The pool is stored on globalThis: Next.js bundles route handlers and RSC
// pages into separate module registries, so a plain module-level singleton
// would open a *separate* pool per bundle. globalThis is shared across bundles
// in the Node process, so all callers share one pool.
const globalForPg = globalThis as unknown as { __pgPool?: Pool }

function pool(): Pool {
  if (!globalForPg.__pgPool) {
    const connectionString = process.env.DATABASE_URL!
    // The Supavisor pooler serves TLS; local Postgres (docker/localhost)
    // typically does not. Enable SSL unless the connection is clearly local or
    // explicitly disabled.
    const local = /localhost|127\.0\.0\.1|sslmode=disable/.test(connectionString)
    globalForPg.__pgPool = new Pool({
      connectionString,
      max: 5,
      ssl: local ? undefined : { rejectUnauthorized: false },
    })
  }
  return globalForPg.__pgPool
}

export function getPgDb(): Db {
  return {
    query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) =>
      (await pool().query(sql, params)).rows as T[],
    exec: async (sql: string) => {
      await pool().query(sql)
    },
  }
}
