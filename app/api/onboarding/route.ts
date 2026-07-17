import { NextRequest, NextResponse } from 'next/server'
import {
  getCityBySlug,
  getDistinctNeighborhoods,
  setUserInterests,
  setExplicitAffinities,
  seedUserVectorFromCategories,
  markOnboarded,
} from '@/lib/db'
import { requireSessionUser } from '@/lib/auth/actor'
import { CATEGORY_SLUGS } from '@/lib/categories'
import { EXPLICIT_AFFINITY_SCORE } from '@/lib/recs/config'
import { surveyToAffinityKeys, surveyToInterestRows, type SurveyPrefs } from '@/lib/recs/interests'

// Save the post-auth onboarding survey. Session-gated (the survey is account-only
// by design). Writes the picks three ways: durable user_interests (source
// 'onboarding'), the live user_affinity the scorer reads (so the feed is
// personalized immediately), and a cold-start taste vector from the chosen
// categories' embeddings. Then stamps onboarded_at — even on skip (empty picks),
// so the onboarding redirect never fires twice.

const RECS_CITY = 'austin'

export async function POST(req: NextRequest) {
  const userId = await requireSessionUser(req)
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  let body: {
    categories?: unknown
    neighborhoods?: unknown
    freeOnly?: unknown
    days?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const city = await getCityBySlug(RECS_CITY)

  // Validate every pick against a known set so nothing junk enters the stores.
  const rawCats = Array.isArray(body.categories) ? body.categories : []
  const categories = rawCats.filter(
    (s: unknown): s is string => typeof s === 'string' && (CATEGORY_SLUGS as string[]).includes(s)
  )

  const knownNeighborhoods = city ? await getDistinctNeighborhoods(city.id) : []
  const rawHoods = Array.isArray(body.neighborhoods) ? body.neighborhoods : []
  const neighborhoods = rawHoods.filter(
    (n: unknown): n is string => typeof n === 'string' && knownNeighborhoods.includes(n)
  )

  const rawDays = Array.isArray(body.days) ? body.days : []
  const days = Array.from(
    new Set(
      rawDays.filter((d: unknown): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6)
    )
  )

  const prefs: SurveyPrefs = { categories, neighborhoods, freeOnly: body.freeOnly === true, days }

  await setUserInterests(userId, 'onboarding', surveyToInterestRows(prefs))
  await setExplicitAffinities(userId, surveyToAffinityKeys(prefs), EXPLICIT_AFFINITY_SCORE)
  // Cold-start the semantic vector from the chosen categories (no-op if no events
  // are embedded yet — safe, the scorer treats an absent vector as no signal).
  await seedUserVectorFromCategories({ userId, anonId: null }, categories)
  await markOnboarded(userId)

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } })
}
