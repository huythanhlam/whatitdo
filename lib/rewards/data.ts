import type { SupabaseClient } from '@supabase/supabase-js'
import { computeCounts, levelFor, evaluateBadges, pointsFor, type RewardInput, type AttendedEventLite } from './engine'
import { getBadge, type MedalTier } from './catalog'

// RLS-scoped reward data access (the caller's `authenticated` session), mirroring
// lib/user/data.ts. Everything is best-effort: the whole rewards feature is
// additive status, so a failure here (including the user_badges table not being
// present on the bare PGlite dev path, where post-033 migrations don't run) must
// never break the account page or the action that triggered a sync.

type SB = SupabaseClient

export type EarnedBadge = { id: string; awardedAt: string }
export type RewardsSummary = {
  points: number
  level: { id: string; name: string; tier: MedalTier }
  next: { id: string; name: string; minPoints: number } | null
  progress: number
  earned: EarnedBadge[]
  newlyEarned: string[] // badge ids first earned during this sync
}

export function emptySummary(): RewardsSummary {
  const { level, next, progress } = levelFor(0)
  return {
    points: 0,
    level: { id: level.id, name: level.name, tier: level.tier },
    next: next ? { id: next.id, name: next.name, minPoints: next.minPoints } : null,
    progress,
    earned: [],
    newlyEarned: [],
  }
}

type EventCatsRow = {
  id: string
  start_time: string
  event_categories: { categories: { slug: string } | { slug: string }[] | null }[] | null
}

// Gather everything the engine needs from the user's own (RLS-scoped) rows.
async function gatherInput(sb: SB, userId: string, now: number): Promise<RewardInput> {
  const [intRes, profRes, subRes] = await Promise.all([
    sb.from('interactions').select('type, event_id, created_at'),
    sb.from('profiles').select('onboarded_at, created_at').eq('id', userId).maybeSingle(),
    sb.from('subscriptions').select('confirmed').eq('confirmed', true).limit(1),
  ])

  const interactions = (intRes.data ?? []).map(r => ({
    type: r.type as string,
    eventId: (r.event_id as string | null) ?? null,
    createdAt: Date.parse(r.created_at as string) || now,
  }))

  const attendedIds = [...new Set(interactions.filter(i => i.type === 'attended' && i.eventId).map(i => i.eventId as string))]

  let attendedEvents: AttendedEventLite[] = []
  if (attendedIds.length > 0) {
    const { data } = await sb
      .from('events')
      .select('id, start_time, event_categories(categories(slug))')
      .in('id', attendedIds)
    attendedEvents = ((data ?? []) as unknown as EventCatsRow[]).map(e => {
      const ecs = e.event_categories ?? []
      const slugs = ecs.flatMap(ec => {
        const c = ec.categories
        if (!c) return []
        return Array.isArray(c) ? c.map(x => x.slug) : [c.slug]
      }).filter((s): s is string => !!s)
      return {
        eventId: e.id,
        startTime: Date.parse(e.start_time) || now,
        categorySlugs: slugs,
      }
    })
  }

  const onboarded = !!profRes.data?.onboarded_at
  const accountCreatedAt = profRes.data?.created_at ? (Date.parse(profRes.data.created_at as string) || null) : null
  const subscribed = (subRes.data?.length ?? 0) > 0

  return { interactions, attendedEvents, onboarded, subscribed, accountCreatedAt, now }
}

function summarize(earnedIds: string[], earned: EarnedBadge[], newlyEarned: string[]): RewardsSummary {
  const points = pointsFor(earnedIds)
  const { level, next, progress } = levelFor(points)
  return {
    points,
    level: { id: level.id, name: level.name, tier: level.tier },
    next: next ? { id: next.id, name: next.name, minPoints: next.minPoints } : null,
    progress,
    earned,
    newlyEarned,
  }
}

// Read the user's current rewards without evaluating/awarding new ones.
export async function getRewardsSummary(sb: SB): Promise<RewardsSummary> {
  try {
    const { data, error } = await sb.from('user_badges').select('badge_id, awarded_at').order('awarded_at')
    if (error) return emptySummary()
    const earned = (data ?? []).map(r => ({ id: r.badge_id as string, awardedAt: r.awarded_at as string }))
    return summarize(earned.map(e => e.id), earned, [])
  } catch {
    return emptySummary()
  }
}

// Recompute the user's badges from their full history, insert any newly earned
// ones (idempotently), and return the resulting summary. `newlyEarned` lets the
// caller celebrate. Never throws.
export async function syncRewards(sb: SB, userId: string, now: number = Date.now()): Promise<RewardsSummary> {
  try {
    const input = await gatherInput(sb, userId, now)
    const counts = computeCounts(input)
    const qualifiedIds = evaluateBadges(counts)

    const { data: existingRows, error } = await sb.from('user_badges').select('badge_id, awarded_at')
    if (error) return emptySummary() // table absent (dev) or read blocked — degrade gracefully

    const existing = new Map((existingRows ?? []).map(r => [r.badge_id as string, r.awarded_at as string]))
    const newlyEarned = qualifiedIds.filter(id => !existing.has(id))

    if (newlyEarned.length > 0) {
      const nowIso = new Date(now).toISOString()
      await sb.from('user_badges').upsert(
        newlyEarned.map(id => ({ user_id: userId, badge_id: id, points: getBadge(id)?.points ?? 0, awarded_at: nowIso })),
        { onConflict: 'user_id,badge_id', ignoreDuplicates: true },
      )
      for (const id of newlyEarned) existing.set(id, nowIso)
    }

    // Badges are permanent: the earned set is the union of what was recorded and
    // what was just inserted (never revoked if a count later drops).
    const earned: EarnedBadge[] = [...existing.entries()].map(([id, awardedAt]) => ({ id, awardedAt }))
    return summarize(earned.map(e => e.id), earned, newlyEarned)
  } catch {
    return emptySummary()
  }
}
