import { describe, it, expect, beforeAll } from 'vitest'
import {
  isLocal,
  listEvents,
  getOrCreateUser,
  getUserByEmail,
  createAuthToken,
  consumeAuthToken,
  createSession,
  getSessionUser,
  deleteSession,
  addFavorite,
  listFavoriteIds,
  recordInteraction,
  mergeAnonIntoUser,
  addSubscription,
  confirmSubscription,
  linkSubscriptionsToUser,
  getDigestSubscription,
  setUserInterests,
  setExplicitAffinities,
  listUserInterests,
  listActorAffinity,
  listInterestedEventIds,
  listHiddenEventIds,
  unhideEvent,
  clearActorHistory,
  deleteUser,
} from './index'
import { getPgliteDb } from './pglite'
import { newAnonId, newAuthToken } from '@/lib/auth/session'

// Integration against embedded PGlite — exercises the real 029–033 migrations and
// the account/merge helpers end to end.
beforeAll(() => {
  expect(isLocal()).toBe(true)
})

async function eventIds(n: number): Promise<string[]> {
  const rows = await listEvents({ cityId: 1, limit: n, offset: 0 })
  expect(rows.length).toBeGreaterThanOrEqual(n)
  return rows.map(e => e.id)
}

describe('users', () => {
  it('get-or-create is idempotent per email', async () => {
    const a = await getOrCreateUser('Idem@example.com'.toLowerCase())
    const b = await getOrCreateUser('idem@example.com')
    expect(b.id).toBe(a.id)
    expect((await getUserByEmail('idem@example.com'))?.id).toBe(a.id)
  })
})

describe('magic-link tokens', () => {
  it('consume returns the payload once, then null (single-use)', async () => {
    const token = newAuthToken()
    await createAuthToken({ token, email: 'tok@example.com', wantsDigest: true, expiresAt: new Date(Date.now() + 60_000) })
    const first = await consumeAuthToken(token)
    expect(first).toEqual({ email: 'tok@example.com', wantsDigest: true })
    expect(await consumeAuthToken(token)).toBeNull()
  })

  it('rejects an expired token', async () => {
    const token = newAuthToken()
    await createAuthToken({ token, email: 'exp@example.com', wantsDigest: false, expiresAt: new Date(Date.now() - 1000) })
    expect(await consumeAuthToken(token)).toBeNull()
  })
})

describe('sessions', () => {
  it('creates, resolves, and deletes a session', async () => {
    const user = await getOrCreateUser('sess@example.com')
    const sid = await createSession(user.id)
    expect(await getSessionUser(sid)).toBe(user.id)
    await deleteSession(sid)
    expect(await getSessionUser(sid)).toBeNull()
  })

  it('treats an expired session as no session', async () => {
    const user = await getOrCreateUser('sessexp@example.com')
    const db = await getPgliteDb()
    await db.query(`INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)`, [
      'expired-sid-xyz',
      user.id,
      new Date(Date.now() - 1000).toISOString(),
    ])
    expect(await getSessionUser('expired-sid-xyz')).toBeNull()
  })
})

describe('mergeAnonIntoUser', () => {
  it('re-keys non-colliding history and drops collisions, idempotently', async () => {
    const [e1, e2] = await eventIds(2)
    const user = await getOrCreateUser('merge@example.com')
    const anonId = newAnonId()

    // User already saved e1; anon saved e1 (collision) and e2 (fresh).
    await addFavorite({ userId: user.id, anonId: null }, e1)
    await addFavorite({ userId: null, anonId }, e1)
    await addFavorite({ userId: null, anonId }, e2)
    // Anon implicit signal + explicit interest (derived).
    await recordInteraction({ actor: { userId: null, anonId }, type: 'view', eventId: e2 })

    await mergeAnonIntoUser(user.id, anonId)

    // Favorites: e1 (kept, no dupe) + e2 (moved) = 2 for the user, 0 for the anon.
    const userFavs = await listFavoriteIds({ userId: user.id, anonId: null })
    expect(new Set(userFavs)).toEqual(new Set([e1, e2]))
    expect(await listFavoriteIds({ userId: null, anonId })).toHaveLength(0)

    // Interactions re-keyed off the anon id.
    const db = await getPgliteDb()
    const anonInts = await db.query(`SELECT 1 FROM interactions WHERE anon_id = $1`, [anonId])
    expect(anonInts).toHaveLength(0)
    const userInts = await db.query(`SELECT 1 FROM interactions WHERE user_id = $1`, [user.id])
    expect(userInts.length).toBeGreaterThan(0)

    // Second merge is a no-op (nothing left under the anon id) and must not throw.
    await mergeAnonIntoUser(user.id, anonId)
    expect(new Set(await listFavoriteIds({ userId: user.id, anonId: null }))).toEqual(new Set([e1, e2]))
  })

  it('re-keys the affinity/vector/impression stores too', async () => {
    const [e1] = await eventIds(1)
    const user = await getOrCreateUser('merge2@example.com')
    const anonId = newAnonId()
    const db = await getPgliteDb()

    // Anon rows across the three no-FK actor stores.
    await recordInteraction({ actor: { userId: null, anonId }, type: 'favorite', eventId: e1 }) // writes user_affinity
    await db.query(`INSERT INTO user_vectors (anon_id, vec, n) VALUES ($1, $2, 1)`, [anonId, [0.1, 0.2, 0.3]])
    await db.query(
      `INSERT INTO rec_impressions (serve_id, anon_id, city_id, event_id, surface, position, features, model_version)
       SELECT $1, $2, 1, $3, 'rail', 0, '{}'::jsonb, id FROM model_versions WHERE status = 'active' LIMIT 1`,
      [newAnonId(), anonId, e1]
    )

    await mergeAnonIntoUser(user.id, anonId)

    for (const table of ['user_affinity', 'user_vectors', 'rec_impressions']) {
      const anonLeft = await db.query(`SELECT 1 FROM ${table} WHERE anon_id = $1`, [anonId])
      expect(anonLeft, `${table} should have no anon rows left`).toHaveLength(0)
      const userRows = await db.query(`SELECT 1 FROM ${table} WHERE user_id = $1`, [user.id])
      expect(userRows.length, `${table} should have user rows`).toBeGreaterThan(0)
    }
  })
})

