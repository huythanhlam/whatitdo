import { NextRequest, NextResponse } from 'next/server'
import { getCityBySlug, getDistinctNeighborhoods } from '@/lib/db'
import { getUser } from '@/lib/auth/server'
import { setUserInterests, setExplicitAffinities, markOnboarded } from '@/lib/user/data'
import { CATEGORY_SLUGS } from '@/lib/categories'
import { EXPLICIT_AFFINITY_SCORE } from '@/lib/recs/config'
import { surveyToAffinityKeys, surveyToInterestRows, type SurveyPrefs } from '@/lib/recs/interests'

// Save the post-auth onboarding survey (account-only). Writes the picks to the
// durable user_interests (source 'onboarding') and the live user_affinity the
// scorer reads, then stamps onboarded_at — even on skip (empty picks) — so the
// onboarding redirect never fires twice. All through the RLS-scoped client.

const RECS_CITY = 'austin'
const NO_STORE = { 'Cache-Control': 'private, no-store' }

export async function POST(req: NextRequest) {
  const { supabase, user } = await getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401, headers: NO_STORE })

  let body: { categories?: unknown; neighborhoods?: unknown; freeOnly?: unknown; days?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: NO_STORE })
  }

  const city = await getCityBySlug(RECS_CITY)
  const rawCats = Array.isArray(body.categories) ? body.categories : []
  const categories = rawCats.filter((s: unknown): s is string => typeof s === 'string' && (CATEGORY_SLUGS as string[]).includes(s))
  const known = city ? await getDistinctNeighborhoods(city.id) : []
  const rawHoods = Array.isArray(body.neighborhoods) ? body.neighborhoods : []
  const neighborhoods = rawHoods.filter((n: unknown): n is string => typeof n === 'string' && known.includes(n))
  const rawDays = Array.isArray(body.days) ? body.days : []
  const days = Array.from(new Set(rawDays.filter((d: unknown): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6)))
  const prefs: SurveyPrefs = { categories, neighborhoods, freeOnly: body.freeOnly === true, days }

  await setUserInterests(supabase, user.id, 'onboarding', surveyToInterestRows(prefs))
  await setExplicitAffinities(supabase, user.id, surveyToAffinityKeys(prefs), EXPLICIT_AFFINITY_SCORE)
  await markOnboarded(supabase, user.id)

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
