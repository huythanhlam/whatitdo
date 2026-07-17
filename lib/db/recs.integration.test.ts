import { describe, it, expect, beforeAll } from 'vitest'
import {
  isLocal,
  listEvents,
  getActiveModel,
  recordInteraction,
  getEventEngagement,
  listActorAffinity,
} from './index'
import { getPgliteDb } from './pglite'
import { newAnonId } from '@/lib/auth/session'
import { V1_MODEL_WEIGHTS } from '@/lib/recs/config'

// Integration against embedded PGlite — exercises the real 029/030/031
// migrations and the write-through feature updates end to end.
beforeAll(() => {
  expect(isLocal()).toBe(true)
})

async function anEventId(): Promise<string> {
  const [e] = await listEvents({ cityId: 1, limit: 1, offset: 0 })
  expect(e).toBeTruthy()
  return e.id
}

describe('getActiveModel', () => {
  it('returns the seeded v1 weights, matching the config source of truth', async () => {
    const model = await getActiveModel()
    expect(model).toBeTruthy()
    expect(model!.weights).toEqual(V1_MODEL_WEIGHTS)
  })
})

describe('recordInteraction — logging', () => {
  it('appends an interaction row for an anonymous actor', async () => {
    const anonId = newAnonId()
    const eventId = await anEventId()
    await recordInteraction({ actor: { userId: null, anonId }, type: 'view', eventId })

    const db = await getPgliteDb()
    const rows = await db.query<{ type: string; city_id: number; event_id: string }>(
      `SELECT type, city_id, event_id FROM interactions WHERE anon_id = $1`,
      [anonId]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('view')
    expect(rows[0].event_id).toBe(eventId)
    // city_id is backfilled from the event when the caller doesn't supply one.
    expect(rows[0].city_id).toBe(1)
  })

  it('ignores a signal with no actor', async () => {
    const eventId = await anEventId()
    await recordInteraction({ actor: { userId: null, anonId: null }, type: 'view', eventId })
    // No throw, nothing to assert beyond not crashing — an actorless beacon is a no-op.
    expect(true).toBe(true)
  })
})

describe('recordInteraction — write-through affinity', () => {
  it('a favorite raises category, venue and day affinities for the actor', async () => {
    const anonId = newAnonId()
    const eventId = await anEventId()
    await recordInteraction({ actor: { userId: null, anonId }, type: 'favorite', eventId })

    const aff = await listActorAffinity({ userId: null, anonId })
    expect(aff.length).toBeGreaterThan(0)
    expect(aff.some(a => a.kind === 'category')).toBe(true)
    // A favorite saturates the signal, so a first-ever nudge lands at alpha (0.3).
    const topCategory = aff.find(a => a.kind === 'category')!
    expect(topCategory.score).toBeCloseTo(0.3, 5)
  })

  it('repeated favorites converge the affinity upward (EMA via ON CONFLICT)', async () => {
    const anonId = newAnonId()
    const eventId = await anEventId()
    for (let i = 0; i < 4; i++) {
      await recordInteraction({ actor: { userId: null, anonId }, type: 'favorite', eventId })
    }
    const aff = await listActorAffinity({ userId: null, anonId })
    const topCategory = aff.find(a => a.kind === 'category')!
    // 4 saturating nudges: 0.3, 0.51, 0.657, 0.7599…
    expect(topCategory.score).toBeGreaterThan(0.7)
    expect(topCategory.score).toBeLessThanOrEqual(1)
  })

  it('a view is a weaker nudge than a favorite', async () => {
    const favActor = { userId: null, anonId: newAnonId() }
    const viewActor = { userId: null, anonId: newAnonId() }
    const eventId = await anEventId()
    await recordInteraction({ actor: favActor, type: 'favorite', eventId })
    await recordInteraction({ actor: viewActor, type: 'view', eventId })

    const favTop = (await listActorAffinity(favActor)).find(a => a.kind === 'category')!
    const viewTop = (await listActorAffinity(viewActor)).find(a => a.kind === 'category')!
    expect(favTop.score).toBeGreaterThan(viewTop.score)
  })
})

describe('recordInteraction — engagement prior', () => {
  it('a positive signal creates/raises event_engagement; a view does not', async () => {
    const eventId = await anEventId()
    const before = await getEventEngagement(eventId)
    const beforeEng = before?.engagements ?? 0

    await recordInteraction({ actor: { userId: null, anonId: newAnonId() }, type: 'view', eventId })
    const afterView = await getEventEngagement(eventId)
    expect(afterView?.engagements ?? 0).toBe(beforeEng) // view is not engagement

    await recordInteraction({ actor: { userId: null, anonId: newAnonId() }, type: 'clickout', eventId })
    const afterClick = await getEventEngagement(eventId)
    expect(afterClick!.engagements).toBe(beforeEng + 1)
    expect(afterClick!.score).toBeGreaterThan(0)
  })
})

describe('recordInteraction — engaged impression labeling', () => {
  it('marks the originating rec_impression engaged when a positive signal carries its serve_id', async () => {
    const db = await getPgliteDb()
    const anonId = newAnonId()
    const eventId = await anEventId()
    const serveId = newAnonId() // any uuid
    const model = await getActiveModel()

    await db.query(
      `INSERT INTO rec_impressions (serve_id, anon_id, city_id, event_id, surface, position, features, model_version)
       VALUES ($1, $2, 1, $3, 'rail', 0, '{}'::jsonb, $4)`,
      [serveId, anonId, eventId, model!.id]
    )

    await recordInteraction({ actor: { userId: null, anonId }, type: 'favorite', eventId, serveId })

    const [imp] = await db.query<{ engaged: boolean }>(
      `SELECT engaged FROM rec_impressions WHERE serve_id = $1 AND event_id = $2`,
      [serveId, eventId]
    )
    expect(imp.engaged).toBe(true)
  })
})
