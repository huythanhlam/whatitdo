import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { checkRateLimit, clientIp } from '@/lib/rateLimit'
import { getCityBySlug, listRecommendedEvents, logImpressions } from '@/lib/db'
import { isRecsCity, RECS_DEFAULT_LIMIT } from '@/lib/recs/config'
import { resolveAnon, attachAnon } from '@/lib/auth/actor'

// The ranking model at request time. Returns a personalized, diversity-ranked
// page of upcoming events for the actor, plus a serve_id the client echoes back
// on any resulting signal so we can credit the impression. Personalization is
// per-actor, so the response is private and never cached.
//
// Anonymous-friendly: an actor with no history still gets a coherent list (the
// model runs with zero actor features → trending-shaped), and a `wid` cookie is
// minted on the way out so their next signals have somewhere to land.

const RECS_MAX = 120
const RECS_WINDOW_MS = 60 * 1000

// surface distinguishes the compact home rail from the full /for-you page in the
// impression log, so their CTRs can be compared.
const SURFACES = new Set(['rail', 'for_you'])

export async function GET(req: NextRequest) {
  if (!checkRateLimit(`recs:${clientIp(req)}`, RECS_MAX, RECS_WINDOW_MS)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const citySlug = req.nextUrl.searchParams.get('city') ?? ''
  // Austin-only at launch: any other city gets an empty, uncached list.
  if (!isRecsCity(citySlug)) {
    return NextResponse.json({ events: [], serveId: null }, { headers: { 'Cache-Control': 'private, no-store' } })
  }

  const city = await getCityBySlug(citySlug)
  if (!city || !city.enabled) {
    return NextResponse.json({ events: [], serveId: null }, { headers: { 'Cache-Control': 'private, no-store' } })
  }

  const rawLimit = parseInt(req.nextUrl.searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 40) : RECS_DEFAULT_LIMIT
  const surfaceParam = req.nextUrl.searchParams.get('surface') ?? 'rail'
  const surface = SURFACES.has(surfaceParam) ? surfaceParam : 'rail'

  const { anonId, isNew } = resolveAnon(req)
  const actor = { userId: null, anonId }

  const { events, impressions, modelVersion, personalized } = await listRecommendedEvents(city.id, actor, { limit })

  const serveId = randomUUID()
  // Logging is best-effort — a persistence hiccup must not fail the response.
  try {
    await logImpressions({ serveId, cityId: city.id, actor, surface, modelVersion, items: impressions })
  } catch {
    // swallow; the rail still renders
  }

  const res = NextResponse.json(
    { events, serveId, personalized },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
  attachAnon(res, anonId, isNew)
  return res
}
