import { Pool, type PoolConfig } from 'pg'
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

// Pure so it's unit-testable without a real connection (lib/db/pg.test.ts).
// The Supavisor pooler serves TLS; local Postgres (docker/localhost)
// typically does not, so SSL is off entirely for a clearly-local connection.
export function resolveSslConfig(connectionString: string): PoolConfig['ssl'] {
  if (/localhost|127\.0\.0\.1|sslmode=disable/.test(connectionString)) return undefined

  // Some pooler configurations (certain Supavisor setups) present a chain
  // Node's bundled root store can't validate on its own
  // (SELF_SIGNED_CERT_IN_CHAIN), even though the connection is legitimate.
  // Pinning the specific issuing CA fixes that while keeping verification
  // ON — the secure alternative to disabling it outright.
  const caCert = process.env.DATABASE_CA_CERT
  if (caCert) {
    // Some env-var UIs collapse real newlines in a pasted PEM into literal
    // "\n" sequences; normalize those back before handing it to TLS. A PEM
    // with real newlines (e.g. Vercel's multi-line env var input) is
    // unaffected by this replace.
    return { ca: caCert.replace(/\\n/g, '\n'), rejectUnauthorized: true }
  }

  // No pinned CA: fall back to system trust store verification.
  // rejectUnauthorized defaults to true — disabling it would accept ANY
  // certificate, letting a network-level attacker impersonate the database
  // and read/tamper with every query, including subscriber emails and admin
  // actions. DATABASE_SSL_INSECURE is a last-resort, explicit opt-in escape
  // hatch for a genuinely self-signed deployment with no CA cert to pin.
  return { rejectUnauthorized: process.env.DATABASE_SSL_INSECURE !== 'true' }
}

function pool(): Pool {
  if (!globalForPg.__pgPool) {
    const connectionString = process.env.DATABASE_URL!
    globalForPg.__pgPool = new Pool({
      connectionString,
      max: 5,
      ssl: resolveSslConfig(connectionString),
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
