// Recommendation engine — tunable constants and the seeded model.
//
// One place for every magic number the recommender uses, so the DB layer, the
// API routes, and the (later) training job all agree. Nothing here reaches out
// to the database; it's pure configuration + the v1 prior weights.

// --- City gating ------------------------------------------------------------
// The feature launches Austin-only. Tracking, the For You rail, the survey, and
// the profile all no-op for any city not in this list; expansion is one entry.
export const RECS_CITIES = ['austin'] as const

export function isRecsCity(slug: string | null | undefined): boolean {
  return !!slug && (RECS_CITIES as readonly string[]).includes(slug)
}

// --- Interaction types ------------------------------------------------------
// The allowlist /api/track validates against. Adding a type here is all it takes
// for the beacon to accept it; the write-through logic keys off the sets below.
export const INTERACTION_TYPES = [
  'view',
  'clickout',
  'favorite',
  'unfavorite',
  'interested',
  'uninterested',
  'hide',
  'calendar_add',
  'share',
  'search',
  'digest_click',
] as const

export type InteractionType = (typeof INTERACTION_TYPES)[number]

export function isInteractionType(v: unknown): v is InteractionType {
  return typeof v === 'string' && (INTERACTION_TYPES as readonly string[]).includes(v)
}

// Positive engagement: the signals that count as "this person liked this event."
// They drive event_engagement (the trending prior) and are the training label
// for an impression.
export const POSITIVE_ENGAGEMENT_TYPES: ReadonlySet<InteractionType> = new Set([
  'favorite',
  'interested',
  'clickout',
  'calendar_add',
])

// A negative signal actively pushes an event/category down for that actor.
export const NEGATIVE_ENGAGEMENT_TYPES: ReadonlySet<InteractionType> = new Set([
  'hide',
  'unfavorite',
  'uninterested',
])

// Per-signal magnitude fed into the affinity EMA (§3 of RECOMMENDATIONS-SPEC).
// These size how hard one signal nudges a taste; how much each resulting feature
// then matters to the ranking is the model's job, not these numbers'.
export const SIGNAL_MAGNITUDE: Record<InteractionType, number> = {
  favorite: 4.0,
  interested: 2.5,
  clickout: 3.0,
  calendar_add: 3.0,
  share: 2.0,
  view: 1.0,
  digest_click: 2.0,
  search: 0.5,
  hide: -4.0,
  unfavorite: -2.0,
  uninterested: -2.5,
}

// --- Affinity math ----------------------------------------------------------
// EMA smoothing: score ← alpha*target + (1-alpha)*score. Higher alpha reacts
// faster but is noisier. A signal's magnitude maps to a target in [0,1] (or
// negative) before blending; see lib/recs/affinity.ts.
export const EMA_ALPHA = 0.3

// The magnitude that maps to a full-strength target of 1.0. A favorite (4.0)
// saturates; a view (1.0) is a quarter-strength nudge.
export const SIGNAL_SATURATION = 4.0

// Exponential time-decay half-life (days). Applied when the nightly batch ages
// stale affinities/engagement so tastes drift with recent behavior.
export const DECAY_HALFLIFE_DAYS = 45

// --- Event engagement prior -------------------------------------------------
// Bayesian smoothing strength: the prior counts as this many pseudo-impressions
// at the city-average rate, so a brand-new event starts at the average instead
// of a noisy 0/0, and needs real volume to move off it.
export const ENGAGEMENT_PRIOR_STRENGTH = 20

// Fallback city-average engagement rate before enough data exists to compute one.
export const DEFAULT_CITY_ENGAGEMENT_RATE = 0.1

// --- Serving ----------------------------------------------------------------
// Candidate window: only events starting within the next N days are eligible.
export const RECS_WINDOW_DAYS = 14
// Hard cap on candidates scored per request (keeps the in-TS scoring bounded).
export const RECS_CANDIDATE_CAP = 300
// Default rail/feed size and how many of those slots go to exploration.
export const RECS_DEFAULT_LIMIT = 20
export const RECS_EXPLORE_SLOTS = 2

// --- The seeded model -------------------------------------------------------
// v1 prior weights for the logistic-regression scorer. MUST match the seed in
// supabase/migrations/031_ml.sql (a test asserts the active DB row equals this).
// `embedding_sim` is present but its feature isn't computed until the embedding
// column ships; the scorer treats an absent feature as 0.
export type ModelWeights = {
  bias: number
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

export const V1_MODEL_WEIGHTS: ModelWeights = {
  bias: -2.0,
  category_affinity: 2.0,
  venue_affinity: 1.0,
  neighborhood_affinity: 0.8,
  price_fit: 0.5,
  dow_affinity: 0.3,
  engagement_prior: 1.5,
  embedding_sim: 1.2,
  proximity: 0.4,
  seen_count: -0.5,
}
