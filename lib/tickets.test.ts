import { describe, it, expect } from 'vitest'
import { getTicketProvider, requiresTickets } from './tickets'

describe('getTicketProvider', () => {
  it('recognizes a known ticketing platform by hostname', () => {
    expect(getTicketProvider('https://www.ticketmaster.com/event/123')?.name).toBe('Ticketmaster')
  })

  it('falls back to "venue site" for an unrecognized https host', () => {
    expect(getTicketProvider('https://mohawkaustin.com/rsvp')).toEqual({
      name: 'venue site',
      cta: 'Get Tickets',
    })
  })

  it('returns null for missing input', () => {
    expect(getTicketProvider(null)).toBeNull()
    expect(getTicketProvider(undefined)).toBeNull()
    expect(getTicketProvider('')).toBeNull()
  })

  it('rejects javascript: and other non-http(s) schemes (stored-XSS defense)', () => {
    // A scraped/submitted ticket_url could carry an executable scheme; every
    // render site gates its <a href> on this function returning non-null, so
    // this must reject them even though lib/persist.ts also sanitizes at
    // ingestion time (defense in depth).
    expect(getTicketProvider('javascript:alert(document.cookie)')).toBeNull()
    expect(getTicketProvider('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(getTicketProvider('vbscript:msgbox(1)')).toBeNull()
  })

  it('returns null for unparseable input', () => {
    expect(getTicketProvider('not a url')).toBeNull()
  })
})

describe('requiresTickets', () => {
  it('is true whenever a ticket_url is present, free or paid', () => {
    expect(requiresTickets({ ticket_url: 'https://example.com', is_free: false })).toBe(true)
    expect(requiresTickets({ ticket_url: 'https://example.com', is_free: true })).toBe(true)
    expect(requiresTickets({ ticket_url: null, is_free: false })).toBe(false)
  })
})
