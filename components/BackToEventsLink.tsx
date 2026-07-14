'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Root not-found.tsx never receives the [city] route param (not-found files
// don't accept props), so the city has to be recovered from the browser URL —
// otherwise every 404 would send visitors back to whichever city happens to
// be first in getEnabledCities() instead of the one they were browsing.
export function BackToEventsLink({
  citySlugs,
  fallbackCity,
}: {
  citySlugs: string[]
  fallbackCity: string
}) {
  const pathname = usePathname()
  const segment = pathname.split('/')[1]
  const city = segment && citySlugs.includes(segment) ? segment : fallbackCity

  return (
    <Link
      href={`/${city}`}
      className="inline-flex items-center h-11 text-sm bg-primary text-primary-foreground px-5 rounded-md hover:bg-primary/90 transition-colors font-medium"
    >
      Back to events
    </Link>
  )
}
