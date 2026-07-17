import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, clientIp } from '@/lib/rateLimit'
import {
  getCityBySlug,
  recordInteraction,
  addFavorite,
  removeFavorite,
  listFavoriteIds,
} from '@/lib/db'
import { isRecsCity } from '@/lib/recs/config'
import { resolveActor, attachAnon } from '@/lib/auth/actor'

// Explicit actions from the cards: save (heart), interested (star), and their
// undos, plus hide ("not interested"). Each is recorded as an interaction — so
// it flows into affinity, engagement, and (with a serve_id) impression labeling
// exactly like an implicit signal — and favorites additionally maintain a durable
// saved-list row.
//
// Anonymous-friendly and Austin-gated, mirroring /api/track and
// /api/recommendations. GET returns the actor's saved event ids so the client
// can render already-saved hearts filled.

const FAV_MAX = 120
const FAV_WINDOW_MS = 60 * 1000

// Actions this endpoint accepts, mapped to their interaction type. (A subset of
// the full INTERACTION_TYPES — implicit signals go through /api/track.)
const ACTIONS = new Set([
  'favorite',
  'unfavorite',
  'interested',
  'uninterested',
  'hide',
] as const)
type Action = typeof ACTIONS extends Set<infer T> ? T : never

export async function GET(req: NextRequest) {
  const citySlug = req.nextUrl.searchParams.get('city') ?? ''
  if (!isRecsCity(citySlug)) {
    return NextResponse.json({ favorites: [] }, { headers: { 'Cache-Control': 'private, no-store' } })
  }
  const { actor, anonIsNew } = await resolveActor(req)
  const favorites = await listFavoriteIds(actor)
  const res = NextResponse.json({ favorites }, { headers: { 'Cache-Control': 'private, no-store' } })
  if (actor.anonId) attachAnon(res, actor.anonId, anonIsNew)
  return res
}

export async function POST(req: NextRequest) {
  if (!checkRateLimit(`fav:${clientIp(req)}`, FAV_MAX, FAV_WINDOW_MS)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: { action?: unknown; eventId?: unknown; city?: unknown; serveId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const action = body.action
  if (typeof action !== 'string' || !ACTIONS.has(action as Action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }
  const eventId = typeof body.eventId === 'string' ? body.eventId : ''
  if (!eventId) return NextResponse.json({ error: 'Missing eventId' }, { status: 400 })

  const citySlug = typeof body.city === 'string' ? body.city : ''
  if (!isRecsCity(citySlug)) return NextResponse.json({ error: 'Unsupported city' }, { status: 400 })
  const city = await getCityBySlug(citySlug)
  const serveId = typeof body.serveId === 'string' ? body.serveId : null

  const { actor, anonIsNew } = await resolveActor(req)

  await recordInteraction({ actor, type: action as Action, eventId, cityId: city?.id ?? null, serveId })
  // Favorites keep a durable saved-list row on top of the interaction signal.
  if (action === 'favorite') await addFavorite(actor, eventId)
  else if (action === 'unfavorite') await removeFavorite(actor, eventId)

  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } })
  if (actor.anonId) attachAnon(res, actor.anonId, anonIsNew)
  return res
}
