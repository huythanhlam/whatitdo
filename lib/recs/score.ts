// Recommendation engine — the ranking model's scoring + re-ranking (pure).
//
// This is where the model actually ranks. Given an actor's affinities/taste
// vector and a set of candidate events, it builds each candidate's feature
// vector, scores it as the dot product with the active model's weights (logistic
// regression — ranking needs the linear score, not the sigmoid), then applies a
// diversity cap and reserves a few exploration slots. All pure and DB-free so it
// unit-tests without a database; lib/db/index.ts feeds it rows and persists the
// resulting impressions.

import type { ModelWeights } from './config'
import { dayOfWeekKey } from './affinity'
import { cosine } from './embed'
import { DEFAULT_CITY_ENGAGEMENT_RATE } from './config'

// The feature vector. Keys match ModelWeights (minus bias). Kept as a plain
// object so an impression can log exactly what was scored.
export type FeatureVector = {
  category_affinity: number
  venue_affinity: number
  neighborhood_affinity: number
  price_fit: number
  dow_affinity: number
  engagement_prior: number
  embedding_sim: number
  proximity: number
  seen_count: number
}

export const FEATURE_KEYS: (keyof FeatureVector)[] = [
  'category_affinity',
  'venue_affinity',
  'neighborhood_affinity',
  'price_fit',
  'dow_affinity',
  'engagement_prior',
  'embedding_sim',
  'proximity',
  'seen_count',
]

// A candidate event reduced to what scoring needs. lib/db builds these from SQL.
export type Candidate = {
  id: string
  categorySlugs: string[]
  venueNorm: string | null
  neighborhood: string | null
  isFree: boolean
  startTime: string // ISO
  engagementScore: number | null // event_engagement.score, null if never scored
  embedding: number[] | null
  seenCount: number // prior views of this event by the actor
}

// An actor's affinities as a flat map keyed "kind:value" → score, plus their
// taste vector (null when they have none yet).
export type ActorTaste = {
  affinity: Map<string, number>
  vector: number[] | null
}

export type ScoredCandidate = {
  id: string
  score: number
  features: FeatureVector
  explored: boolean
}

// A scored candidate that made the final list, with its shown rank (0-based).
export type RankedImpression = ScoredCandidate & { position: number }

function aff(map: Map<string, number>, kind: string, value: string | null): number {
  if (!value) return 0
  return map.get(`${kind}:${value}`) ?? 0
}

// Build one candidate's feature vector against an actor's taste. `nowMs` is
// passed in (not read from the clock) so scoring is deterministic and testable.
export function computeFeatures(c: Candidate, taste: ActorTaste, nowMs: number): FeatureVector {
  const categoryAffinity = c.categorySlugs.length
    ? Math.max(...c.categorySlugs.map(s => aff(taste.affinity, 'category', s)))
    : 0

  const startMs = new Date(c.startTime).getTime()
  const daysUntil = Number.isNaN(startMs) ? 0 : Math.max(0, (startMs - nowMs) / 86_400_000)

  return {
    category_affinity: categoryAffinity,
    venue_affinity: aff(taste.affinity, 'venue', c.venueNorm),
    neighborhood_affinity: aff(taste.affinity, 'neighborhood', c.neighborhood),
    // Only free events read the free-price preference; paid events are neutral.
    price_fit: c.isFree ? aff(taste.affinity, 'price', 'free_only') : 0,
    dow_affinity: aff(taste.affinity, 'dow', dayOfWeekKey(c.startTime)),
    engagement_prior: c.engagementScore ?? DEFAULT_CITY_ENGAGEMENT_RATE,
    embedding_sim: cosine(taste.vector, c.embedding),
    proximity: 1 / (1 + daysUntil),
    seen_count: c.seenCount,
  }
}

