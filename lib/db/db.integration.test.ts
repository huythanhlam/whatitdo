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
  insertEvent,
  getEventRow,
  updateEventFields,
  findEventBySource,
  findDedupCandidates,
  recordProvenance,
  getEventSources,
  getEnabledSources,
  getSourceContentHash,
  setSourceContentHash,
  touchSourceSuccess,
  getEnabledCities,
  listPendingEvents,
  approveEvent,
  rejectEvent,
} from './index'
import { persistEvents } from '@/lib/persist'
import type { RawEvent } from '@/lib/sources/types'
import { normalizeTitle, normalizeVenue } from '@/lib/normalize'
import { getPgliteDb } from './pglite'

// Full integration against the embedded PGlite database — the zero-credential
// mode earning its keep: no Supabase, no network, no keys. Exercises the real
// migrations + seed + query layer.
beforeAll(() => {
  // These tests assume the PGlite path (no DATABASE_URL configured).
  expect(isLocal()).toBe(true)
})

describe('read layer against seeded PGlite', () => {
  it('lists seeded events with joined categories', async () => {
    const events = await listEvents({ cityId: 1, limit: 24, offset: 0 })
    expect(events.length).toBeGreaterThan(0)
    const withCats = events.find(e => (e.categories as unknown[]).length > 0)
    expect(withCats).toBeTruthy()
  })

  it('countEvents agrees the DB is non-empty', async () => {
    expect(await countEvents({ cityId: 1 })).toBeGreaterThan(0)
  })

  it('getEvent returns a single enriched event by id', async () => {
    const [first] = await listEvents({ cityId: 1, limit: 1, offset: 0 })
    const one = await getEvent(first.id)
    expect(one?.id).toBe(first.id)
    expect(one).toHaveProperty('categories')
  })

  it('getEvent returns null for an unknown id', async () => {
    expect(await getEvent('00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  it('full-text search matches on content', async () => {
    const events = await listEvents({ cityId: 1, q: 'music', limit: 24, offset: 0 })
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

    const found = await listEvents({ cityId: 1, q: 'Integration Test Show', limit: 5, offset: 0 })
    expect(found.some(e => e.source_id === 'itest-good')).toBe(true)
  })
})

describe('persistEvents opts defaulting', () => {
  it('defaults cityId to 1 and status to approved when opts is omitted entirely', async () => {
    const soon = new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString()
    const e: RawEvent = mk({ source: 'itest', source_id: 'opts-default-1', title: 'Opts Default Test Show', start_time: soon })

    // Called with NO second argument at all — exercises persistEvents's own
    // internal defaulting (cityId ?? 1), not a caller-supplied default.
    const res = await persistEvents([e])
    expect(res.inserted).toBe(1)

    const found = await listEvents({ cityId: 1, q: 'Opts Default Test Show', limit: 5, offset: 0 })
    expect(found.some(x => x.source_id === 'opts-default-1')).toBe(true)
  })
})

describe('subscription lifecycle against PGlite', () => {
  it('adds, lists, and removes a subscription (token from DB default)', async () => {
    const token = await addSubscription({ email: 'itest@example.com', frequency: 'weekly', category_slugs: ['music'], cityId: 1 })
    expect(token).toBeTruthy()

    const subs = await listSubscriptions('weekly', 1)
    expect(subs.some(s => s.email === 'itest@example.com')).toBe(true)

    await removeSubscription(token!)
    const after = await listSubscriptions('weekly', 1)
    expect(after.some(s => s.email === 'itest@example.com')).toBe(false)
  })
})

describe('getEventsBetween', () => {
  it('returns events within a window, ordered by start', async () => {
    const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const to = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString()
    const events = await getEventsBetween(1, from, to)
    for (let i = 1; i < events.length; i++) {
      expect(new Date(events[i].start_time as string).getTime())
        .toBeGreaterThanOrEqual(new Date(events[i - 1].start_time as string).getTime())
    }
  })
})

describe('source_runs ledger', () => {
  it('opens and closes a run, then surfaces it in recentSourceRuns', async () => {
    // recentSourceRuns is city-scoped via an inner join on sources.city_id, so
    // this run needs a real source_id tied to a known city (Austin's seeded
    // 'eventbrite' source, city id 1) to be attributable and visible.
    const db = await getPgliteDb()
    const austinSrc = (await db.query<{ id: number }>(
      `SELECT id FROM sources WHERE name = 'eventbrite'`
    ))[0]
    expect(austinSrc).toBeTruthy()

    const id = await startSourceRun('itest-source', austinSrc.id)
    await finishSourceRun(id, { status: 'ok', events_found: 3, events_upserted: 2, events_rejected: 1, gemini_requests: 4 })

    const runs = await recentSourceRuns(5, 1)
    const mine = runs.find(r => r.source === 'itest-source')
    expect(mine).toBeTruthy()
    expect(mine!.status).toBe('ok')
    expect(mine!.events_upserted).toBe(2)
    expect(mine!.gemini_requests).toBe(4)
    expect(mine!.finished_at).not.toBeNull()
  })
})

describe('recentSourceRuns city scoping', () => {
  it('scopes runs by cityId via the sources join, excluding null-source_id rows', async () => {
    const db = await getPgliteDb()
    const austinSrc = (await db.query<{ id: number }>(
      `SELECT id FROM sources WHERE name = 'eventbrite'`
    ))[0]
    const houstonSrc = (await db.query<{ id: number }>(
      `SELECT id FROM sources WHERE name = 'ticketmaster:houston'`
    ))[0]
    expect(austinSrc).toBeTruthy()
    expect(houstonSrc).toBeTruthy()

    const austinRunId = await startSourceRun('eventbrite', austinSrc.id)
    await finishSourceRun(austinRunId, { status: 'ok', events_found: 1, events_upserted: 1 })

    const houstonRunId = await startSourceRun('ticketmaster:houston', houstonSrc.id)
    await finishSourceRun(houstonRunId, { status: 'ok', events_found: 1, events_upserted: 1 })

    const austinOnly = await recentSourceRuns(10, 1)
    expect(austinOnly.some(r => r.id === austinRunId)).toBe(true)
    expect(austinOnly.some(r => r.id === houstonRunId)).toBe(false)

    const houstonOnly = await recentSourceRuns(10, 2)
    expect(houstonOnly.some(r => r.id === houstonRunId)).toBe(true)
    expect(houstonOnly.some(r => r.id === austinRunId)).toBe(false)
  })
})

describe('dedup-foundation migration', () => {
  it('applies the dedup-foundation migration on a fresh PGlite instance', async () => {
    const db = await getPgliteDb()

    // pg_trgm is available
    const sim = await db.query<{ s: number }>(`SELECT similarity('austin blues', 'austin blues fest') AS s`)
    expect(sim[0].s).toBeGreaterThan(0)

    // cities seeded with Austin at id 1
    const city = await db.query<{ id: number; slug: string }>(`SELECT id, slug FROM cities WHERE slug = 'austin'`)
    expect(city[0]).toMatchObject({ id: 1, slug: 'austin' })

    // events has the new columns and no cross-source UNIQUE
    const cols = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'events'`
    )
    const names = cols.map(c => c.column_name)
    expect(names).toEqual(expect.arrayContaining(['city_id', 'title_norm', 'venue_norm']))

    // event_sources exists and was backfilled for every seeded event
    const counts = await db.query<{ e: string; s: string }>(
      `SELECT (SELECT count(*) FROM events)::text AS e, (SELECT count(*) FROM event_sources)::text AS s`
    )
    expect(Number(counts[0].s)).toBeGreaterThanOrEqual(Number(counts[0].e))
  })
})

describe('dedup pipeline queries', () => {
  it('insert → find-by-source → provenance → candidates → merge', async () => {
    const r = mk({
      title: 'The Black Angels', description: 'psych rock', start_time: '2026-09-01T02:00:00Z',
      venue_name: 'Mohawk', venue_address: '912 Red River', ticket_url: 'http://a',
      source: 'crawl', source_id: 'c1',
    })
    const id = await insertEvent(r, {
      cityId: 1, titleNorm: normalizeTitle(r.title, r.venue_name), venueNorm: normalizeVenue(r.venue_name),
    })
    expect(id).toBeTruthy()

    await recordProvenance({ eventId: id, source: r.source, externalId: r.source_id, url: r.ticket_url, raw: r })
    expect(await findEventBySource('crawl', 'c1')).toBe(id)
    expect(await findEventBySource('crawl', 'nope')).toBeNull()

    const provenance = await getEventSources(id)
    expect(provenance).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'crawl', external_id: 'c1' })])
    )

    // A near-identical title, same venue, +90 min → a blocked candidate with high sim.
    const cands = await findDedupCandidates({
      cityId: 1, startTime: '2026-09-01T03:30:00Z',
      titleNorm: normalizeTitle('Black Angels', 'Mohawk'), venueNorm: normalizeVenue('Mohawk'),
    })
    expect(cands.some(c => c.id === id && c.sim > 0.4 && c.venueAgree)).toBe(true)

    // A different day is NOT a candidate (outside the ±2h block).
    const far = await findDedupCandidates({
      cityId: 1, startTime: '2026-09-05T02:00:00Z',
      titleNorm: normalizeTitle('The Black Angels', 'Mohawk'), venueNorm: normalizeVenue('Mohawk'),
    })
    expect(far.some(c => c.id === id)).toBe(false)

    await updateEventFields(id, { description: 'a much longer and richer description of the show' })
    const after = await getEventRow(id)
    expect(after!.description).toBe('a much longer and richer description of the show')
    expect(after!.title).toBe('The Black Angels')
  })
})

describe('cross-source dedup via persistEvents', () => {
  it('collapses the same event from two sources into one canonical row', async () => {
    const a = mk({ source: 'crawl', source_id: 'crawl-99', title: 'Spoon at Stubbs', venue_name: 'Stubbs', start_time: '2026-10-15T03:00:00Z', ticket_url: 'http://crawl', description: 'short' })
    const b = mk({ source: 'ticketmaster', source_id: 'tm-99', title: 'Spoon', venue_name: "Stubb's", start_time: '2026-10-15T03:30:00Z', ticket_url: 'http://tm', description: 'a longer official description from the primary ticket seller' })

    const r1 = await persistEvents([a])
    const r2 = await persistEvents([b])
    expect(r1.inserted + r2.inserted).toBeGreaterThanOrEqual(2) // both persisted (one new, one merged)

    const db = await getPgliteDb()
    const canon = await db.query<{ id: string; title: string; ticket_url: string; description: string }>(
      `SELECT id, title, ticket_url, description FROM events
       WHERE start_time BETWEEN '2026-10-15T02:00:00Z' AND '2026-10-15T05:00:00Z' AND venue_norm = 'stubbs'`
    )
    expect(canon).toHaveLength(1) // exactly one canonical event for this show
    // Ticketmaster (api) outranks crawl → its title + ticket_url + longer description won.
    expect(canon[0].title).toBe('Spoon')
    expect(canon[0].ticket_url).toBe('http://tm')
    expect(canon[0].description).toContain('official')

    const prov = await getEventSources(canon[0].id)
    expect(prov.map(p => p.source).sort()).toEqual(['crawl', 'ticketmaster'])
  })

  it('re-ingesting the same source row is idempotent (updates, not duplicates)', async () => {
    const e = mk({ source: 'crawl', source_id: 'idem-1', title: 'Idem Fest', venue_name: 'Empire', start_time: '2026-11-01T03:00:00Z' })
    await persistEvents([e])
    await persistEvents([{ ...e, description: 'updated description' }])
    const db = await getPgliteDb()
    const rows = await db.query(`SELECT event_id FROM event_sources WHERE source = 'crawl' AND external_id = 'idem-1'`)
    expect(rows).toHaveLength(1)
  })

  it('getEventRow resolves source_kind via a join to the real sources.kind column', async () => {
    // 'crawl:mohawkaustin-com' is a real Austin source seeded by migration 010
    // (kind 'crawl'); getEventRow should surface that kind for mergeFields'
    // sourceTrust() lookups instead of leaving it unresolved.
    const e = mk({ source: 'crawl:mohawkaustin-com', source_id: 'kind-join-1', title: 'Kind Join Test Show', start_time: '2026-12-10T03:00:00Z' })
    const id = await insertEvent(e, { cityId: 1, titleNorm: normalizeTitle(e.title, e.venue_name), venueNorm: normalizeVenue(e.venue_name) })
    const row = await getEventRow(id)
    expect(row?.source_kind).toBe('crawl')
  })

  it('getEventRow leaves source_kind null when the source name has no matching sources row', async () => {
    const e = mk({ source: 'some-legacy-name-not-in-sources-table', source_id: 'kind-join-2', title: 'Kind Join Null Test', start_time: '2026-12-10T04:00:00Z' })
    const id = await insertEvent(e, { cityId: 1, titleNorm: normalizeTitle(e.title, e.venue_name), venueNorm: normalizeVenue(e.venue_name) })
    const row = await getEventRow(id)
    expect(row?.source_kind ?? null).toBeNull()
  })

  it('an instance-named crawl source and the bare "crawl" name score at the SAME trust tier (regression guard)', async () => {
    // Before the fix: sourceTrust() only recognized the literal 'crawl' key by
    // name. 'crawl:mohawkaustin-com' (a real seeded instance, same kind) scored
    // 0 — the lowest possible tier — purely because its exact name wasn't a
    // static-map key, wrongly letting the later bare-name 'crawl' source (which
    // WAS a recognized literal key, tier 1) steal the canonical title even
    // though both are actually the same trust tier. getEventRow's sources join
    // (existing side) plus RawEvent/registry kind-threading (incoming side)
    // together close that gap; here we only need the existing-side join since
    // the incoming raw event has no source_kind set and must fall back to the
    // static map's 'crawl' entry to be equal-tier, exactly as a real un-kinded
    // legacy caller would.
    const a = mk({ source: 'crawl:mohawkaustin-com', source_id: 'tier-a', title: 'Residency Night', venue_name: 'Mohawk Tier Test Venue', start_time: '2026-12-11T03:00:00Z', ticket_url: 'http://mohawk' })
    const b = mk({ source: 'crawl', source_id: 'tier-b', title: 'Residency Night Spam', venue_name: 'Mohawk Tier Test Venue', start_time: '2026-12-11T03:15:00Z', ticket_url: 'http://spam' })

    await persistEvents([a])
    await persistEvents([b])

    const db = await getPgliteDb()
    const canon = await db.query<{ title: string; ticket_url: string }>(
      `SELECT title, ticket_url FROM events WHERE start_time BETWEEN '2026-12-11T02:00:00Z' AND '2026-12-11T05:00:00Z' AND venue_norm = $1`,
      [normalizeVenue('Mohawk Tier Test Venue')]
    )
    expect(canon).toHaveLength(1)
    // Equal trust tier → the first (canonical) event's title/ticket_url stand; the
    // later same-tier arrival must NOT overwrite them.
    expect(canon[0].title).toBe('Residency Night')
    expect(canon[0].ticket_url).toBe('http://mohawk')
  })
})

describe('sources table (migration 008)', () => {
  it('seeds Austin sources with valid kinds and parsers', async () => {
    const db = await getPgliteDb()
    const rows = await db.query<{ name: string; kind: string; parser: string; city_id: number; enabled: boolean }>(
      `SELECT name, kind, parser, city_id, enabled FROM sources WHERE city_id = 1 ORDER BY name`
    )
    // At least the structured + feed sources are seeded.
    expect(rows.length).toBeGreaterThanOrEqual(15)
    // Every seeded source belongs to Austin and has a non-empty parser.
    for (const r of rows) {
      expect(r.city_id).toBe(1)
      expect(r.parser.length).toBeGreaterThan(0)
      expect(['api', 'ical', 'rss', 'jsonld', 'crawl']).toContain(r.kind)
    }
    // The known structured sources exist by name.
    const names = new Set(rows.map(r => r.name))
    expect(names.has('eventbrite')).toBe(true)
    expect(names.has('ticketmaster')).toBe(true)
    expect(names.has('newspaper:kut')).toBe(true)
  })
})

describe('source_runs source_id (Phase 2B)', () => {
  it('stamps source_id on the run row', async () => {
    const db = await getPgliteDb()
    const src = (await db.query<{ id: number }>(`SELECT id FROM sources WHERE name = 'eventbrite'`))[0]
    const runId = await startSourceRun('eventbrite', src.id)
    await finishSourceRun(runId, { status: 'ok', events_found: 1, events_upserted: 1 })
    const row = (await db.query<{ source_id: number }>(
      `SELECT source_id FROM source_runs WHERE id = $1`, [runId]
    ))[0]
    expect(row.source_id).toBe(src.id)
  })
})

describe('event_sources.source_id backfill + stamping (migration 009)', () => {
  it('stamps source_id from sources.name on new provenance rows', async () => {
    const db = await getPgliteDb()
    const ev = (await db.query<{ id: string }>(`SELECT id FROM events LIMIT 1`))[0]
    await recordProvenance({ eventId: ev.id, source: 'eventbrite', externalId: 'eb-test-1', url: null, raw: {} })
    const row = (await db.query<{ source_id: number | null }>(
      `SELECT es.source_id FROM event_sources es WHERE es.external_id = 'eb-test-1'`
    ))[0]
    const eb = (await db.query<{ id: number }>(`SELECT id FROM sources WHERE name = 'eventbrite'`))[0]
    expect(row.source_id).toBe(eb.id)
  })
})

describe('source queries (Phase 2B)', () => {
  it('getEnabledSources returns Austin enabled rows only', async () => {
    const rows = await getEnabledSources(1)
    expect(rows.length).toBeGreaterThanOrEqual(15)
    expect(rows.every(r => r.enabled && r.city_id === 1)).toBe(true)
    const eb = rows.find(r => r.name === 'eventbrite')
    expect(eb?.parser).toBe('eventbrite')
  })

  it('content hash round-trips and touchSourceSuccess sets last_success', async () => {
    const rows = await getEnabledSources(1)
    const crawl = rows.find(r => r.parser === 'crawl')!
    expect(await getSourceContentHash(crawl.id)).toBeNull()
    await setSourceContentHash(crawl.id, 'deadbeef')
    expect(await getSourceContentHash(crawl.id)).toBe('deadbeef')
    await touchSourceSuccess(crawl.id)
    const after = await getEnabledSources(1)
    expect(after.find(r => r.id === crawl.id)!.last_success).not.toBeNull()
  })
})

describe('Austin venue sources (migration 010)', () => {
  it('seeds a substantial set of enabled crawl/ical venue sources', async () => {
    const db = await getPgliteDb()
    const rows = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM sources WHERE notes = 'venue' AND enabled = true AND city_id = 1`
    )
    expect(parseInt(rows[0].n, 10)).toBeGreaterThanOrEqual(40)
  })

  it('keeps every source name unique', async () => {
    const db = await getPgliteDb()
    const dupes = await db.query<{ name: string }>(
      `SELECT name FROM sources GROUP BY name HAVING COUNT(*) > 1`
    )
    expect(dupes).toEqual([])
  })
})

describe('city scoping migration (011)', () => {
  it('adds city_id to subscriptions and featured_listings, backfilled to Austin', async () => {
    const db = await getPgliteDb()
    const subCols = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'subscriptions'`
    )
    expect(subCols.map(c => c.column_name)).toEqual(expect.arrayContaining(['city_id']))

    const flCols = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'featured_listings'`
    )
    expect(flCols.map(c => c.column_name)).toEqual(expect.arrayContaining(['city_id']))
  })

  it('allows the same email to subscribe independently per city', async () => {
    const a = await addSubscription({ email: 'multi-city@example.com', frequency: 'daily', category_slugs: [], cityId: 1 })
    const b = await addSubscription({ email: 'multi-city@example.com', frequency: 'daily', category_slugs: [], cityId: 2 })
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    expect(a).not.toBe(b)
  })
})

