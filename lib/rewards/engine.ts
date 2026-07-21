// The reward engine: pure functions, no DB. Given a normalized snapshot of a
// user's history it computes their tallies, the badges they qualify for, their
// point total, and their level. Keeping this pure (mirroring lib/recs/config)
// makes every threshold trivially unit-testable and keeps one source of truth
// for the math the data layer and API both rely on.

import { BADGES, LEVELS, getBadge, type RewardCounts, type Level } from './catalog'

const DAY_MS = 86_400_000

// A single interaction, reduced to just what the engine needs.
export type InteractionLite = { type: string; eventId: string | null; createdAt: number }
// A distinct event the user attended, with the fields attendance badges need.
export type AttendedEventLite = { eventId: string; startTime: number; categorySlugs: string[] }

export type RewardInput = {
  interactions: InteractionLite[]
  attendedEvents: AttendedEventLite[]
  onboarded: boolean
  subscribed: boolean
  accountCreatedAt: number | null // epoch ms
  now: number                     // epoch ms
}

const dayIndex = (ms: number) => Math.floor(ms / DAY_MS)
// Arbitrary but consistent 7-day bucketing — good enough for "distinct weekends"
// and "consecutive weeks", which only need stable, comparable week indices.
const weekIndex = (ms: number) => Math.floor(dayIndex(ms) / 7)
const isWeekend = (ms: number) => {
  const d = new Date(ms).getUTCDay()
  return d === 0 || d === 6
}

// Resolve the latest state per event across a positive/negative type pair, and
// return the set of events whose latest state is the positive one.
function netPositive(interactions: InteractionLite[], positive: string, negative: string): Set<string> {
  const latest = new Map<string, { type: string; at: number }>()
  for (const i of interactions) {
    if (!i.eventId) continue
    if (i.type !== positive && i.type !== negative) continue
    const prev = latest.get(i.eventId)
    if (!prev || i.createdAt >= prev.at) latest.set(i.eventId, { type: i.type, at: i.createdAt })
  }
  const out = new Set<string>()
  for (const [id, v] of latest) if (v.type === positive) out.add(id)
  return out
}

// Longest run of consecutive integers in a set (used for the weekly attendance streak).
function longestConsecutiveRun(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...new Set(values)].sort((a, b) => a - b)
  let best = 1
  let run = 1
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1
    if (run > best) best = run
  }
  return best
}

export function computeCounts(input: RewardInput): RewardCounts {
  const { interactions } = input

  const favorited = netPositive(interactions, 'favorite', 'unfavorite')
  const interestedSet = netPositive(interactions, 'interested', 'uninterested')
  const saved = new Set<string>([...favorited, ...interestedSet]).size

  const calendarEvents = new Set<string>()
  let shares = 0
  let searches = 0
  let digestClicks = 0
  const activeDays = new Set<number>()

  for (const i of interactions) {
    activeDays.add(dayIndex(i.createdAt))
    if (i.type === 'calendar_add' && i.eventId) calendarEvents.add(i.eventId)
    else if (i.type === 'share') shares++
    else if (i.type === 'search') searches++
    else if (i.type === 'digest_click') digestClicks++
  }

  // Attendance: dedup to distinct events, then derive category/time tallies.
  const attendedById = new Map<string, AttendedEventLite>()
  for (const a of input.attendedEvents) if (!attendedById.has(a.eventId)) attendedById.set(a.eventId, a)
  const attendedEvents = [...attendedById.values()]

  const attendedByCategory: Record<string, number> = {}
  const weekendWeeks = new Set<number>()
  const attendedWeeks: number[] = []
  for (const a of attendedEvents) {
    for (const slug of new Set(a.categorySlugs)) {
      attendedByCategory[slug] = (attendedByCategory[slug] ?? 0) + 1
    }
    attendedWeeks.push(weekIndex(a.startTime))
    if (isWeekend(a.startTime)) weekendWeeks.add(weekIndex(a.startTime))
  }

  const accountAgeDays = input.accountCreatedAt != null
    ? Math.max(0, Math.floor((input.now - input.accountCreatedAt) / DAY_MS))
    : 0

  return {
    saved,
    calendarAdds: calendarEvents.size,
    shares,
    searches,
    digestClicks,
    attended: attendedEvents.length,
    attendedByCategory,
    distinctCategoriesAttended: Object.keys(attendedByCategory).length,
    weekendAttendances: weekendWeeks.size,
    longestWeeklyStreak: longestConsecutiveRun(attendedWeeks),
    onboarded: input.onboarded,
    subscribed: input.subscribed,
    accountAgeDays,
    activeDays: activeDays.size,
    total: interactions.length,
  }
}

export function evaluateBadges(counts: RewardCounts): string[] {
  return BADGES.filter(b => b.requires(counts)).map(b => b.id)
}

export function pointsFor(badgeIds: string[]): number {
  return badgeIds.reduce((sum, id) => sum + (getBadge(id)?.points ?? 0), 0)
}

export type LevelProgress = { level: Level; next: Level | null; progress: number }

export function levelFor(points: number): LevelProgress {
  let level = LEVELS[0]
  let next: Level | null = null
  for (let i = 0; i < LEVELS.length; i++) {
    if (points >= LEVELS[i].minPoints) {
      level = LEVELS[i]
      next = LEVELS[i + 1] ?? null
    }
  }
  // Fraction of the way from the current level's floor to the next level's floor.
  const progress = next
    ? Math.min(1, Math.max(0, (points - level.minPoints) / (next.minPoints - level.minPoints)))
    : 1
  return { level, next, progress }
}

export type Rewards = {
  badgeIds: string[]
  points: number
  level: Level
  next: Level | null
  progress: number
}

export function evaluateRewards(counts: RewardCounts): Rewards {
  const badgeIds = evaluateBadges(counts)
  const points = pointsFor(badgeIds)
  const { level, next, progress } = levelFor(points)
  return { badgeIds, points, level, next, progress }
}
