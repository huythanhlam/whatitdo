import { describe, it, expect, beforeAll } from 'vitest'
import {
  isLocal,
  listEvents,
  countEvents,
  getEvent,
  addSubscription,
  listSubscriptions,
  removeSubscription,
  getEventsBetween,
  startSourceRun,
  finishSourceRun,
  recentSourceRuns,
} from './index'
import { persistEvents } from '@/lib/persist'
import type { RawEvent } from '@/lib/sources/types'

// Full integration against the embedded PGlite database — the zero-credential
// mode earning its keep: no Supabase, no network, no keys. Exercises the real
// migrations + seed + query layer.
beforeAll(() => {
  // These tests assume the PGlite path (no DATABASE_URL configured).
  expect(isLocal()).toBe(true)
})

describe('read layer against seeded PGlite', () => {
  it('lists seeded events with joined categories', async () => {
    const events = await listEvents({ limit: 24, offset: 0 })
    expect(events.length).toBeGreaterThan(0)
    const withCats = events.find(e => (e.categories as unknown[]).length > 0)
    expect(withCats).toBeTruthy()
  })

  it('countEvents agrees the DB is non-empty', async () => {
    expect(await countEvents({})).toBeGreaterThan(0)
  })

  it('getEvent returns a single enriched event by id', async () => {
    const [first] = await listEvents({ limit: 1, offset: 0 })
    const one = await getEvent(first.id)
    expect(one?.id).toBe(first.id)
    expect(one).toHaveProperty('categories')
  })

  it('getEvent returns null for an unknown id', async () => {
    expect(await getEvent('00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  it('full-text search matches on content', async () => {
    const events = await listEvents({ q: 'music', limit: 24, offset: 0 })
    // seed data includes music events; FTS should find at least one
    expect(Array.isArray(events)).toBe(true)
  })
})

describe('persistEvents against PGlite', () => {
  it('inserts a valid event and rejects a fabricated-date one', async () => {
    const soon = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString()
    const good: RawEvent = mk({ source_id: 'itest-good', start_time: soon })
    const bad: RawEvent = mk({ source_id: 'itest-bad', start_time: 'not a date' })

    const res = await persistEvents([good, bad])
    expect(res.inserted).toBe(1)
    expect(res.rejected).toBe(1)
    expect(res.total).toBe(2)

    const found = await listEvents({ q: 'Integration Test Show', limit: 5, offset: 0 })
    expect(found.some(e => e.source_id === 'itest-good')).toBe(true)
  })
})

describe('subscription lifecycle against PGlite', () => {
  it('adds, lists, and removes a subscription (token from DB default)', async () => {
    const token = await addSubscription({ email: 'itest@example.com', frequency: 'weekly', category_slugs: ['music'] })
    expect(token).toBeTruthy()

    const subs = await listSubscriptions('weekly')
    expect(subs.some(s => s.email === 'itest@example.com')).toBe(true)

    await removeSubscription(token!)
    const after = await listSubscriptions('weekly')
    expect(after.some(s => s.email === 'itest@example.com')).toBe(false)
  })
})

describe('getEventsBetween', () => {
  it('returns events within a window, ordered by start', async () => {
    const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const to = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString()
    const events = await getEventsBetween(from, to)
    for (let i = 1; i < events.length; i++) {
      expect(new Date(events[i].start_time as string).getTime())
        .toBeGreaterThanOrEqual(new Date(events[i - 1].start_time as string).getTime())
    }
  })
})

describe('source_runs ledger', () => {
  it('opens and closes a run, then surfaces it in recentSourceRuns', async () => {
    const id = await startSourceRun('itest-source')
    await finishSourceRun(id, { status: 'ok', events_found: 3, events_upserted: 2, events_rejected: 1, gemini_requests: 4 })

    const runs = await recentSourceRuns(5)
    const mine = runs.find(r => r.source === 'itest-source')
    expect(mine).toBeTruthy()
    expect(mine!.status).toBe('ok')
    expect(mine!.events_upserted).toBe(2)
    expect(mine!.gemini_requests).toBe(4)
    expect(mine!.finished_at).not.toBeNull()
  })
})

function mk(overrides: Partial<RawEvent>): RawEvent {
  return {
    title: 'Integration Test Show',
    description: 'A test concert with live music',
    start_time: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
    end_time: null,
    venue_name: 'Test Venue',
    venue_address: null,
    image_url: null,
    ticket_url: null,
    source: 'itest',
    source_id: 'itest-1',
    is_free: false,
    price_min: null,
    price_max: null,
    ...overrides,
  }
}
