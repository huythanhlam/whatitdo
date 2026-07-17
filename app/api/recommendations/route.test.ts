import { describe, it, expect, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { isLocal } from '@/lib/db'
import { getPgliteDb } from '@/lib/db/pglite'
import { WID_COOKIE, parseWid } from '@/lib/auth/session'

beforeAll(() => {
  expect(isLocal()).toBe(true)
})

function get(qs: string, cookie?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (cookie) headers['cookie'] = cookie
  return new NextRequest(`http://localhost/api/recommendations?${qs}`, { headers })
}

describe('GET /api/recommendations', () => {
  it('returns ranked events + a serveId, mints a wid cookie, and logs impressions', async () => {
    const res = await GET(get('city=austin&limit=6'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    const body = await res.json()
    expect(Array.isArray(body.events)).toBe(true)
    expect(body.events.length).toBeGreaterThan(0)
    expect(body.serveId).toBeTruthy()

    const anonId = parseWid(res.cookies.get(WID_COOKIE)!.value)
    expect(anonId).toBeTruthy()

    const db = await getPgliteDb()
    const [{ c }] = await db.query<{ c: string }>(
      `SELECT COUNT(*)::text c FROM rec_impressions WHERE serve_id = $1`,
      [body.serveId]
    )
    expect(parseInt(c, 10)).toBe(body.events.length)
  })

  it('returns an empty, non-cached list for a non-recs city', async () => {
    const res = await GET(get('city=houston'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toEqual([])
    expect(body.serveId).toBeNull()
    expect(res.cookies.get(WID_COOKIE)).toBeUndefined()
  })
})
