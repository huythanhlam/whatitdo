import { NextRequest, NextResponse } from 'next/server'
import {
  getUserById,
  listUserInterests,
  setUserInterests,
  setExplicitAffinities,
  updateUserProfile,
  clearActorHistory,
  unhideEvent,
  deleteUser,
  getCityBySlug,
  getDistinctNeighborhoods,
} from '@/lib/db'
import { requireSessionUser } from '@/lib/auth/actor'
import { SID_COOKIE, clearSidCookieOptions } from '@/lib/auth/session'
import { CATEGORY_SLUGS } from '@/lib/categories'
import { EXPLICIT_AFFINITY_SCORE } from '@/lib/recs/config'
import { surveyToAffinityKeys, surveyToInterestRows, type SurveyPrefs } from '@/lib/recs/interests'

// The account settings surface, all session-gated:
//   GET    — current profile + interests (grouped for the editor)
//   PATCH  — update display name, personalization opt-out, and/or interests
//   POST   — privacy actions: { action: 'clearHistory' | 'unhide', eventId? }
//   DELETE — delete the account (and clear the session cookie)

const RECS_CITY = 'austin'
const NO_STORE = { 'Cache-Control': 'private, no-store' }

// Fold the flat user_interests rows back into the survey shape the editor uses.
function groupInterests(rows: { kind: string; value: string }[]): SurveyPrefs {
  return {
    categories: rows.filter(r => r.kind === 'category').map(r => r.value),
    neighborhoods: rows.filter(r => r.kind === 'neighborhood').map(r => r.value),
    days: rows.filter(r => r.kind === 'dow').map(r => Number(r.value)).filter(n => Number.isInteger(n)),
    freeOnly: rows.some(r => r.kind === 'price' && r.value === 'free_only'),
  }
}

export async function GET(req: NextRequest) {
  const userId = await requireSessionUser(req)
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401, headers: NO_STORE })
  const user = await getUserById(userId)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401, headers: NO_STORE })
  const interests = await listUserInterests(userId)
  return NextResponse.json(
    {
      user: {
        email: user.email,
        displayName: user.display_name,
        homeCityId: user.home_city_id,
        personalizationOptOut: user.personalization_opt_out,
        onboardedAt: user.onboarded_at,
      },
      prefs: groupInterests(interests),
    },
    { headers: NO_STORE }
  )
}

export async function PATCH(req: NextRequest) {
  const userId = await requireSessionUser(req)
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401, headers: NO_STORE })

  let body: {
    displayName?: unknown
    personalizationOptOut?: unknown
    prefs?: { categories?: unknown; neighborhoods?: unknown; freeOnly?: unknown; days?: unknown }
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: NO_STORE })
  }

  const patch: { displayName?: string | null; personalizationOptOut?: boolean } = {}
  if (typeof body.displayName === 'string') patch.displayName = body.displayName.trim().slice(0, 80) || null
  else if (body.displayName === null) patch.displayName = null
  if (typeof body.personalizationOptOut === 'boolean') patch.personalizationOptOut = body.personalizationOptOut
  if (Object.keys(patch).length > 0) await updateUserProfile(userId, patch)

  // Interests edit (source 'profile' — overrides onboarding weights).
  if (body.prefs) {
    const p = body.prefs
    const rawCats = Array.isArray(p.categories) ? p.categories : []
    const categories = rawCats.filter(
      (s: unknown): s is string => typeof s === 'string' && (CATEGORY_SLUGS as string[]).includes(s)
    )
    const city = await getCityBySlug(RECS_CITY)
    const known = city ? await getDistinctNeighborhoods(city.id) : []
    const rawHoods = Array.isArray(p.neighborhoods) ? p.neighborhoods : []
    const neighborhoods = rawHoods.filter((n: unknown): n is string => typeof n === 'string' && known.includes(n))
    const rawDays = Array.isArray(p.days) ? p.days : []
    const days = Array.from(
      new Set(rawDays.filter((d: unknown): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6))
    )
    const prefs: SurveyPrefs = { categories, neighborhoods, freeOnly: p.freeOnly === true, days }
    await setUserInterests(userId, 'profile', surveyToInterestRows(prefs))
    await setExplicitAffinities(userId, surveyToAffinityKeys(prefs), EXPLICIT_AFFINITY_SCORE)
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}

export async function POST(req: NextRequest) {
  const userId = await requireSessionUser(req)
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401, headers: NO_STORE })

  let body: { action?: unknown; eventId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: NO_STORE })
  }

  const actor = { userId, anonId: null }
  if (body.action === 'clearHistory') {
    await clearActorHistory(actor)
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  }
  if (body.action === 'unhide' && typeof body.eventId === 'string') {
    await unhideEvent(actor, body.eventId)
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400, headers: NO_STORE })
}

export async function DELETE(req: NextRequest) {
  const userId = await requireSessionUser(req)
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401, headers: NO_STORE })
  await deleteUser(userId) // FK cascade drops the session too; clear the cookie as well
  const res = NextResponse.json({ ok: true }, { headers: NO_STORE })
  res.cookies.set(SID_COOKIE, '', clearSidCookieOptions())
  return res
}
