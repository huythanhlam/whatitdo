'use client'

import { createContext, useContext } from 'react'

// Shared auth state for every event card on a page. Any EventCard rendered under
// this provider gets working interested/hide buttons (see EventCardActions) — so
// signals are gathered on ALL events, not just the recommendation rails. The
// buttons only render for signed-in users; logged-out visitors (or pages with no
// provider) see plain cards.
type InteractionCtx = {
  authed: boolean
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
  return <Ctx.Provider value={{ authed, city }}>{children}</Ctx.Provider>
}
