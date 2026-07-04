// Apply supabase/migrations/*.sql to the Postgres database in DATABASE_URL.
//
// PGlite runs the same migrations automatically at init (fresh DB each process);
// this script is how the *shared* Supabase database gets them — run it from CI
// or locally after adding a migration:  npm run migrate
//
// Running DDL against the shared pooled database is intentionally NOT done at
// request time (pooler transaction mode + concurrent serverless instances make
// startup migrations unsafe), so this explicit step owns it. It reuses the exact
// same runner and `_migrations` ledger as the PGlite path.
import { getPgDb } from '@/lib/db/pg'
import { migrate, migrationFiles } from '@/lib/db/migrate'

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — nothing to migrate (PGlite migrates itself at init).')
    process.exit(1)
  }
  console.log(`Applying ${migrationFiles().length} migration file(s) to ${process.env.DATABASE_URL.replace(/:[^:@/]+@/, ':****@')}`)
  await migrate(getPgDb())
  console.log('Migrations up to date.')
  process.exit(0)
}

main().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
