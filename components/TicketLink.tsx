'use client'

import { track } from '@/lib/track'

// A ticket/RSVP link that logs a 'clickout' before the browser navigates away.
// Clickout is one of the strongest implicit signals (intent to actually go), and
// it happens exactly when the page is about to unload — so it relies on the
// sendBeacon path in lib/track, which the browser delivers even mid-navigation.
// A plain server-rendered <a> can't do this, hence this small client island.
export function TicketLink({
  href,
  eventId,
  city,
  className,
  title,
  children,
}: {
  href: string
  eventId: string
  city: string
  className?: string
  title?: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className={className}
      onClick={() => track('clickout', { eventId, city })}
    >
      {children}
    </a>
  )
}