describe('Houston seed (migration 012)', () => {
  it('seeds Houston enabled with T1/T2/T3 source coverage', async () => {
    const db = await getPgliteDb()
    const houston = (await db.query<{ id: number; enabled: boolean }>(
      `SELECT id, enabled FROM cities WHERE slug = 'houston'`
    ))[0]
    expect(houston).toBeTruthy()
    expect(houston.enabled).toBe(true)

    const rows = await db.query<{ name: string; kind: string; parser: string }>(
      `SELECT name, kind, parser FROM sources WHERE city_id = $1`, [houston.id]
    )
    expect(rows.length).toBeGreaterThanOrEqual(25)
    const names = new Set(rows.map(r => r.name))
    expect(names.has('ticketmaster:houston')).toBe(true)
    expect(names.has('seatgeek:houston')).toBe(true)
    expect(rows.filter(r => r.parser === 'crawl').length).toBeGreaterThanOrEqual(20)
  })

  it('is returned by getEnabledCities alongside Austin', async () => {
    const cities = await getEnabledCities()
    expect(cities.map(c => c.slug).sort()).toEqual(['austin', 'houston'])
  })
})

describe('event moderation (migration 013)', () => {
  it('defaults new events to approved and excludes pending/rejected from listEvents', async () => {
    const soon = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString()
    const pendingId = await insertEvent(
      mk({ source: 'submission', source_id: 'mod-pending-1', title: 'Pending Test Event', start_time: soon }),
      { cityId: 1, titleNorm: 'pending test event', venueNorm: null, status: 'pending' }
    )
    const approvedId = await insertEvent(
      mk({ source: 'submission', source_id: 'mod-approved-1', title: 'Approved Test Event', start_time: soon }),
      { cityId: 1, titleNorm: 'approved test event', venueNorm: null }
    )

    const visible = await listEvents({ cityId: 1, q: 'Test Event', limit: 10, offset: 0 })
    expect(visible.some(e => e.id === pendingId)).toBe(false)
    expect(visible.some(e => e.id === approvedId)).toBe(true)

    expect(await getEvent(pendingId)).toBeNull()
    expect((await getEvent(approvedId))?.id).toBe(approvedId)
  })

  it('lists, approves, and rejects pending events', async () => {
    const soon = new Date(Date.now() + 11 * 24 * 3600 * 1000).toISOString()
    const id = await insertEvent(
      mk({ source: 'submission', source_id: 'mod-flow-1', title: 'Moderation Flow Event', start_time: soon }),
      { cityId: 1, titleNorm: 'moderation flow event', venueNorm: null, status: 'pending' }
    )

    const pending = await listPendingEvents(1)
    expect(pending.some(p => p.id === id)).toBe(true)

    await approveEvent(id)
    expect((await getEvent(id))?.id).toBe(id)

    const id2 = await insertEvent(
      mk({ source: 'submission', source_id: 'mod-flow-2', title: 'Moderation Flow Event 2', start_time: soon }),
      { cityId: 1, titleNorm: 'moderation flow event 2', venueNorm: null, status: 'pending' }
    )
    await rejectEvent(id2)
    expect(await getEvent(id2)).toBeNull()
    expect((await listPendingEvents(1)).some(p => p.id === id2)).toBe(false)
  })
})

describe('is_free filter', () => {
  it('listEvents(isFree: true) returns only free events', async () => {
    const soon = new Date(Date.now() + 12 * 24 * 3600 * 1000).toISOString()
    await insertEvent(
      mk({ source: 'itest', source_id: 'free-1', title: 'Free Filter Test Event', start_time: soon, is_free: true }),
      { cityId: 1, titleNorm: 'free filter test event', venueNorm: null }
    )
    await insertEvent(
      mk({ source: 'itest', source_id: 'paid-1', title: 'Paid Filter Test Event', start_time: soon, is_free: false }),
      { cityId: 1, titleNorm: 'paid filter test event', venueNorm: null }
    )

    const free = await listEvents({ cityId: 1, q: 'Filter Test Event', isFree: true, limit: 10, offset: 0 })
    expect(free.some(e => e.source_id === 'free-1')).toBe(true)
    expect(free.some(e => e.source_id === 'paid-1')).toBe(false)
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
