import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, clientIp } from '@/lib/rateLimit'
import { getCityBySlug, recordInteraction } from '@/lib/db'
import { isInteractionType, isRecsCity } from '@/lib/recs/config'
import { resolveActor, attachAnon } from '@/lib/auth/actor'

// Implicit-signal beacon. The client posts here (via navigator.sendBeacon) on
// views, clickouts, shares, calendar adds, etc. It is deliberately cheap and
// forgiving: it validates and records, but a bad or failed beacon never surfaces
// an error to the user — tracking must not break browsing.
//
// Identity: an httpOnly, HMAC-signed `wid` cookie names the anonymous device.
// If it's missing or forged we mint a fresh one and set it on the response.
// Accounts (a real user_id) attach in a later phase; here every actor is anon.
//
// Scope: Austin-only at launch. A beacon for any other city is accepted but
// discarded, so no signals accrue outside the gated rollout.

// Generous — this is a background beacon, not a user action. The cap only exists
// to stop a single client flooding the interaction log.
const TRACK_MAX = 240
const TRACK_WINDOW_MS = 60 * 1000

const noContent = () => new NextResponse(null, { status: 204 })

export async function POST(req: NextRequest) {
  if (!checkRateLimit(`track:${clientIp(req)}`, TRACK_MAX, TRACK_WINDOW_MS)) {
    return new NextResponse(null, { status: 429 })
  }

  let body: {
    type?: unknown
    eventId?: unknown
    city?: unknown
    query?: unknown
    serveId?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return noContent() // malformed beacon — silently ignore
  }

  const type = body.type
  if (!isInteractionType(type)) return noContent()

  // City gate: the beacon carries the page's city slug. Anything outside the
  // recs allowlist is dropped before any DB work.
  const citySlug = typeof body.city === 'string' ? body.city : ''
  if (!isRecsCity(citySlug)) return noContent()

  const eventId = typeof body.eventId === 'string' ? body.eventId : null
  const query = typeof body.query === 'string' ? body.query.slice(0, 200) : null
  const serveId = typeof body.serveId === 'string' ? body.serveId : null

  // Resolve the actor: a signed-in user (via the `sid` session) when present,
  // otherwise the anonymous device — minting a fresh `wid` if absent/forged so the
  // very first beacon still has an identity to attach to.
  const { actor, anonIsNew } = await resolveActor(req)

  try {
    const city = await getCityBySlug(citySlug)
    await recordInteraction({
      actor,
      type,
      eventId,
      cityId: city?.id ?? null,
      query,
      serveId,
    })
  } catch {
    // Best-effort: swallow so a tracking hiccup never breaks the page.
  }

  const res = noContent()
  if (actor.anonId) attachAnon(res, actor.anonId, anonIsNew)
  return res
}
