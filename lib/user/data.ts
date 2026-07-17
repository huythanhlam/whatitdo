import type { SupabaseClient } from '@supabase/supabase-js'
import {
  SIGNAL_MAGNITUDE,
  POSITIVE_ENGAGEMENT_TYPES,
  EMA_ALPHA,
  type InteractionType,
} from '@/lib/recs/config'
import { affinityKeysForEvent, signalTarget, emaUpdate } from '@/lib/recs/affinity'
import type { ActorTaste, FeatureVector } from '@/lib/recs/score'

// User-private data access, all through the RLS-scoped Supabase client (the
// caller's `authenticated` session). PostgREST + the per-user policies guarantee
// a user only ever reads/writes their own rows — the privacy boundary is the
// database, not this code. Shared per-event aggregates are nudged only through
// the SECURITY DEFINER RPCs (bump_impression/bump_engagement).
//
// The write-through affinity math stays in TS (one source of truth,
// lib/recs/affinity) and runs server-side here. The semantic user-vector blend
// is deferred: it contributes nothing until events are embedded, so it's a
// no-op in the common case and reintroduced with the embedding cron.

type SB = SupabaseClient

// --- Favorites -------------------------------------------------------------

export async function addFavorite(sb: SB, userId: string, eventId: string): Promise<void> {
  await sb.from('favorites').upsert({ user_id: userId, event_id: eventId }, { onConflict: 'user_id,event_id' })
}

export async function removeFavorite(sb: SB, eventId: string): Promise<void> {
  await sb.from('favorites').delete().eq('event_id', eventId)
}

export async function listFavoriteIds(sb: SB): Promise<string[]> {
  const { data } = await sb.from('favorites').select('event_id').order('created_at', { ascending: false })
  return (data ?? []).map(r => r.event_id as string)
}

// --- Interactions (the write-through signal path) --------------------------

type EventCtx = {
  category_slugs: string[]
  venue_norm: string | null
  is_free: boolean
  start_time: string
  city_id: number
}

async function eventCtx(sb: SB, eventId: string): Promise<EventCtx | null> {
  const { data } = await sb
    .from('events')
    .select('city_id, venue_norm, is_free, start_time, event_categories(categories(slug))')
    .eq('id', eventId)
    .maybeSingle()
  if (!data) return null
  // PostgREST types the embedded relation loosely; categories may come back as a
  // single object or an array depending on the relationship shape.
  const ecs = (data.event_categories as unknown as { categories: { slug: string } | { slug: string }[] | null }[] | null) ?? []
  const slugs = ecs
    .flatMap(ec => {
      const c = ec.categories
      if (!c) return []
      return Array.isArray(c) ? c.map(x => x.slug) : [c.slug]
    })
    .filter((s): s is string => !!s)
  return {
    category_slugs: slugs,
    venue_norm: (data.venue_norm as string | null) ?? null,
    is_free: !!data.is_free,
    start_time: data.start_time as string,
    city_id: data.city_id as number,
  }
}

// Record a signal and apply the affinity write-through it implies. Best-effort:
// a failure here must not fail the user action that triggered it.
export async function recordInteraction(
  sb: SB,
  userId: string,
  params: { type: InteractionType; eventId?: string | null; cityId?: number | null; query?: string | null; serveId?: string | null }
): Promise<void> {
  const ctx = params.eventId ? await eventCtx(sb, params.eventId) : null
  const cityId = params.cityId ?? ctx?.city_id ?? null

  await sb.from('interactions').insert({
    user_id: userId,
    city_id: cityId,
    event_id: params.eventId ?? null,
    type: params.type,
    serve_id: params.serveId ?? null,
    query: params.query ?? null,
  })

  const magnitude = SIGNAL_MAGNITUDE[params.type] ?? 0
  if (ctx && magnitude !== 0) {
    const keys = affinityKeysForEvent({
      categorySlugs: ctx.category_slugs,
      venueNorm: ctx.venue_norm,
      isFree: ctx.is_free,
      startTime: ctx.start_time,
    })
    // Read the current EMA for exactly these keys, blend, upsert.
    const orClause = keys.map(k => `and(kind.eq.${k.kind},value.eq.${k.value})`).join(',')
    const { data: existing } = await sb.from('user_affinity').select('kind, value, score').or(orClause)
    const prev = new Map((existing ?? []).map(r => [`${r.kind}:${r.value}`, r.score as number]))
    const target = signalTarget(magnitude)
    const rows = keys.map(k => ({
      user_id: userId,
      kind: k.kind,
      value: k.value,
      score: emaUpdate(prev.get(`${k.kind}:${k.value}`) ?? 0, target, EMA_ALPHA),
    }))
    await sb.from('user_affinity').upsert(rows, { onConflict: 'user_id,kind,value' })
  }

  if (params.eventId && POSITIVE_ENGAGEMENT_TYPES.has(params.type)) {
    await sb.rpc('bump_engagement', { p_event_id: params.eventId })
    if (params.serveId) {
      await sb.from('rec_impressions').update({ engaged: true }).eq('serve_id', params.serveId).eq('event_id', params.eventId)
    }
  }
}

// --- Recommendation inputs (own taste + event state) -----------------------

