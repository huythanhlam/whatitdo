import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseGeocodeResponse } from './geocode'

const fixture = (name: string) => JSON.parse(readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8'))

describe('parseGeocodeResponse', () => {
  it('extracts lat/lng, formatted address, and neighborhood from an OK response', () => {
    const result = parseGeocodeResponse(fixture('geocode-ok.json'))
    expect(result).toEqual({
      status: 'ok',
      lat: 30.267985,
      lng: -97.7381,
      formattedAddress: '912 Red River St, Austin, TX 78701, USA',
      neighborhood: 'Downtown',
    })
  })

  it('returns neighborhood: null when Google has no neighborhood-typed address component', () => {
    const result = parseGeocodeResponse(fixture('geocode-ok-no-neighborhood.json'))
    expect(result).toEqual({
      status: 'ok',
      lat: 30.2711,
      lng: -97.7597,
      formattedAddress: '1500 W 6th St, Austin, TX 78703, USA',
      neighborhood: null,
    })
  })

  it('returns zero_results when Google finds nothing', () => {
    const result = parseGeocodeResponse(fixture('geocode-zero-results.json'))
    expect(result).toEqual({ status: 'zero_results' })
  })

  it('returns error on a non-OK status like REQUEST_DENIED', () => {
    const result = parseGeocodeResponse(fixture('geocode-error.json'))
    expect(result).toEqual({ status: 'error' })
  })

  it('returns error on malformed input', () => {
    expect(parseGeocodeResponse(null)).toEqual({ status: 'error' })
    expect(parseGeocodeResponse({})).toEqual({ status: 'error' })
    expect(parseGeocodeResponse({ status: 'OK', results: [] })).toEqual({ status: 'error' })
    expect(parseGeocodeResponse({ status: 'OK', results: [{}] })).toEqual({ status: 'error' })
  })
})

vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db')
  return {
    ...actual,
    getVenueGeocode: vi.fn(),
    upsertVenueGeocode: vi.fn(),
    upgradeVenueGeocode: vi.fn(),
  }
})

describe('ensureVenueGeocoded', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('never throws, even when the cache-read itself fails (must not block event persistence)', async () => {
    const { getVenueGeocode } = await import('@/lib/db')
    vi.mocked(getVenueGeocode).mockRejectedValue(new Error('connection lost'))

    const { ensureVenueGeocoded } = await import('./geocode')
    await expect(ensureVenueGeocoded({
      cityId: 1, venueNorm: 'some venue', venueName: 'Some Venue', venueAddress: null,
      city: { name: 'Austin', state: 'TX' },
    })).resolves.toBeUndefined()
  })

  it('is a pure no-op when the venue is already cached with used_address: true', async () => {
    const { getVenueGeocode, upsertVenueGeocode, upgradeVenueGeocode } = await import('@/lib/db')
    vi.mocked(getVenueGeocode).mockResolvedValue({
      city_id: 1, venue_norm: 'precise venue', venue_name: 'Precise Venue',
      lat: 1, lng: 1, formatted_address: 'x', neighborhood: null, status: 'ok', used_address: true,
    })

    const { ensureVenueGeocoded } = await import('./geocode')
    await ensureVenueGeocoded({
      cityId: 1, venueNorm: 'precise venue', venueName: 'Precise Venue', venueAddress: '123 Main St',
      city: { name: 'Austin', state: 'TX' },
    })

    expect(upsertVenueGeocode).not.toHaveBeenCalled()
    expect(upgradeVenueGeocode).not.toHaveBeenCalled()
  })

  it('is a no-op when cached name-only but no address is available this time either', async () => {
    const { getVenueGeocode, upsertVenueGeocode, upgradeVenueGeocode } = await import('@/lib/db')
    vi.mocked(getVenueGeocode).mockResolvedValue({
      city_id: 1, venue_norm: 'name only venue', venue_name: 'Name Only Venue',
      lat: 1, lng: 1, formatted_address: 'x', neighborhood: null, status: 'ok', used_address: false,
    })

    const { ensureVenueGeocoded } = await import('./geocode')
    await ensureVenueGeocoded({
      cityId: 1, venueNorm: 'name only venue', venueName: 'Name Only Venue', venueAddress: null,
      city: { name: 'Austin', state: 'TX' },
    })

    expect(upsertVenueGeocode).not.toHaveBeenCalled()
    expect(upgradeVenueGeocode).not.toHaveBeenCalled()
  })

  it('upgrades a name-only cached venue when a real API call succeeds', async () => {
    // Unlike the other tests here, this one exercises the actual geocodeAddress
    // fetch path (with a stubbed `fetch` and a fake API key), since the
    // upgrade behavior itself — not just "is the branch reached" — is exactly
    // what this feature was built to verify.
    vi.resetModules()
    process.env.GOOGLE_GEOCODING_API_KEY = 'test-key'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'OK',
        results: [{
          geometry: { location: { lat: 30.5, lng: -97.5 } },
          formatted_address: '789 Precise St, Austin, TX',
          address_components: [{ long_name: 'East Austin', types: ['neighborhood', 'political'] }],
        }],
      }),
    }))

    try {
      const { getVenueGeocode, upgradeVenueGeocode, upsertVenueGeocode } = await import('@/lib/db')
      vi.mocked(getVenueGeocode).mockResolvedValue({
        city_id: 1, venue_norm: 'upgrade success venue', venue_name: 'Upgrade Success Venue',
        lat: 1, lng: 1, formatted_address: 'coarse', neighborhood: null, status: 'ok', used_address: false,
      })

      const { ensureVenueGeocoded } = await import('./geocode')
      await ensureVenueGeocoded({
        cityId: 1, venueNorm: 'upgrade success venue', venueName: 'Upgrade Success Venue', venueAddress: '789 Elm St',
        city: { name: 'Austin', state: 'TX' },
      })

      expect(upgradeVenueGeocode).toHaveBeenCalledWith(1, 'upgrade success venue', {
        lat: 30.5, lng: -97.5, formattedAddress: '789 Precise St, Austin, TX', neighborhood: 'East Austin',
      })
      expect(upsertVenueGeocode).not.toHaveBeenCalled()
    } finally {
      delete process.env.GOOGLE_GEOCODING_API_KEY
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })
})
