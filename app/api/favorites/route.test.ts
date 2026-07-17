import { describe, it, expect, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'
import { isLocal } from '@/lib/db'
import { getPgliteDb } from '@/lib/db/pglite'
import { WID_COOKIE } from '@/lib/auth/session'

beforeAll(() => {
  expect(isLocal()).toBe(true)
})

async function anEventId(): Promise<string> {
  const db = await getPgliteDb()
  const [e] = await db.query<{ id: string }>(`SELECT id FROM events LIMIT 1`)
  return e.id
}

function post(body: unknown, cookie?: string): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (cookie) headers['cookie'] = cookie
  return new NextRequest('http://localhost/api/favorites', { method: 'POST', headers, body: JSON.stringify(body) })
}

describe('POST /api/favorites', () => {
  it('saves a favorite and GET returns it for the same actor', async () => {
    const eventId = await anEventId()
    const res = await POST(post({ action: 'favorite', city: 'austin', eventId }))
    expect(res.status).toBe(200)
    const cookieVal = res.cookies.get(WID_COOKIE)!.value

    const getRes = await GET(new NextRequest('http://localhost/api/favorites?city=austin', {
      headers: { cookie: `${WID_COOKIE}=${cookieVal}` },
    }))
    const body = await getRes.json()
    expect(body.favorites).toContain(eventId)
  })

  it('unfavorite removes the saved row', async () => {
    const eventId = await anEventId()
    const saved = await POST(post({ action: 'favorite', city: 'austin', eventId }))
    const cookie = `${WID_COOKIE}=${saved.cookies.get(WID_COOKIE)!.value}`
    await POST(post({ action: 'unfavorite', city: 'austin', eventId }, cookie))

    const getRes = await GET(new NextRequest('http://localhost/api/favorites?city=austin', { headers: { cookie } }))
    const body = await getRes.json()
    expect(body.favorites).not.toContain(eventId)
  })

  it('hide records a hide interaction (no favorite row)', async () => {
    const eventId = await anEventId()
    const res = await POST(post({ action: 'hide', city: 'austin', eventId }))
    expect(res.status).toBe(200)
    const anonCookie = res.cookies.get(WID_COOKIE)!.value
    const db = await getPgliteDb()
    const [{ c }] = await db.query<{ c: string }>(
      `SELECT COUNT(*)::text c FROM interactions WHERE type = 'hide' AND event_id = $1`,
      [eventId]
    )
    expect(parseInt(c, 10)).toBeGreaterThan(0)
    expect(anonCookie).toBeTruthy()
  })

  it('rejects an invalid action and a non-recs city', async () => {
    expect((await POST(post({ action: 'nope', city: 'austin', eventId: 'x' }))).status).toBe(400)
    expect((await POST(post({ action: 'favorite', city: 'houston', eventId: 'x' }))).status).toBe(400)
  })
})