export async function getActorTaste(sb: SB): Promise<ActorTaste> {
  const [{ data: aff }, { data: vec }] = await Promise.all([
    sb.from('user_affinity').select('kind, value, score'),
    sb.from('user_vectors').select('vec').maybeSingle(),
  ])
  const affinity = new Map<string, number>()
  for (const r of aff ?? []) affinity.set(`${r.kind}:${r.value}`, r.score as number)
  return { affinity, vector: (vec?.vec as number[] | undefined) ?? null }
}

export async function getActorEventState(sb: SB): Promise<{ hidden: Set<string>; seen: Map<string, number> }> {
  const { data } = await sb.from('interactions').select('event_id, type').in('type', ['hide', 'view']).not('event_id', 'is', null)
  const hidden = new Set<string>()
  const seen = new Map<string, number>()
  for (const r of data ?? []) {
    const id = r.event_id as string
    if (r.type === 'hide') hidden.add(id)
    else if (r.type === 'view') seen.set(id, (seen.get(id) ?? 0) + 1)
  }
  return { hidden, seen }
}

export async function logImpressions(
  sb: SB,
  userId: string,
  params: { serveId: string; cityId: number; surface: string; modelVersion: number; items: { eventId: string; position: number; features: FeatureVector; explored: boolean }[] }
): Promise<void> {
  if (params.items.length === 0) return
  await sb.from('rec_impressions').insert(
    params.items.map(it => ({
      serve_id: params.serveId,
      user_id: userId,
      city_id: params.cityId,
      event_id: it.eventId,
      surface: params.surface,
      position: it.position,
      features: it.features,
      model_version: params.modelVersion,
      explored: it.explored,
    }))
  )
  // Exposure bumps each event's engagement prior write-through (shared aggregate).
  await Promise.all(params.items.map(it => sb.rpc('bump_impression', { p_event_id: it.eventId })))
}

// --- Profile lists: interested / hidden ------------------------------------

export async function listInterestedEventIds(sb: SB): Promise<string[]> {
  const { data } = await sb
    .from('interactions')
    .select('event_id, type, created_at')
    .in('type', ['interested', 'uninterested'])
    .not('event_id', 'is', null)
    .order('created_at', { ascending: false })
  const latest = new Map<string, string>()
  for (const r of data ?? []) {
    const id = r.event_id as string
    if (!latest.has(id)) latest.set(id, r.type as string)
  }
  return [...latest.entries()].filter(([, t]) => t === 'interested').map(([id]) => id)
}

export async function listHiddenEventIds(sb: SB): Promise<string[]> {
  const { data } = await sb.from('interactions').select('event_id').eq('type', 'hide').not('event_id', 'is', null)
  return [...new Set((data ?? []).map(r => r.event_id as string))]
}

export async function unhideEvent(sb: SB, eventId: string): Promise<void> {
  await sb.from('interactions').delete().eq('event_id', eventId).eq('type', 'hide')
}

// --- Explicit interests (survey + profile) ---------------------------------

export type InterestRow = { kind: string; value: string; weight: number }

export async function setUserInterests(sb: SB, userId: string, source: string, rows: InterestRow[]): Promise<void> {
  await sb.from('user_interests').delete().eq('source', source)
  if (rows.length > 0) {
    await sb.from('user_interests').upsert(
      rows.map(r => ({ user_id: userId, kind: r.kind, value: r.value, weight: r.weight, source })),
      { onConflict: 'user_id,kind,value' }
    )
  }
}

export async function setExplicitAffinities(sb: SB, userId: string, keys: { kind: string; value: string }[], score: number): Promise<void> {
  if (keys.length === 0) return
  // Don't lower an already-stronger learned score: read, take the max, upsert.
  const { data: existing } = await sb.from('user_affinity').select('kind, value, score')
  const prev = new Map((existing ?? []).map(r => [`${r.kind}:${r.value}`, r.score as number]))
  await sb.from('user_affinity').upsert(
    keys.map(k => ({ user_id: userId, kind: k.kind, value: k.value, score: Math.max(prev.get(`${k.kind}:${k.value}`) ?? 0, score) })),
    { onConflict: 'user_id,kind,value' }
  )
}

export async function listUserInterests(sb: SB): Promise<{ kind: string; value: string; weight: number; source: string }[]> {
  const { data } = await sb.from('user_interests').select('kind, value, weight, source').order('kind')
  return (data ?? []) as { kind: string; value: string; weight: number; source: string }[]
}

// --- Profile + privacy -----------------------------------------------------

export async function updateProfile(
  sb: SB,
  patch: { display_name?: string | null; home_city_id?: number | null; personalization_opt_out?: boolean }
): Promise<void> {
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return
  await sb.from('profiles').update(patch).eq('id', user.id)
}

export async function markOnboarded(sb: SB, userId: string): Promise<void> {
  // The auth trigger normally creates the profile row on signup, but guard the
  // edge case (e.g. accounts predating the trigger) so the stamp can't silently
  // no-op: ensure the row exists, then stamp onboarded_at once (first write wins).
  await sb.from('profiles').upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true })
  await sb.from('profiles').update({ onboarded_at: new Date().toISOString() }).eq('id', userId).is('onboarded_at', null)
}

// "Clear my history": delete the actor's behavioral + derived rows (favorites and
// stated interests are kept — they're the saved list, not history).
export async function clearHistory(sb: SB): Promise<void> {
  await Promise.all([
    sb.from('interactions').delete().neq('id', 0),
    sb.from('rec_impressions').delete().neq('id', 0),
    sb.from('user_affinity').delete().neq('kind', ''),
    sb.from('user_vectors').delete().neq('n', -1),
  ])
}
