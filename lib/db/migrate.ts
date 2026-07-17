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

// This runner applies ALL `supabase/migrations/*.sql` (001 through the latest),
// including the Supabase Auth + RLS migrations (034+). Apply to a Postgres via
// `npm run migrate` (see scripts/migrate.ts) — the app's native migration path,
// which uses its own `_migrations` ledger and does NOT rely on the Supabase CLI's
// migration history. PGlite applies the same files at init for local catalog dev.
export function migrationFiles(): string[] {
  return readdirSync(migrationsDir())
    .filter(f => f.endsWith('.sql'))
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
