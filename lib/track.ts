import type { InteractionType } from '@/lib/recs/config'

// Client-side beacon helper. Fires a fire-and-forget signal to /api/track that
// survives the page unloading (important for clickouts, where navigation is
// about to tear the page down). Uses navigator.sendBeacon when available —
// which the browser guarantees to deliver even mid-unload — and falls back to
// fetch with keepalive. Never throws; tracking must not affect the UX.

type TrackPayload = {
  city: string
  eventId?: string
  serveId?: string
  query?: string
}

export function track(type: InteractionType, payload: TrackPayload): void {
  if (typeof navigator === 'undefined') return
  const body = JSON.stringify({ type, ...payload })
  try {
    if (typeof navigator.sendBeacon === 'function') {
      // A typed Blob makes the request Content-Type application/json so the
      // route's req.json() parses it.
      const blob = new Blob([body], { type: 'application/json' })
      if (navigator.sendBeacon('/api/track', blob)) return
    }
    void fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {
    // ignore — best-effort telemetry
  }
}
