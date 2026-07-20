import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, clientIp } from '@/lib/rateLimit'
import { getCityBySlug } from '@/lib/db'
import { isRecsCity } from '@/lib/recs/config'
import { getUser } from '@/lib/auth/server'
import { recordInteraction } from '@/lib/user/data'
import { syncRewards } from '@/lib/rewards/data'

// Explicit actions from the cards: interested (star), its undo, and hide. Each is
// recorded as an interaction (flowing into affinity + engagement + impression
// labeling) through the RLS-scoped Supabase client. Sign-in required — these are
// personalization writes; anonymous visitors get no signals.

const FAV_MAX = 120
const FAV_WINDOW_MS = 60 * 1000
const ACTIONS = new Set(['interested', 'uninterested', 'hide'] as const)
type Action = 'interested' | 'uninterested' | 'hide'
const NO_STORE = { 'Cache-Control': 'private, no-store' }

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

  // A save can cross a badge threshold (e.g. Wishlist Wizard); surface any newly
  // earned badges so the client can celebrate. Best-effort — never fails the action.
  const summary = await syncRewards(supabase, user.id)

  return NextResponse.json({ ok: true, newlyEarned: summary.newlyEarned }, { headers: NO_STORE })
}
