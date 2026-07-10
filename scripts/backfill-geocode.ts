// One-off backfill: geocode every venue already in `events` that predates the
// map-view feature. Future ingest runs geocode new/merged venues automatically
// (lib/persist.ts), but existing rows only get picked up here — run once after
// deploying the map view, and again any time a large batch of un-geocoded
// history needs catching up (it's idempotent: already-cached venues no-op).
import { getDistinctVenues, getCityById, type City } from '@/lib/db'
import { ensureVenueGeocoded } from '@/lib/geocode'

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — this backfills the shared prod database only.')
    process.exit(1)
  }

  const venues = await getDistinctVenues()
  console.log(`Backfilling geocodes for ${venues.length} distinct venue(s)...`)

  const cityCache = new Map<number, City | null>()
  let processed = 0
  let skipped = 0

  for (const v of venues) {
    let city = cityCache.get(v.city_id)
    if (city === undefined) {
      city = await getCityById(v.city_id)
      cityCache.set(v.city_id, city)
    }
    if (!city) { skipped++; continue }

    await ensureVenueGeocoded({
      cityId: v.city_id, venueNorm: v.venue_norm, venueName: v.venue_name,
      venueAddress: v.venue_address, city,
    })
    processed++
    if (processed % 50 === 0) console.log(`  ${processed}/${venues.length}...`)
  }

  console.log(`Done. Processed ${processed}, skipped ${skipped} (no matching city row).`)
  process.exit(0)
}

main().catch(err => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
