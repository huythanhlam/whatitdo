import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { checkRateLimit, clientIp } from '@/lib/rateLimit'
import { getCityBySlug, listRecommendedEvents } from '@/lib/db'
import { isRecsCity, RECS_DEFAULT_LIMIT } from '@/lib/recs/config'
import { getUser } from '@/lib/auth/server'
import { getActorTaste, getActorEventState, logImpressions } from '@/lib/user/data'
import type { ActorTaste } from '@/lib/recs/score'

// The ranking model at request time. A signed-in visitor gets a personalized,
// diversity-ranked page (their taste read via the RLS-scoped Supabase client)
// plus a serve_id to credit impressions. A logged-out visitor gets the same model
// run with empty taste — a trending-shaped list — and no impression logging.

const RECS_MAX = 120
const RECS_WINDOW_MS = 60 * 1000
const SURFACES = new Set(['rail', 'for_you'])
const NO_STORE = { 'Cache-Control': 'private, no-store' }
const EMPTY_TASTE: ActorTaste = { affinity: new Map(), vector: null }
const EMPTY_STATE = { hidden: new Set<string>(), seen: new Map<string, number>() }

export async function GET(req: NextRequest) {
  if (!checkRateLimit(`recs:${clientIp(req)}`, RECS_MAX, RECS_WINDOW_MS)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const citySlug = req.nextUrl.searchParams.get('city') ?? ''
  if (!isRecsCity(citySlug)) return NextResponse.json({ events: [], serveId: null }, { headers: NO_STORE })
  const city = await getCityBySlug(citySlug)
  if (!city || !city.enabled) return NextResponse.json({ events: [], serveId: null }, { headers: NO_STORE })

  const rawLimit = parseInt(req.nextUrl.searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 40) : RECS_DEFAULT_LIMIT
  const surfaceParam = req.nextUrl.searchParams.get('surface') ?? 'rail'
  const surface = SURFACES.has(surfaceParam) ? surfaceParam : 'rail'

  const { supabase, user } = await getUser()
  const [taste, state] = user
    ? await Promise.all([getActorTaste(supabase), getActorEventState(supabase)])
    : [EMPTY_TASTE, EMPTY_STATE]

  const { events, impressions, modelVersion, personalized } = await listRecommendedEvents(city.id, taste, state, { limit })

  const serveId = randomUUID()
  if (user) {
    try {
      await logImpressions(supabase, user.id, { serveId, cityId: city.id, surface, modelVersion, items: impressions })
    } catch {
      // best-effort; the rail still renders
    }
  }

  return NextResponse.json(
    { events, serveId: user ? serveId : null, personalized },
    { headers: NO_STORE }
  )
}
