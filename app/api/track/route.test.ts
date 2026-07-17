import { describe, it, expect, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { isLocal } from '@/lib/db'
import { getPgliteDb } from '@/lib/db/pglite'
import { WID_COOKIE, parseWid } from '@/lib/auth/session'

// Exercises the beacon route against embedded PGlite. Verifies the validation
// gate, the Austin-only city gate, and anonymous-cookie minting.
beforeAll(() => {
  expect(isLocal()).toBe(true)
})

function post(body: unknown, cookie?: string): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (cookie) headers['cookie'] = cookie
  return new NextRequest('http://localhost/api/track', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

async function anEventId(): Promise<string> {
  const db = await getPgliteDb()
  const [e] = await db.query<{ id: string }>(`SELECT id FROM events LIMIT 1`)
  return e.id
}

describe('POST /api/track', () => {
  it('mints a signed wid cookie on the first beacon and records the signal', async () => {
    const eventId = await anEventId()
    const res = await POST(post({ type: 'view', city: 'austin', eventId }))
    expect(res.status).toBe(204)

    const setCookie = res.cookies.get(WID_COOKIE)
    expect(setCookie?.value).toBeTruthy()
    const anonId = parseWid(setCookie!.value)
    expect(anonId).toBeTruthy()

    const db = await getPgliteDb()
    const rows = await db.query(`SELECT 1 FROM interactions WHERE anon_id = $1 AND type = 'view'`, [anonId])
    expect(rows.length).toBe(1)
  })

  it('reuses an existing wid cookie instead of minting a new one', async () => {
    const eventId = await anEventId()
    const first = await POST(post({ type: 'view', city: 'austin', eventId }))
    const value = first.cookies.get(WID_COOKIE)!.value
    const anonId = parseWid(value)

    const second = await POST(post({ type: 'clickout', city: 'austin', eventId }, `${WID_COOKIE}=${value}`))
    expect(second.status).toBe(204)
    // No new cookie set when a valid one was presented.
    expect(second.cookies.get(WID_COOKIE)).toBeUndefined()

    const db = await getPgliteDb()
    const rows = await db.query(`SELECT type FROM interactions WHERE anon_id = $1 ORDER BY id`, [anonId])
    expect(rows.length).toBeGreaterThanOrEqual(2)
  })

  it('rejects an unknown interaction type (no row written)', async () => {
    const before = await countInteractions()
    const res = await POST(post({ type: 'not-a-real-type', city: 'austin' }))
    expect(res.status).toBe(204)
    expect(await countInteractions()).toBe(before)
  })

  it('drops beacons for non-recs cities (Austin-only gate)', async () => {
    const eventId = await anEventId()
    const before = await countInteractions()
    const res = await POST(post({ type: 'view', city: 'houston', eventId }))
    expect(res.status).toBe(204)
    expect(await countInteractions()).toBe(before)
  })

  it('ignores a malformed body without throwing', async () => {
    const req = new NextRequest('http://localhost/api/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(204)
  })
})

async function countInteractions(): Promise<number> {
  const db = await getPgliteDb()
  const [r] = await db.query<{ c: string }>(`SELECT COUNT(*)::text c FROM interactions`)
  return parseInt(r.c, 10)
}
