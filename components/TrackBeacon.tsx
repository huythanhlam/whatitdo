'use client'

import { useEffect, useRef } from 'react'
import { track } from '@/lib/track'

// Fires a one-shot implicit signal when it mounts — used on the event detail
// page to log a 'view'. Rendered from a server component (it takes only plain
// props), so the page stays a server component while this island does the
// client-only beacon. The ref guards against React's double-invoke in dev
// StrictMode so a view isn't counted twice.
export function TrackBeacon({ eventId, city }: { eventId: string; city: string }) {
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    track('view', { eventId, city })
  }, [eventId, city])
  return null
}
