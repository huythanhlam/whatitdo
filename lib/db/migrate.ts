import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { Db } from './driver'

// The single migration runner. `supabase/migrations/*.sql` is the one source of
// schema truth; it is applied verbatim to BOTH drivers — PGlite (at init, on a
// fresh in-memory database each process) and Postgres (via `npm run migrate`,
// see scripts/migrate.ts). Applied files are recorded in a `_migrations` ledger
// so re-runs are no-ops. This replaces the hand-mirrored schema copy that used
// to live in pglite.ts and drift from the migrations.
//
// Files are resolved from the project root at runtime; next.config.ts traces
// `supabase/migrations/**` into the serverless bundle so the PGlite fallback
// still finds them in production.
function migrationsDir(): string {
  return path.join(process.cwd(), 'supabase', 'migrations')
}

// Transitional boundary. Migrations 034+ adopt Supabase Auth + RLS: they target
// the native `auth` schema/roles and are managed by the Supabase CLI stack, not
// this legacy runner. During the cutover the legacy PGlite/dev path (and this
// runner) stay on the pre-cutover era (≤ 033); the Supabase-era migrations are
// applied by the real stack and independently proven by lib/db/rls.integration
// (which applies every file to its own isolated PGlite). Once the app-layer
// cutover lands and PGlite is retired, this ceiling and the runner go away.
const LEGACY_MIGRATION_CEILING = 33

function migrationSeq(file: string): number {
  const m = file.match(/^(\d+)/)
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER
}

export function migrationFiles(): string[] {
  return readdirSync(migrationsDir())
    .filter(f => f.endsWith('.sql'))
    .filter(f => migrationSeq(f) <= LEGACY_MIGRATION_CEILING)
    .sort()
}

export async function migrate(db: Db): Promise<void> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name       TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  )

  const applied = new Set(
    (await db.query<{ name: string }>(`SELECT name FROM _migrations`)).map(r => r.name)
  )

  for (const file of migrationFiles()) {
    if (applied.has(file)) continue
    const sql = readFileSync(path.join(migrationsDir(), file), 'utf8')
    await db.exec(sql)
    await db.query(`INSERT INTO _migrations (name) VALUES ($1)`, [file])
  }
}
