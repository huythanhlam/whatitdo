'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { sendAction } from '@/lib/recs/client'

// Shared auth + favorites state for every event card on a page, fetched once.
// Any EventCard rendered under this provider gets working save/interested/hide
// buttons (see EventCardActions) — so signals are gathered on ALL events, not
// just the recommendation rails. The buttons only render for signed-in users;
// logged-out visitors (or pages with no provider) see plain cards.
type InteractionCtx = {
  authed: boolean
  favorited: Set<string>
  toggleFavorite: (eventId: string, serveId: string | null) => void
  city: string
}

const Ctx = createContext<InteractionCtx | null>(null)
export function useInteractions(): InteractionCtx | null {
  return useContext(Ctx)
}

export function InteractionProvider({
  city,
  authed,
  children,
}: {
  city: string
  authed: boolean
  children: React.ReactNode
}) {
  const [favorited, setFavorited] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!authed) return
    let alive = true
    fetch(`/api/favorites?city=${encodeURIComponent(city)}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { favorites: [] }))
      .catch(() => ({ favorites: [] }))
      .then(favs => {
        if (alive) setFavorited(new Set<string>(favs?.favorites ?? []))
      })
    return () => {
      alive = false
    }
  }, [city, authed])

  const toggleFavorite = useCallback(
    (eventId: string, serveId: string | null) => {
      setFavorited(prev => {
        const next = new Set(prev)
        const has = next.has(eventId)
        if (has) next.delete(eventId)
        else next.add(eventId)
        void sendAction(has ? 'unfavorite' : 'favorite', { eventId, city, serveId })
        return next
      })
    },
    [city]
  )

  return <Ctx.Provider value={{ authed, favorited, toggleFavorite, city }}>{children}</Ctx.Provider>
}
