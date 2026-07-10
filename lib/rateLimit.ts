// A lightweight in-memory rate limiter for public, unauthenticated endpoints
// that trigger real outbound work (fetches, Gemini calls). Per-process state,
// not distributed — the same documented tradeoff as lib/gemini.ts's daily
// budget counter (see that file's comment on why this is acceptable here).
const hits = new Map<string, number[]>()

// Returns true if `key` may proceed, false if it's exceeded `max` calls within
// `windowMs`. Prunes stale timestamps on every call so the map doesn't grow
// unbounded over the life of the process.
export function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const timestamps = (hits.get(key) ?? []).filter(t => now - t < windowMs)
  if (timestamps.length >= max) {
    hits.set(key, timestamps)
    return false
  }
  timestamps.push(now)
  hits.set(key, timestamps)
  return true
}

// Best-effort client IP from standard proxy headers (Vercel sets
// x-forwarded-for). Falls back to a constant so requests without either
// header still share one (conservative) bucket rather than bypassing the
// limiter entirely.
export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}
