import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getUser } from '@/lib/auth/server'
import { getCityBySlug, getDistinctNeighborhoods, listRecommendedEvents } from '@/lib/db'
import { CATEGORIES } from '@/lib/categories'
import { OnboardingSurvey } from '@/components/OnboardingSurvey'
import { sanitizeNext } from '@/lib/auth/nextParam'
import type { RecEvent } from '@/lib/recs/client'
import type { ActorTaste } from '@/lib/recs/score'

// Post-auth onboarding. Session-gated (the survey is account-only); anonymous
// visitors are sent to sign-in. Dynamic because it reads the session cookie.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Welcome',
  robots: { index: false },
}

const RECS_CITY = 'austin'

const EMPTY_TASTE: ActorTaste = { affinity: new Map(), vector: null }
const EMPTY_STATE = { hidden: new Set<string>(), seen: new Map<string, number>() }

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>
}) {
  const { next: rawNext } = await searchParams
  // Where to send the user after they finish/skip. Sanitized (open-redirect
  // safe); preserved across the signin bounce so a not-yet-onboarded visitor is
  // pushed back to signin with the destination still attached.
  const next = sanitizeNext(rawNext)
  const { user } = await getUser()
  if (!user) {
    const back = next ? `/onboarding?next=${encodeURIComponent(next)}` : '/onboarding'
    redirect(`/signin?redirect=${encodeURIComponent(back)}`)
  }

  const city = await getCityBySlug(RECS_CITY)
  // Trending picks for step 3 (a fresh account has no taste yet).
  const [neighborhoods, recs] = await Promise.all([
    city ? getDistinctNeighborhoods(city.id) : Promise.resolve<string[]>([]),
    city
      ? listRecommendedEvents(city.id, EMPTY_TASTE, EMPTY_STATE, { limit: 12 })
      : Promise.resolve({ events: [] as RecEvent[] }),
  ])

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <OnboardingSurvey
          categories={CATEGORIES.map(c => ({ slug: c.slug, name: c.name, color: c.color }))}
          neighborhoods={neighborhoods}
          topEvents={recs.events as RecEvent[]}
          city={RECS_CITY}
          basePath={`/${RECS_CITY}`}
          next={next ?? undefined}
        />
      </div>
    </div>
  )
}
