// Recommendation engine — explicit-preference mapping (pure; no DB).
//
// Turns an onboarding/profile survey payload into the two shapes the DB layer
// writes: the durable user_interests rows (the record of what was chosen) and the
// user_affinity keys the live scorer reads (kind/value matching lib/recs/score).
// Kept pure so both /api/onboarding and /api/profile share one mapping and it
// unit-tests without a database.

import type { AffinityKey } from './affinity'

export type SurveyPrefs = {
  categories: string[] // category slugs
  neighborhoods: string[] // Austin neighborhood names
  freeOnly: boolean
  days: number[] // day-of-week 0=Sun … 6=Sat
}

export type InterestRow = { kind: string; value: string; weight: number }

// The affinity keys a set of survey picks maps to, using the scorer's kinds:
// category / neighborhood / dow / price(free_only). Venue isn't surveyed.
export function surveyToAffinityKeys(p: SurveyPrefs): AffinityKey[] {
  const keys: AffinityKey[] = []
  for (const c of p.categories) keys.push({ kind: 'category', value: c })
  for (const n of p.neighborhoods) keys.push({ kind: 'neighborhood', value: n })
  for (const d of p.days) keys.push({ kind: 'dow', value: String(d) })
  if (p.freeOnly) keys.push({ kind: 'price', value: 'free_only' })
  return keys
}

// The same picks as durable user_interests rows (weight 1.0 — a positive pick).
export function surveyToInterestRows(p: SurveyPrefs): InterestRow[] {
  return surveyToAffinityKeys(p).map(k => ({ kind: k.kind, value: k.value, weight: 1.0 }))
}