// The model score: bias + Σ wᵢ·featureᵢ. Linear (pre-sigmoid) — monotonic in the
// engagement probability, which is all ranking needs.
export function scoreFeatures(features: FeatureVector, weights: ModelWeights): number {
  let s = weights.bias
  for (const k of FEATURE_KEYS) s += weights[k] * features[k]
  return s
}

export type RankOptions = {
  weights: ModelWeights
  nowMs: number
  limit: number
  exploreSlots?: number // slots reserved for exploration (default 2)
  categoryCap?: number // max events sharing a top category (default 3)
  venueCap?: number // max events sharing a venue (default 2)
}

// Greedy diversity pick: walk candidates best-first, taking one while its top
// category and venue are under their caps; overflow is kept to backfill if the
// caps leave us short of `limit`.
function diversityPick(
  ranked: ScoredCandidate[],
  byId: Map<string, Candidate>,
  limit: number,
  categoryCap: number,
  venueCap: number,
): ScoredCandidate[] {
  const chosen: ScoredCandidate[] = []
  const overflow: ScoredCandidate[] = []
  const catCount = new Map<string, number>()
  const venueCount = new Map<string, number>()

  for (const sc of ranked) {
    if (chosen.length >= limit) break
    const cand = byId.get(sc.id)!
    const topCat = cand.categorySlugs[0] ?? 'other'
    const venue = cand.venueNorm ?? ''
    const cc = catCount.get(topCat) ?? 0
    const vc = venue ? venueCount.get(venue) ?? 0 : 0
    if (cc < categoryCap && vc < venueCap) {
      chosen.push(sc)
      catCount.set(topCat, cc + 1)
      if (venue) venueCount.set(venue, vc + 1)
    } else {
      overflow.push(sc)
    }
  }
  // Backfill from overflow (still best-first) if diversity caps left room.
  for (const sc of overflow) {
    if (chosen.length >= limit) break
    chosen.push(sc)
  }
  return chosen
}

// Rank a candidate set into the final ordered list of size ≤ limit.
// Exploitation fills all but `exploreSlots`; those remaining slots go to
// exploration picks — the lowest-exposure candidates not already chosen — so the
// model keeps getting fresh data and new events earn a look. Explored items are
// flagged so training can account for their non-organic exposure.
export function rankCandidates(candidates: Candidate[], taste: ActorTaste, opts: RankOptions): RankedImpression[] {
  const { weights, nowMs, limit } = opts
  const exploreSlots = Math.min(opts.exploreSlots ?? 2, Math.max(0, limit))
  const categoryCap = opts.categoryCap ?? 3
  const venueCap = opts.venueCap ?? 2

  const byId = new Map(candidates.map(c => [c.id, c]))
  const scored: ScoredCandidate[] = candidates.map(c => {
    const features = computeFeatures(c, taste, nowMs)
    return { id: c.id, features, score: scoreFeatures(features, weights), explored: false }
  })
  scored.sort((a, b) => b.score - a.score)

  const exploitTarget = Math.max(0, limit - exploreSlots)
  const exploited = diversityPick(scored, byId, exploitTarget, categoryCap, venueCap)

  if (exploited.length >= limit) return exploited.slice(0, limit).map(withPosition)

  // Exploration: from what's left, prefer the least-exposed events (lowest prior
  // engagement score → newest/least-shown), so exploration probes the unknown.
  const chosenIds = new Set(exploited.map(s => s.id))
  const remaining = scored
    .filter(s => !chosenIds.has(s.id))
    .sort((a, b) => (byId.get(a.id)!.engagementScore ?? 0) - (byId.get(b.id)!.engagementScore ?? 0))

  const explore = remaining.slice(0, limit - exploited.length).map(s => ({ ...s, explored: true }))
  return [...exploited, ...explore].map(withPosition)
}

// Positions are assigned after final ordering; carried on the scored object for
// the impression log (position-bias correction at training time needs them).
function withPosition(sc: ScoredCandidate, i: number): RankedImpression {
  return { ...sc, position: i }
}
