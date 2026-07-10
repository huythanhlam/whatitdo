// Venue header-image cache, keyed by (city_id, venue_norm) — mirrors the
// caching pattern in lib/geocode.ts. When an ingested event carries no image
// of its own, we fetch its venue/ticket link once, pull that page's
// og:image/twitter:image ("header" image), and cache it for every future
// event at that venue instead of a generic category stock photo.
//
// The URL comes from ingested (untrusted) feed/crawl/submission data, so it
// is fetched through the same SSRF-guarded path as public submissions
// (lib/ssrf.ts's safeFetchHtml), never a raw fetch.
import { getVenueImage, upsertVenueImage } from '@/lib/db'
import { pageFromHtml } from '@/lib/sources/crawler'
import { safeFetchHtml, SsrfError } from '@/lib/ssrf'

async function fetchHeaderImage(url: string): Promise<string | null> {
  try {
    const html = await safeFetchHtml(url)
    return pageFromHtml(html, url).image_url
  } catch (e) {
    // An SSRF rejection just means "not a fetchable venue site" — not worth
    // logging as an error the way a genuine network/parse failure is.
    if (!(e instanceof SsrfError)) console.error(`Venue header-image fetch failed for ${url}:`, e)
    return null
  }
}

// Cache-check, fetch-on-miss, cache-write. A null result (no venue URL, fetch
// failed, or the page had no og:image/twitter:image) is cached too, so a
// venue with no usable image isn't re-fetched on every single event.
export async function ensureVenueImage(opts: {
  cityId: number
  venueNorm: string
  venueName: string
  venueUrl: string | null
}): Promise<string | null> {
  try {
    const cached = await getVenueImage(opts.cityId, opts.venueNorm)
    if (cached) return cached.image_url

    const imageUrl = opts.venueUrl ? await fetchHeaderImage(opts.venueUrl) : null
    await upsertVenueImage({ cityId: opts.cityId, venueNorm: opts.venueNorm, venueName: opts.venueName, imageUrl })
    return imageUrl
  } catch (e) {
    // Never blocks event persistence — degrades to the category-image fallback.
    console.error('ensureVenueImage failed (falls back to category image):', e)
    return null
  }
}
