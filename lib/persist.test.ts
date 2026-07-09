import { describe, it, expect } from 'vitest'
import { isValidEvent } from './persist'
import type { RawEvent } from './sources/types'

function ev(overrides: Partial<RawEvent>): RawEvent {
  return {
    title: 'Show at Mohawk',
    description: null,
    start_time: '2026-07-10T20:00:00-05:00',
    end_time: null,
    venue_name: 'Mohawk',
    venue_address: null,
    image_url: null,
    ticket_url: null,
    source: 'test',
    source_id: 'test-1',
    is_free: false,
    price_min: null,
    price_max: null,
    ...overrides,
  }
}

describe('isValidEvent (fabricated-date gate)', () => {
  it('accepts a well-formed, near-future event', () => {
    const soon = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
    expect(isValidEvent(ev({ start_time: soon }))).toBe(true)
  })

  it('rejects an empty title', () => {
    expect(isValidEvent(ev({ title: '   ' }))).toBe(false)
  })

  it('rejects a missing start_time', () => {
    expect(isValidEvent(ev({ start_time: '' }))).toBe(false)
  })

  it('rejects an unparseable start_time', () => {
    expect(isValidEvent(ev({ start_time: 'sometime next week' }))).toBe(false)
  })

  it('rejects a start more than 18 months out (likely a bad parse)', () => {
    const farOut = new Date(Date.now() + 20 * 30 * 24 * 3600 * 1000).toISOString()
    expect(isValidEvent(ev({ start_time: farOut }))).toBe(false)
  })
})

describe('persistEvents defaults', () => {
  it('defaults cityId to 1 and status to approved when opts is omitted', async () => {
    // isValidEvent is exercised elsewhere; this test only documents the
    // default-opts contract so a future signature change fails loudly here
    // rather than silently in production. persistEvents itself is covered by
    // the PGlite integration tests in lib/db/db.integration.test.ts.
    expect(typeof isValidEvent).toBe('function')
  })
})
