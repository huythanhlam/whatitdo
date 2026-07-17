import { describe, it, expect, beforeAll } from 'vitest'
import {
  isLocal,
  listEvents,
  recordInteraction,
  listRecommendedEvents,
  logImpressions,
  addFavorite,
  removeFavorite,
  listFavoriteIds,
  getActiveModel,
  getEventEngagement,
} from './index'
import { getPgliteDb } from './pglite'
import { newAnonId } from '@/lib/auth/session'

// Integration against embedded PGlite: exercises the full serving path — ranking
// with the seeded model, impression logging, favorites, and hide-exclusion.
beforeAll(() => {
  expect(isLocal()).toBe(true)
})

async function someEvents(n: number): Promise<string[]> {
  const events = await listEvents({ cityId: 1, limit: n, offset: 0 })
  return events.map(e => e.id)
}

describe('listRecommendedEvents', () => {
  it('returns ranked events with impressions and the active model version', async () => {
    const anonId = newAnonId()
    const { events, impressions, modelVersion } = await listRecommendedEvents(
      1,
      { userId: null, anonId },
      { limit: 8 }
    )
    expect(events.length).toBeGreaterThan(0)
    expect(events.length).toBeLessThanOrEqual(8)
    expect(impressions.length).toBe(events.length)
    const model = await getActiveModel()
    expect(modelVersion).toBe(model!.id)
    // Impression features are the scored vector, positions are contiguous.
    expect(impressions[0].features).toHaveProperty('category_affinity')
    expect(impressions.map(i => i.position)).toEqual([...Array(events.length).keys()])
    // Embeddings must never leak to the render payload.
    expect(events[0]).not.toHaveProperty('embedding')
  })

  it('reflects an actor’s affinity: a favorited category ranks its events higher', async () => {
    const anonId = newAnonId()
    const actor = { userId: null, anonId }

    // Find an event in a specific category and favorite it to build affinity.
    const events = await listEvents({ cityId: 1, limit: 50, offset: 0 })
    const target = events.find(e => (e.categories as { slug: string }[]).length > 0)!
    const slug = (target.categories as { slug: string }[])[0].slug
    for (let i = 0; i < 5; i++) await recordInteraction({ actor, type: 'favorite', eventId: target.id })

    const { events: ranked } = await listRecommendedEvents(1, actor, { limit: 20 })
    // At least one event of the favorited category should surface in the top slots.
    const topSlugs = ranked.slice(0, 10).flatMap(e => (e.categories as { slug: string }[]).map(c => c.slug))
    expect(topSlugs).toContain(slug)
  })

  it('excludes events the actor hid', async () => {
    const anonId = newAnonId()
    const actor = { userId: null, anonId }
    const [firstBefore] = await listRecommendedEvents(1, actor, { limit: 20 }).then(r => r.events)
    expect(firstBefore).toBeTruthy()

    await recordInteraction({ actor, type: 'hide', eventId: firstBefore.id })
    const after = await listRecommendedEvents(1, actor, { limit: 20 })
    expect(after.events.some(e => e.id === firstBefore.id)).toBe(false)
  })
})

describe('logImpressions', () => {
  it('writes one rec_impression per item and bumps event exposure', async () => {
    const anonId = newAnonId()
    const actor = { userId: null, anonId }
    const { impressions, modelVersion } = await listRecommendedEvents(1, actor, { limit: 5 })
    const serveId = newAnonId()
    const eventId = impressions[0].eventId
    const before = (await getEventEngagement(eventId))?.impressions ?? 0

    await logImpressions({ serveId, cityId: 1, actor, surface: 'rail', modelVersion, items: impressions })

    const db = await getPgliteDb()
    const [{ c }] = await db.query<{ c: string }>(
      `SELECT COUNT(*)::text c FROM rec_impressions WHERE serve_id = $1`,
      [serveId]
    )
    expect(parseInt(c, 10)).toBe(impressions.length)
    expect((await getEventEngagement(eventId))!.impressions).toBe(before + 1)
  })

  it('closes the loop: a favorite carrying the serve_id marks the impression engaged', async () => {
    const anonId = newAnonId()
    const actor = { userId: null, anonId }
    const { impressions, modelVersion } = await listRecommendedEvents(1, actor, { limit: 5 })
    const serveId = newAnonId()
    await logImpressions({ serveId, cityId: 1, actor, surface: 'rail', modelVersion, items: impressions })

    const eventId = impressions[0].eventId
    await recordInteraction({ actor, type: 'favorite', eventId, serveId })

    const db = await getPgliteDb()
    const [{ engaged }] = await db.query<{ engaged: boolean }>(
      `SELECT engaged FROM rec_impressions WHERE serve_id = $1 AND event_id = $2`,
      [serveId, eventId]
    )
    expect(engaged).toBe(true)
  })
})

describe('favorites', () => {
  it('adds, lists, and removes (idempotent add)', async () => {
    const anonId = newAnonId()
    const actor = { userId: null, anonId }
    const [a, b] = await someEvents(2)

    await addFavorite(actor, a)
    await addFavorite(actor, a) // idempotent
    await addFavorite(actor, b)
    let ids = await listFavoriteIds(actor)
    expect(new Set(ids)).toEqual(new Set([a, b]))

    await removeFavorite(actor, a)
    ids = await listFavoriteIds(actor)
    expect(ids).toEqual([b])
  })
})
