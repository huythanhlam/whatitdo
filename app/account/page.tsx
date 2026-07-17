import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth/server'
import {
  getCityBySlug,
  getDistinctNeighborhoods,
  listUserInterests,
  listFavoriteIds,
  listInterestedEventIds,
  listHiddenEventIds,
  getEventsByIds,
  getDigestSubscription,
} from '@/lib/db'
import { CATEGORIES } from '@/lib/categories'
import { AccountView } from '@/components/AccountView'
import type { SurveyPrefs } from '@/lib/recs/interests'

// The account/settings page. Session-gated; dynamic because it reads the session
// cookie. Loads the user's interests, saved/interested/hidden events, and digest
// status server-side, then hands them to the client editor.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your account',
  robots: { index: false },
}

const RECS_CITY = 'austin'

function groupInterests(rows: { kind: string; value: string }[]): SurveyPrefs {
  return {
    categories: rows.filter(r => r.kind === 'category').map(r => r.value),
    neighborhoods: rows.filter(r => r.kind === 'neighborhood').map(r => r.value),
    days: rows.filter(r => r.kind === 'dow').map(r => Number(r.value)).filter(n => Number.isInteger(n)),
    freeOnly: rows.some(r => r.kind === 'price' && r.value === 'free_only'),
  }
}

type EventLite = { id: string; title: string; start_time: string; venue_name: string | null }
function toLite(e: { id: string; title?: unknown; start_time?: unknown; venue_name?: unknown }): EventLite {
  return {
    id: e.id,
    title: typeof e.title === 'string' ? e.title : '',
    start_time: typeof e.start_time === 'string' ? e.start_time : '',
    venue_name: typeof e.venue_name === 'string' ? e.venue_name : null,
  }
}

export default async function AccountPage() {
  const user = await currentUser()
  if (!user) redirect(`/signin?redirect=/account`)

  const actor = { userId: user.id, anonId: null }
  const city = await getCityBySlug(RECS_CITY)

  const [interests, favIds, intIds, hidIds, neighborhoods, digest] = await Promise.all([
    listUserInterests(user.id),
    listFavoriteIds(actor),
    listInterestedEventIds(actor),
    listHiddenEventIds(actor),
    city ? getDistinctNeighborhoods(city.id) : Promise.resolve<string[]>([]),
    city ? getDigestSubscription(user.email, city.id) : Promise.resolve(null),
  ])

  const [favorites, interested, hidden] = await Promise.all([
    getEventsByIds(favIds),
    getEventsByIds(intIds),
    getEventsByIds(hidIds),
  ])

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/95 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href={`/${RECS_CITY}`} className="text-sm text-primary hover:underline">← Back to events</Link>
          <Link href="/onboarding" className="text-sm text-muted-foreground hover:text-foreground">Redo survey</Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="font-display text-2xl font-semibold mb-6">Your account</h1>
        <AccountView
          email={user.email}
          displayName={user.display_name}
          personalizationOptOut={user.personalization_opt_out}
          prefs={groupInterests(interests)}
          categories={CATEGORIES.map(c => ({ slug: c.slug, name: c.name, color: c.color }))}
          neighborhoods={neighborhoods}
          favorites={favorites.map(toLite)}
          interested={interested.map(toLite)}
          hidden={hidden.map(toLite)}
          digest={digest ? { frequency: digest.frequency, confirmed: digest.confirmed } : null}
        />
      </main>
    </div>
  )
}
