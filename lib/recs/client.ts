// Client-side recommendation helpers. Kept tiny and dependency-free so the rail,
// the feed, and the card overlay all POST actions the same way.

export type RecEvent = Record<string, unknown> & {
  id: string
  categories?: { id: number; slug: string; name: string; color: string }[]
  is_featured?: boolean
  featured_label?: string | null
}

export type RecAction = 'favorite' | 'unfavorite' | 'interested' | 'uninterested' | 'hide'

// Fire an explicit action. Best-effort: resolves to whether the server accepted
// it, never throws, so optimistic UI can proceed regardless.
export async function sendAction(
  action: RecAction,
  opts: { eventId: string; city: string; serveId?: string | null },
): Promise<boolean> {
  try {
    const res = await fetch('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, eventId: opts.eventId, city: opts.city, serveId: opts.serveId ?? null }),
    })
    return res.ok
  } catch {
    return false
  }
}

export type RecommendationsResponse = {
  events: RecEvent[]
  serveId: string | null
  personalized?: boolean
}

// Fetch a ranked page for a surface ('rail' | 'for_you'). Returns an empty set
// on any failure so callers render a graceful empty state, never an error.
export async function fetchRecommendations(
  city: string,
  surface: 'rail' | 'for_you',
  limit: number,
  mode?: 'trending' | 'suggested',
): Promise<RecommendationsResponse> {
  try {
    const modeParam = mode ? `&mode=${mode}` : ''
    const res = await fetch(
      `/api/recommendations?city=${encodeURIComponent(city)}&surface=${surface}&limit=${limit}${modeParam}`,
      { cache: 'no-store' },
    )
    if (!res.ok) return { events: [], serveId: null }
    return await res.json()
  } catch {
    return { events: [], serveId: null }
  }
}

// The actor's saved event ids, for rendering already-saved hearts filled.
export async function fetchFavoriteIds(city: string): Promise<Set<string>> {
  try {
    const res = await fetch(`/api/favorites?city=${encodeURIComponent(city)}`, { cache: 'no-store' })
    if (!res.ok) return new Set()
    const data = await res.json()
    return new Set<string>(data.favorites ?? [])
  } catch {
    return new Set()
  }
}