describe('digest opt-in at verify', () => {
  it('creates exactly one confirmed subscription linked to the user', async () => {
    const user = await getOrCreateUser('digest@example.com')
    const token = await addSubscription({ email: user.email, frequency: 'weekly', category_slugs: [], cityId: 1 })
    expect(token).toBeTruthy()
    await confirmSubscription(token!)
    await linkSubscriptionsToUser(user.id, user.email)

    const sub = await getDigestSubscription(user.email, 1)
    expect(sub?.confirmed).toBe(true)
    expect(sub?.frequency).toBe('weekly')

    const db = await getPgliteDb()
    const rows = await db.query<{ user_id: string }>(
      `SELECT user_id FROM subscriptions WHERE email = $1 AND city_id = 1`,
      [user.email]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].user_id).toBe(user.id)
  })

  it('auto-confirms a pre-existing unconfirmed subscription for the verified email', async () => {
    const email = 'preexist@example.com'
    await addSubscription({ email, frequency: 'weekly', category_slugs: ['music'], cityId: 1 }) // unconfirmed
    const user = await getOrCreateUser(email)
    await linkSubscriptionsToUser(user.id, email)
    expect((await getDigestSubscription(email, 1))?.confirmed).toBe(true)
  })
})

describe('explicit interests → affinity', () => {
  it('writes user_interests and the live affinity, profile overriding onboarding', async () => {
    const user = await getOrCreateUser('interests@example.com')
    await setUserInterests(user.id, 'onboarding', [{ kind: 'category', value: 'music', weight: 1 }])
    await setExplicitAffinities(user.id, [{ kind: 'category', value: 'music' }], 0.8)

    const aff = await listActorAffinity({ userId: user.id, anonId: null })
    expect(aff.find(a => a.kind === 'category' && a.value === 'music')?.score).toBeCloseTo(0.8, 5)

    // A profile edit for the same key re-owns the row (source flips to 'profile').
    await setUserInterests(user.id, 'profile', [{ kind: 'category', value: 'music', weight: 1 }])
    const rows = await listUserInterests(user.id)
    const music = rows.filter(r => r.kind === 'category' && r.value === 'music')
    expect(music).toHaveLength(1)
    expect(music[0].source).toBe('profile')
  })
})

describe('interested / hidden state + privacy', () => {
  it('derives interested/hidden from the log and supports unhide', async () => {
    const [e1, e2] = await eventIds(2)
    const user = await getOrCreateUser('state@example.com')
    const actor = { userId: user.id, anonId: null }

    await recordInteraction({ actor, type: 'interested', eventId: e1 })
    await recordInteraction({ actor, type: 'hide', eventId: e2 })
    expect(await listInterestedEventIds(actor)).toContain(e1)
    expect(await listHiddenEventIds(actor)).toContain(e2)

    // Latest state wins: uninterested after interested drops it from the list.
    await recordInteraction({ actor, type: 'uninterested', eventId: e1 })
    expect(await listInterestedEventIds(actor)).not.toContain(e1)

    await unhideEvent(actor, e2)
    expect(await listHiddenEventIds(actor)).not.toContain(e2)
  })

  it('clearActorHistory drops behavior but keeps favorites', async () => {
    const [e1] = await eventIds(1)
    const user = await getOrCreateUser('clear@example.com')
    const actor = { userId: user.id, anonId: null }
    await addFavorite(actor, e1)
    await recordInteraction({ actor, type: 'view', eventId: e1 })

    await clearActorHistory(actor)

    const db = await getPgliteDb()
    expect(await db.query(`SELECT 1 FROM interactions WHERE user_id = $1`, [user.id])).toHaveLength(0)
    expect(await db.query(`SELECT 1 FROM user_affinity WHERE user_id = $1`, [user.id])).toHaveLength(0)
    // Favorites survive — they're an explicit list, not history.
    expect(await listFavoriteIds(actor)).toContain(e1)
  })

  it('deleteUser removes the account and cascades', async () => {
    const [e1] = await eventIds(1)
    const user = await getOrCreateUser('delete@example.com')
    const actor = { userId: user.id, anonId: null }
    await addFavorite(actor, e1)
    await recordInteraction({ actor, type: 'favorite', eventId: e1 })
    const sid = await createSession(user.id)

    await deleteUser(user.id)

    expect(await getUserByEmail('delete@example.com')).toBeNull()
    expect(await getSessionUser(sid)).toBeNull()
    const db = await getPgliteDb()
    expect(await db.query(`SELECT 1 FROM favorites WHERE user_id = $1`, [user.id])).toHaveLength(0)
    expect(await db.query(`SELECT 1 FROM user_affinity WHERE user_id = $1`, [user.id])).toHaveLength(0)
  })
})
