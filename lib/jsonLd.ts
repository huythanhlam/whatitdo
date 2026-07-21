// Centralized schema.org JSON-LD builders. Every listing/detail page emits the
// same Event shape from here (via <script type="application/ld+json">), so
// Google's event rich results stay consistent across the site — and the one
// place that escapes attacker-authorable text lives here, not copy-pasted per
// page.

import { getBaseUrl } from '@/lib/site'
import type { EnrichedEvent } from '@/lib/types'

type CityLike = { name: string; state?: string | null }

// Event fields (title/description/venue) come from scraped, attacker-authorable
// third-party listings. Raw JSON.stringify does NOT escape `<`, so a title like
// `</script><script>…` would break out of the inline <script> tag (stored XSS).
// Escape the HTML-significant characters to `\uXXXX` — still valid JSON that
// schema.org consumers parse identically, but inert to the HTML parser.
export function jsonLdHtml(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}

function toIso(v: string | null | undefined): string | undefined {
  if (!v) return undefined
  const t = new Date(v)
  return Number.isNaN(t.getTime()) ? undefined : t.toISOString()
}

export function eventUrl(citySlug: string, eventId: string): string {
  return `${getBaseUrl()}/${citySlug}/events/${eventId}`
}

// A single schema.org Event object (no @context — used both standalone and
// nested inside an ItemList). Kept resilient so a listing with sparse data
// still validates: a physical Event needs a `location`, so fall back to the
// city as a Place when no venue is known rather than dropping it (which makes
// the whole item ineligible for rich results).
export function eventJsonLd(
  event: EnrichedEvent,
  citySlug: string,
  city: CityLike,
): Record<string, unknown> {
  const jsonLd: Record<string, unknown> = {
    '@type': 'Event',
    name: event.title,
    startDate: toIso(event.start_time),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    url: eventUrl(citySlug, event.id),
  }

  const endDate = toIso(event.end_time)
  if (endDate) jsonLd.endDate = endDate
  if (event.description) jsonLd.description = event.description.slice(0, 500)
  if (event.image_url) jsonLd.image = [event.image_url]

  // Always emit a location. Prefer the venue; otherwise anchor the event to the
  // city so Google still treats it as a valid physical event.
  const address: Record<string, unknown> = {
    '@type': 'PostalAddress',
    addressLocality: city.name,
    addressCountry: 'US',
  }
  if (city.state) address.addressRegion = city.state
  if (event.venue_address) address.streetAddress = event.venue_address
  jsonLd.location = {
    '@type': 'Place',
    name: event.venue_name ?? city.name,
    address,
  }

  // Only emit an Offer we can actually populate. A free event → price 0. A paid
  // event with a known floor → that price. A paid event with an unknown price
  // is emitted with just a ticket URL (Google accepts a URL-only offer) rather
  // than an invalid price-less-but-currency Offer.
  const hasKnownPrice = event.is_free || event.price_min != null
  if (event.ticket_url || hasKnownPrice) {
    const offer: Record<string, unknown> = {
      '@type': 'Offer',
      availability: 'https://schema.org/InStock',
    }
    if (event.is_free) {
      offer.price = 0
      offer.priceCurrency = 'USD'
    } else if (event.price_min != null) {
      offer.price = event.price_min
      offer.priceCurrency = 'USD'
    }
    if (event.ticket_url) offer.url = event.ticket_url
    jsonLd.offers = offer
  }

  return jsonLd
}

// A schema.org ItemList of Events for a listing page (city home, "this
// weekend", etc.). Lets Google understand the page as a collection of events
// and surface the event carousel from the listing URL — not just from each
// event detail page.
export function eventListJsonLd(
  events: EnrichedEvent[],
  citySlug: string,
  city: CityLike,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: events.map((event, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: eventJsonLd(event, citySlug, city),
    })),
  }
}

// Wrap a bare Event object with @context for standalone emission on the detail
// page.
export function singleEventJsonLd(
  event: EnrichedEvent,
  citySlug: string,
  city: CityLike,
): Record<string, unknown> {
  return { '@context': 'https://schema.org', ...eventJsonLd(event, citySlug, city) }
}

// Site-wide brand identity — helps Google associate the domain with the brand
// (knowledge panel) and enables a sitelinks search box in results.
export function organizationJsonLd(): Record<string, unknown> {
  const base = getBaseUrl()
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Whats Happenin',
    url: base,
    logo: `${base}/logo-icon.svg`,
  }
}

export function websiteJsonLd(): Record<string, unknown> {
  const base = getBaseUrl()
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Whats Happenin',
    url: base,
  }
}
