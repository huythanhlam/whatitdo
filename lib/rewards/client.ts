// Client-side rewards helpers. Kept tiny and dependency-free, matching
// lib/recs/client.ts.

export type CheckInResult =
  | { ok: true; already?: boolean; newlyEarned: string[] }
  | { ok: false; error: string }

// Check into an event. The server enforces the time gate + idempotency; this just
// posts and returns any newly earned badge ids so the caller can celebrate.
export async function checkIn(opts: { eventId: string; city: string }): Promise<CheckInResult> {
  try {
    const res = await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: opts.eventId, city: opts.city }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: (data?.error as string) || 'Check-in failed' }
    return { ok: true, already: !!data.already, newlyEarned: (data.newlyEarned as string[]) ?? [] }
  } catch {
    return { ok: false, error: 'Network error' }
  }
}
