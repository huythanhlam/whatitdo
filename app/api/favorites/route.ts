import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, clientIp } from '@/lib/rateLimit'
import { getCityBySlug } from '@/lib/db'
import { isRecsCity } from '@/lib/recs/config'
import { getUser } from '@/lib/auth/server'
import { addFavorite, removeFavorite, listFavoriteIds, recordInteraction } from '@/lib/user/data'

// Explicit actions from the cards: save (heart), interested (star), and their
// undos, plus hide. Each is recorded as an interaction (flowing into affinity +
// engagement + impression labeling) through the RLS-scoped Supabase client, and
// favorites additionally keep a durable saved-list row. Sign-in required — these
// are personalization writes; anonymous visitors get no signals.

const FAV_MAX = 120
const FAV_WINDOW_MS = 60 * 1000
const ACTIONS = new Set(['favorite', 'unfavorite', 'interested', 'uninterested', 'hide'] as const)
type Action = 'favorite' | 'unfavorite' | 'interested' | 'uninterested' | 'hide'
const NO_STORE = { 'Cache-Control': 'private, no-store' }

export async function GET(req: NextRequest) {
  const citySlug = req.nextUrl.searchParams.get('city') ?? ''
  if (!isRecsCity(citySlug)) return NextResponse.json({ favorites: [] }, { headers: NO_STORE })
  const { supabase, user } = await getUser()
  if (!user) return NextResponse.json({ favorites: [] }, { headers: NO_STORE })
  return NextResponse.json({ favorites: await listFavoriteIds(supabase) }, { headers: NO_STORE })
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

  const { supabase, user } = await getUser()
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  const city = await getCityBySlug(citySlug)
  const serveId = typeof body.serveId === 'string' ? body.serveId : null

  await recordInteraction(supabase, user.id, { type: action as Action, eventId, cityId: city?.id ?? null, serveId })
  if (action === 'favorite') await addFavorite(supabase, user.id, eventId)
  else if (action === 'unfavorite') await removeFavorite(supabase, eventId)

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
