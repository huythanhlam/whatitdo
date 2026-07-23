import { NextRequest, NextResponse } from 'next/server'
import { checkBotId } from 'botid/server'
import { getCityBySlug, getDistinctNeighborhoods } from '@/lib/db'
import { getUser } from '@/lib/auth/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  listUserInterests,
  setUserInterests,
  setExplicitAffinities,
  updateProfile,
  clearHistory,
  unhideEvent,
} from '@/lib/user/data'
import { CATEGORY_SLUGS } from '@/lib/categories'
import { EXPLICIT_AFFINITY_SCORE } from '@/lib/recs/config'
import { surveyToAffinityKeys, surveyToInterestRows, type SurveyPrefs } from '@/lib/recs/interests'

// Account settings, all session-gated via the Supabase session:
//   GET    — current profile + interests (grouped for the editor)
//   PATCH  — display name, personalization opt-out, and/or interests
//   POST   — privacy actions: { action: 'clearHistory' | 'unhide', eventId? }
//   DELETE — delete the account (service client → auth.admin.deleteUser, cascades)

const RECS_CITY = 'austin'
const NO_STORE = { 'Cache-Control': 'private, no-store' }

// BotID gate for the mutating handlers (PATCH/POST/DELETE — protected in
// instrumentation-client.ts). GET is a read and stays open. Returns a 403
// response to short-circuit with, or null to proceed.
async function botBlocked(): Promise<NextResponse | null> {
  return (await checkBotId()).isBot
    ? NextResponse.json({ error: 'Access denied' }, { status: 403, headers: NO_STORE })
    : null
}

function groupInterests(rows: { kind: string; value: string }[]): SurveyPrefs {
  return {
    categories: rows.filter(r => r.kind === 'category').map(r => r.value),
    neighborhoods: rows.filter(r => r.kind === 'neighborhood').map(r => r.value),
    days: rows.filter(r => r.kind === 'dow').map(r => Number(r.value)).filter(n => Number.isInteger(n)),
    freeOnly: rows.some(r => r.kind === 'price' && r.value === 'free_only'),
  }
}

async function cleanPrefs(p: { categories?: unknown; neighborhoods?: unknown; freeOnly?: unknown; days?: unknown }): Promise<SurveyPrefs> {
  const rawCats = Array.isArray(p.categories) ? p.categories : []
  const categories = rawCats.filter((s: unknown): s is string => typeof s === 'string' && (CATEGORY_SLUGS as string[]).includes(s))
  const city = await getCityBySlug(RECS_CITY)
  const known = city ? await getDistinctNeighborhoods(city.id) : []
  const rawHoods = Array.isArray(p.neighborhoods) ? p.neighborhoods : []
  const neighborhoods = rawHoods.filter((n: unknown): n is string => typeof n === 'string' && known.includes(n))
  const rawDays = Array.isArray(p.days) ? p.days : []
  const days = Array.from(new Set(rawDays.filter((d: unknown): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6)))
  return { categories, neighborhoods, freeOnly: p.freeOnly === true, days }
}

export async function GET() {
  const { supabase, user } = await getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401, headers: NO_STORE })
  const { data: prof } = await supabase.from('profiles').select('display_name, home_city_id, personalization_opt_out, magic_link_enabled, onboarded_at').eq('id', user.id).maybeSingle()
  const interests = await listUserInterests(supabase)
  return NextResponse.json(
    {
      user: {
        email: user.email,
        displayName: prof?.display_name ?? null,
        homeCityId: prof?.home_city_id ?? null,
        personalizationOptOut: prof?.personalization_opt_out ?? false,
        magicLinkEnabled: prof?.magic_link_enabled ?? false,
        onboardedAt: prof?.onboarded_at ?? null,
      },
      prefs: groupInterests(interests),
    },
    { headers: NO_STORE }
  )
}

export async function PATCH(req: NextRequest) {
  const denied = await botBlocked()
  if (denied) return denied
  const { supabase, user } = await getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401, headers: NO_STORE })

  let body: { displayName?: unknown; personalizationOptOut?: unknown; magicLinkEnabled?: unknown; prefs?: SurveyPrefs }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: NO_STORE })
  }

  const patch: { display_name?: string | null; personalization_opt_out?: boolean; magic_link_enabled?: boolean } = {}
  if (typeof body.displayName === 'string') patch.display_name = body.displayName.trim().slice(0, 80) || null
  else if (body.displayName === null) patch.display_name = null
  if (typeof body.personalizationOptOut === 'boolean') patch.personalization_opt_out = body.personalizationOptOut
  if (typeof body.magicLinkEnabled === 'boolean') patch.magic_link_enabled = body.magicLinkEnabled
  if (Object.keys(patch).length > 0) await updateProfile(supabase, patch)

  if (body.prefs) {
    const prefs = await cleanPrefs(body.prefs)
    await setUserInterests(supabase, user.id, 'profile', surveyToInterestRows(prefs))
    await setExplicitAffinities(supabase, user.id, surveyToAffinityKeys(prefs), EXPLICIT_AFFINITY_SCORE)
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}

export async function POST(req: NextRequest) {
  const denied = await botBlocked()
  if (denied) return denied
  const { supabase, user } = await getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401, headers: NO_STORE })

  let body: { action?: unknown; eventId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: NO_STORE })
  }

  if (body.action === 'clearHistory') {
    await clearHistory(supabase)
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  }
  if (body.action === 'unhide' && typeof body.eventId === 'string') {
    await unhideEvent(supabase, body.eventId)
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400, headers: NO_STORE })
}

export async function DELETE() {
  const denied = await botBlocked()
  if (denied) return denied
  const { user } = await getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401, headers: NO_STORE })
  // Deleting the auth user cascades profile + all behavioral rows (FKs). Requires
  // the service client (admin API); the user's own session can't delete itself.
  const svc = createServiceClient()
  await svc.auth.admin.deleteUser(user.id)
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
