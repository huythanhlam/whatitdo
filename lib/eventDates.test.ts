import { describe, it, expect } from 'vitest'
import { eventStartMs, isPastEvent, filterAndSortByDate } from './eventDates'

// A fixed reference "now" so tests don't depend on the wall clock.
const NOW = Date.parse('2026-07-17T12:00:00Z')

const ev = (id: string, iso: string) => ({ id, start_time: iso })

const past1 = ev('past1', '2026-07-10T12:00:00Z') // 7 days ago
const past2 = ev('past2', '2026-01-01T12:00:00Z') // ~6 months ago (oldest)
const future1 = ev('future1', '2026-07-20T12:00:00Z') // in 3 days
const future2 = ev('future2', '2026-12-31T12:00:00Z') // furthest out
const bad = ev('bad', '') // unparseable date

describe('eventStartMs', () => {
  it('parses ISO strings to epoch millis', () => {
    expect(eventStartMs('2026-07-20T12:00:00Z')).toBe(Date.parse('2026-07-20T12:00:00Z'))
  })

  it('returns -Infinity for unparseable/empty dates', () => {
    expect(eventStartMs('')).toBe(-Infinity)
    expect(eventStartMs('not a date')).toBe(-Infinity)
  })
})

describe('isPastEvent', () => {
  it('is true for events before now', () => {
    expect(isPastEvent(past1.start_time, NOW)).toBe(true)
  })

  it('is false for events at/after now', () => {
    expect(isPastEvent(future1.start_time, NOW)).toBe(false)
  })

  it('treats unparseable dates as not passed (never silently dropped)', () => {
    expect(isPastEvent('', NOW)).toBe(false)
  })
})

describe('filterAndSortByDate', () => {
  const all = [past1, future2, past2, future1, bad]

  it('default "upcoming" hides passed events', () => {
    const ids = filterAndSortByDate(all, NOW, 'upcoming').map(r => r.item.id)
    expect(ids).not.toContain('past1')
    expect(ids).not.toContain('past2')
    expect(ids).toContain('future1')
    expect(ids).toContain('future2')
  })

  it('"upcoming" keeps unparseable-date events (not treated as passed)', () => {
    const ids = filterAndSortByDate(all, NOW, 'upcoming').map(r => r.item.id)
    expect(ids).toContain('bad')
  })

  it('"past" shows only passed events', () => {
    const ids = filterAndSortByDate(all, NOW, 'past').map(r => r.item.id)
    expect(ids).toEqual(expect.arrayContaining(['past1', 'past2']))
    expect(ids).not.toContain('future1')
    expect(ids).not.toContain('bad')
  })

  it('"all" shows everything', () => {
    const ids = filterAndSortByDate(all, NOW, 'all').map(r => r.item.id)
    expect(ids).toHaveLength(all.length)
  })

  it('sorts by date descending — oldest always at the end', () => {
    const ids = filterAndSortByDate([past2, future1, past1, future2], NOW, 'all').map(r => r.item.id)
    // furthest future → ... → oldest last
    expect(ids).toEqual(['future2', 'future1', 'past1', 'past2'])
  })

  it('places unparseable-date events at the very end', () => {
    const ids = filterAndSortByDate([bad, future1, past1], NOW, 'all').map(r => r.item.id)
    expect(ids[ids.length - 1]).toBe('bad')
  })

  it('tags each result with its past flag', () => {
    const rows = filterAndSortByDate([past1, future1], NOW, 'all')
    expect(rows.find(r => r.item.id === 'past1')?.past).toBe(true)
    expect(rows.find(r => r.item.id === 'future1')?.past).toBe(false)
  })
})
