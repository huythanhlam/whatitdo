// Maps a ticket URL to the ticketing provider it points at, so we can offer a
// one-click "Get Tickets" action labeled with the real source (Ticketmaster,
// StubHub, the venue's own site, etc.) rather than a generic link.

export type TicketProvider = {
  /** Human-readable source name, e.g. "Ticketmaster". */
  name: string
  /** Call-to-action label for the button, e.g. "Tickets on Ticketmaster". */
  cta: string
}

// Known third-party ticketing platforms, matched against the URL hostname.
// Order matters only for readability; matches are by substring.
const KNOWN_PROVIDERS: { match: string[]; name: string }[] = [
  { match: ['ticketmaster.', 'livenation.'], name: 'Ticketmaster' },
  { match: ['stubhub.'], name: 'StubHub' },
  { match: ['seatgeek.'], name: 'SeatGeek' },
  { match: ['eventbrite.'], name: 'Eventbrite' },
  { match: ['axs.com'], name: 'AXS' },
  { match: ['dice.fm'], name: 'DICE' },
  { match: ['ticketweb.'], name: 'TicketWeb' },
  { match: ['frontgatetickets.'], name: 'Front Gate Tickets' },
  { match: ['etix.com'], name: 'Etix' },
  { match: ['tixr.com'], name: 'Tixr' },
  { match: ['prekindle.'], name: 'Prekindle' },
  { match: ['showclix.'], name: 'ShowClix' },
  { match: ['vividseats.'], name: 'Vivid Seats' },
]

/**
 * Resolve the ticketing provider for an event's ticket URL.
 * Returns `null` when there is no usable URL. For unrecognized hosts we fall
 * back to a generic "Get Tickets" CTA so the one-click action still works.
 */
export function getTicketProvider(ticketUrl: string | null | undefined): TicketProvider | null {
  if (!ticketUrl) return null

  let host: string
  try {
    host = new URL(ticketUrl).hostname.toLowerCase()
  } catch {
    return null
  }

  for (const provider of KNOWN_PROVIDERS) {
    if (provider.match.some(m => host.includes(m))) {
      return { name: provider.name, cta: `Tickets on ${provider.name}` }
    }
  }

  return { name: 'venue site', cta: 'Get Tickets' }
}

/**
 * Whether an event needs a ticket purchase/registration we can link to.
 * True when there is a ticket URL — paid events surface a "buy" CTA, while free
 * events with a link surface an RSVP/details CTA.
 */
export function requiresTickets(event: { ticket_url: string | null; is_free: boolean }): boolean {
  return Boolean(event.ticket_url)
}
