// Deletes events already stored under a city whose venue_address resolves to a
// different state — the pre-fix Luma leak (see scripts/audit-city-mismatch.ts,
// which this reuses the exact same detection query from). Children in
// event_categories/featured_listings/event_sources cascade on delete
// (ON DELETE CASCADE), so a single DELETE on events is sufficient.
//
// Defaults to a DRY RUN: prints what would be deleted and exits without
// touching anything. Pass --confirm to actually delete.
//
// Usage:  DATABASE_URL=... npx tsx scripts/delete-city-mismatch.ts [city-slug] [--confirm]
// city-slug defaults to "austin".
import { getPgDb } from '@/lib/db/pg'
import { getCityBySlug } from '@/lib/db'
import { stateFromAddress } from '@/lib/sources/luma'

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — this deletes from the shared prod database only.')
    process.exit(1)
  }

  const args = process.argv.slice(2)
  const confirm = args.includes('--confirm')
  const citySlug = args.find(a => !a.startsWith('--')) ?? 'austin'

  const city = await getCityBySlug(citySlug)
  if (!city) {
    console.error(`Unknown city slug "${citySlug}"`)
    process.exit(1)
  }

  const db = getPgDb()
  const rows = await db.query<{
    id: string; title: string; start_time: string; source: string; venue_address: string | null
  }>(
    `SELECT id, title, start_time, source, venue_address FROM events WHERE city_id = $1 AND venue_address IS NOT NULL`,
    [city.id]
  )

  const mismatches = rows
    .map(r => ({ ...r, resolvedState: stateFromAddress(r.venue_address) }))
    .filter(r => r.resolvedState && r.resolvedState !== city.state.toUpperCase())

  console.log(`Found ${mismatches.length} ${city.name}-tagged event(s) whose address resolves to a different state:\n`)
  for (const m of mismatches) {
    console.log(`${m.id}  [${m.resolvedState}]  ${m.source}  "${m.title}"`)
  }

  if (mismatches.length === 0) {
    console.log('\nNothing to delete.')
    process.exit(0)
  }

  if (!confirm) {
    console.log(`\nDRY RUN — nothing deleted. Re-run with --confirm to delete these ${mismatches.length} row(s).`)
    process.exit(0)
  }

  const ids = mismatches.map(m => m.id)
  await db.query(`DELETE FROM events WHERE id = ANY($1::uuid[])`, [ids])
  console.log(`\nDeleted ${ids.length} row(s) (children cascaded via event_categories/featured_listings/event_sources).`)
  process.exit(0)
}

main().catch(err => {
  console.error('Delete failed:', err)
  process.exit(1)
})
