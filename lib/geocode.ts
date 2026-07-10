// Venue geocoding, keyed by (city_id, venue_norm) and cached in the `venues`
// table so each unique venue is geocoded once, ever. Called from persistOne
// for every event (new or merged) — see PRODUCT-SPEC.md's Phase 4 note.
// Never throws and never blocks event persistence: a missing key, exhausted
// budget, or network failure just means that venue gets no pin on the map.
import { getVenueGeocode, upsertVenueGeocode, upgradeVenueGeocode } from '@/lib/db'

const apiKey = process.env.GOOGLE_GEOCODING_API_KEY

export function hasGeocoding(): boolean {
  return !!apiKey
}

function intEnv(name: string, fallback: number): number {
  const v = parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(v) && v > 0 ? v : fallback
}

// Google's free-tier monthly credit works out to tens of thousands of
// requests, far more than any city's venue count — this budget exists as a
// runaway-cost guard, not a real capacity constraint (contrast GEMINI_RPM/
// GEMINI_DAILY_BUDGET, which sit close to the actual free-tier ceiling).
const DAILY_BUDGET = intEnv('GEOCODE_DAILY_BUDGET', 500)

// Process-local daily counter (same documented limitation as lib/gemini.ts:
// not persisted across serverless invocations or separate script processes).
let dailyCount = 0
let dailyKey = ''

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function budgetRemaining(): number {
  if (dailyKey !== today()) { dailyKey = today(); dailyCount = 0 }
  return DAILY_BUDGET - dailyCount
}

let warnedMissingKey = false

export type GeocodeResult =
  | { status: 'ok'; lat: number; lng: number; formattedAddress: string }
  | { status: 'zero_results' }
  | { status: 'error' }

// Pure — maps Google's Geocoding API response shape to our normalized result.
export function parseGeocodeResponse(json: unknown): GeocodeResult {
  const j = json as { status?: string; results?: { geometry?: { location?: { lat: number; lng: number } }; formatted_address?: string }[] } | null
  if (!j || typeof j !== 'object') return { status: 'error' }
  if (j.status === 'ZERO_RESULTS') return { status: 'zero_results' }
  if (j.status !== 'OK' || !j.results?.length) return { status: 'error' }
  const loc = j.results[0].geometry?.location
  if (!loc) return { status: 'error' }
  return { status: 'ok', lat: loc.lat, lng: loc.lng, formattedAddress: j.results[0].formatted_address ?? '' }
}

// Thin fetch wrapper — deliberately untested (mirrors lib/sources/ticketmaster.ts's
// convention of leaving the raw HTTP call unmocked; parseGeocodeResponse carries
// the tested logic).
export async function geocodeAddress(query: string): Promise<GeocodeResult> {
  if (!apiKey) {
    if (!warnedMissingKey) { console.warn('GOOGLE_GEOCODING_API_KEY not set — venues will not be geocoded.'); warnedMissingKey = true }
    return { status: 'error' }
  }
  if (budgetRemaining() <= 0) return { status: 'error' }
  dailyCount++

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  url.searchParams.set('address', query)
  url.searchParams.set('key', apiKey)

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return { status: 'error' }
    return parseGeocodeResponse(await res.json())
  } catch (e) {
    console.error('Geocoding request failed:', e)
    return { status: 'error' }
  }
}

// Cache-check, geocode-on-miss, cache-write. Called unconditionally per event
// in persistOne (new-insert AND merge branches), so venues that only ever get
// merged into an existing canonical event still get geocoded. A terminal
// 'ok' result geocoded FROM AN ADDRESS is cached forever; 'zero_results' and
// name-only 'ok' results can still be upgraded once (see below); 'error'
// writes nothing so the next ingest/backfill run retries it.
export async function ensureVenueGeocoded(opts: {
  cityId: number
  venueNorm: string
  venueName: string
  venueAddress: string | null
  city: { name: string; state: string }
}): Promise<void> {
  // The whole body is guarded: a cache-table read/write hiccup must degrade to
  // "no pin on the map for this venue", never to a failed event persistence.
  try {
    const cached = await getVenueGeocode(opts.cityId, opts.venueNorm)

    if (cached) {
      // This venue was already geocoded via the name-only fallback (no address
      // was available at the time), and an address just became available for
      // it — worth one attempt at a more precise geocode. Bounded to exactly
      // once per venue (upgradeVenueGeocode's used_address=false guard), so
      // this never turns into unbounded re-geocoding on every event.
      if (cached.used_address || !opts.venueAddress) return

      const upgradeQuery = `${opts.venueName}, ${opts.venueAddress}, ${opts.city.name}, ${opts.city.state}`
      const upgraded = await geocodeAddress(upgradeQuery)
      if (upgraded.status === 'ok') {
        await upgradeVenueGeocode(opts.cityId, opts.venueNorm, {
          lat: upgraded.lat, lng: upgraded.lng, formattedAddress: upgraded.formattedAddress,
        })
      }
      // zero_results/error on the upgrade attempt: leave the existing cached
      // row as-is — still better than no pin at all.
      return
    }

    const usedAddress = !!opts.venueAddress
    const query = usedAddress
      ? `${opts.venueName}, ${opts.venueAddress}, ${opts.city.name}, ${opts.city.state}`
      : `${opts.venueName}, ${opts.city.name}, ${opts.city.state}`

    const result = await geocodeAddress(query)

    if (result.status === 'ok') {
      await upsertVenueGeocode({
        cityId: opts.cityId, venueNorm: opts.venueNorm, venueName: opts.venueName,
        status: 'ok', lat: result.lat, lng: result.lng, formattedAddress: result.formattedAddress, usedAddress,
      })
    } else if (result.status === 'zero_results') {
      await upsertVenueGeocode({ cityId: opts.cityId, venueNorm: opts.venueNorm, venueName: opts.venueName, status: 'zero_results', usedAddress })
    }
  } catch (e) {
    console.error('ensureVenueGeocoded failed (event persistence continues unaffected):', e)
  }
}
