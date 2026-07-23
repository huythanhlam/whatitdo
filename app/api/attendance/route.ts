import { NextRequest, NextResponse } from 'next/server'
import { checkBotId } from 'botid/server'
import { checkRateLimit, clientIp } from '@/lib/rateLimit'
import { getCityBySlug } from '@/lib/db'
import { isRecsCity } from '@/lib/recs/config'
import { getUser } from '@/lib/auth/server'
import { recordInteraction } from '@/lib/user/data'
import { syncRewards } from '@/lib/rewards/data'

// Event check-in: the one new signal the rewards system needs. Validation is a
// server-authoritative time gate — an "I was there" only counts once the event
// has actually started — plus idempotency (one attendance per user+event). The
// signal flows through the same recordInteraction path as every other action, so
// it also feeds affinity + engagement; then we sync rewards and hand back any
// badges the check-in unlocked so the client can celebrate.

const ATT_MAX = 60
const ATT_WINDOW_MS = 60 * 1000
const NO_STORE = { 'Cache-Control': 'private, no-store' }

export async function POST(req: NextRequest) {
  // Check-ins grant rewards; block automated farming before doing any work.
  if ((await checkBotId()).isBot) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  if (!checkRateLimit(`att:${clientIp(req)}`, ATT_MAX, ATT_WINDOW_MS)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: { eventId?: unknown; city?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const eventId = typeof body.eventId === 'string' ? body.eventId : ''
  if (!eventId) return NextResponse.json({ error: 'Missing eventId' }, { status: 400 })
  const citySlug = typeof body.city === 'string' ? body.city : ''
  if (!isRecsCity(citySlug)) return NextResponse.json({ error: 'Unsupported city' }, { status: 400 })

  const { supabase, user } = await getUser()
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  // Time gate: the event must exist and have already started.
  const { data: ev } = await supabase.from('events').select('start_time').eq('id', eventId).maybeSingle()
  if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  const startMs = Date.parse(ev.start_time as string)
  if (!Number.isFinite(startMs) || startMs > Date.now()) {
    return NextResponse.json({ error: 'You can check in once the event has started' }, { status: 409, headers: NO_STORE })
  }

  // Idempotent: a second check-in for the same event is a no-op success.
  const { data: prior } = await supabase
    .from('interactions').select('id').eq('type', 'attended').eq('event_id', eventId).limit(1)
  if (prior && prior.length > 0) {
    return NextResponse.json({ ok: true, already: true, newlyEarned: [] }, { headers: NO_STORE })
  }

  const city = await getCityBySlug(citySlug)
  await recordInteraction(supabase, user.id, { type: 'attended', eventId, cityId: city?.id ?? null })

  const summary = await syncRewards(supabase, user.id)
  return NextResponse.json(
    { ok: true, newlyEarned: summary.newlyEarned, level: summary.level, points: summary.points },
    { headers: NO_STORE },
  )
}
