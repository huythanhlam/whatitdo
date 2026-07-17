import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, clientIp } from '@/lib/rateLimit'
import { getCityBySlug } from '@/lib/db'
import { isInteractionType, isRecsCity } from '@/lib/recs/config'
import { getUser } from '@/lib/auth/server'
import { recordInteraction } from '@/lib/user/data'

// Implicit-signal beacon (views, clickouts, shares, calendar adds, …). Recorded
// through the RLS-scoped Supabase client, so signals attach to the signed-in
// user. Personalization is signed-in only, so a beacon from a logged-out visitor
// is accepted and discarded (204). Cheap and forgiving — never surfaces an error.

const TRACK_MAX = 240
const TRACK_WINDOW_MS = 60 * 1000
const noContent = () => new NextResponse(null, { status: 204 })

export async function POST(req: NextRequest) {
  if (!checkRateLimit(`track:${clientIp(req)}`, TRACK_MAX, TRACK_WINDOW_MS)) {
    return new NextResponse(null, { status: 429 })
  }

  let body: { type?: unknown; eventId?: unknown; city?: unknown; query?: unknown; serveId?: unknown }
  try {
    body = await req.json()
  } catch {
    return noContent()
  }

  const type = body.type
  if (!isInteractionType(type)) return noContent()
  const citySlug = typeof body.city === 'string' ? body.city : ''
  if (!isRecsCity(citySlug)) return noContent()

  const { supabase, user } = await getUser()
  if (!user) return noContent() // signed-in only; drop anonymous signals

  const eventId = typeof body.eventId === 'string' ? body.eventId : null
  const query = typeof body.query === 'string' ? body.query.slice(0, 200) : null
  const serveId = typeof body.serveId === 'string' ? body.serveId : null

  try {
    const city = await getCityBySlug(citySlug)
    await recordInteraction(supabase, user.id, { type, eventId, cityId: city?.id ?? null, query, serveId })
  } catch {
    // Best-effort: a tracking hiccup never breaks the page.
  }
  return noContent()
}
