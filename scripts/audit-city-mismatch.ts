// Read-only audit: find events already stored under a city whose venue_address
// resolves to a different state — the shape of bug fixed in lib/sources/luma.ts
// (e.g. DC events that leaked into Austin before that fix). That fix only
// stops NEW leaks on future crawls; it doesn't touch rows inserted before it
// shipped, so this is how to find those. Prints only — does not delete or
// modify anything; review the output and decide what to do with each row.
//
// Usage:  DATABASE_URL=... npx tsx scripts/audit-city-mismatch.ts [city-slug]
// city-slug defaults to "austin".
import { getPgDb } from '@/lib/db/pg'
import { getCityBySlug } from '@/lib/db'
import { stateFromAddress } from '@/lib/sources/luma'

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — this audits the shared prod database only.')
    process.exit(1)
  }

  const citySlug = process.argv[2] ?? 'austin'
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

  console.log(`Checked ${rows.length} ${city.name} event(s) with an address; found ${mismatches.length} state mismatch(es):\n`)
  for (const m of mismatches) {
    console.log(`${m.id}  [${m.resolvedState}]  ${m.start_time}  ${m.source}  "${m.title}"  —  ${m.venue_address}`)
  }
  process.exit(0)
}

main().catch(err => {
  console.error('Audit failed:', err)
  process.exit(1)
})
