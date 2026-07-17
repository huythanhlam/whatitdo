import type { Metadata } from 'next'
import { Suspense } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { MapPin, ArrowLeft, Bookmark, Sparkles, CalendarHeart, Check } from 'lucide-react'
import { SignUpForm } from '@/components/SignUpForm'
import { getUser } from '@/lib/auth/server'
import { requireCity } from '@/lib/cities'
import { isRecsCity } from '@/lib/recs/config'
import { listEvents, countEvents } from '@/lib/db'
import { resolveDateRange } from '@/lib/dateRanges'
import { CATEGORY_SLUGS, getCategoryBySlug } from '@/lib/categories'
import { toIntent, destForIntent, type Intent } from '@/lib/auth/nextParam'
import type { EnrichedEvent } from '@/lib/types'

// The registration gate. Landing CTAs (Browse Events / This Weekend / a category
// tile) send logged-out visitors here instead of straight to the results, since
// the full events list is account-gated. We motivate the sign-up with a taste of
// what's inside, then hand the intended destination to the sign-in form — which
// threads it through /auth/callback and onboarding so finishing (or skipping)
// lands the visitor exactly where the CTA promised.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Join — save events & get picks tuned to you',
  robots: { index: false }, // account surface — nothing to index
}

function first(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined
}

const COPY: Record<Intent, { eyebrow: (city: string) => string; lead: string }> = {
  browse: {
    eyebrow: city => `Everything on in ${city}`,
    lead: 'the full lineup — every concert, festival, and night out we track',
  },
  weekend: {
    eyebrow: () => 'Your weekend, sorted',
    lead: 'everything happening this weekend, from marquee shows to hidden gems',
  },
  category: {
    eyebrow: city => `The best in ${city}`,
    lead: 'the full lineup in the scene you care about',
  },
}

const BENEFITS = [
  { Icon: Bookmark, title: 'Save the ones you like', body: 'Build a shortlist you can come back to — one tap from any event.' },
  { Icon: Sparkles, title: 'Picks tuned to your taste', body: 'Tell us what you’re into once; the feed learns and sharpens from there.' },
  { Icon: CalendarHeart, title: 'Never miss the good stuff', body: 'An optional weekly digest of the best events, straight to your inbox.' },
]

function PreviewCard({ event }: { event: EnrichedEvent }) {
  const date = new Date(event.start_time)
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return (
    <div className="group flex items-center gap-3 rounded-xl border border-border bg-card/70 p-2 pr-3">
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
        {event.image_url ? (
          <Image src={event.image_url} alt="" fill sizes="56px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg" style={{ background: 'var(--color-slate-100)' }}>
            🎟️
          </div>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{event.title}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{dateStr}</span>
          {event.venue_name && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{event.venue_name}</span>
            </>
          )}
        </p>
      </div>
    </div>
  )
}

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ city: string }>
  searchParams: Promise<Record<string, string | string[]>>
}) {
  const { city: citySlug } = await params
  const city = await requireCity(citySlug)
  const sp = await searchParams
  const base = `/${city.slug}`

  const intent = toIntent(sp.intent)
  const rawCat = first(sp.cat)
  const category = intent === 'category' && rawCat && (CATEGORY_SLUGS as string[]).includes(rawCat) ? rawCat : undefined
  const dest = destForIntent(base, intent, category)

  // The gate only makes sense where there's an account to create (recs cities
  // have the onboarding + personalized list). Anywhere else — or for someone
  // already signed in — skip straight to the promised destination.
  const { user } = await getUser()
  if (user || !isRecsCity(citySlug)) redirect(dest)

  // A taste of what's behind the wall, matched to the CTA the visitor clicked.
  const range = intent === 'weekend' ? resolveDateRange({ when: 'weekend' }) : null
  const filterArgs = {
    cityId: city.id,
    categories: category ? [category] : [],
    from: range?.fromIso,
    to: range?.toIso ?? undefined,
  }
  const [previewEvents, total] = await Promise.all([
    listEvents({ ...filterArgs, limit: 3, offset: 0 }),
    countEvents(filterArgs),
  ])

  const cat = category ? getCategoryBySlug(category) : undefined
  const copy = COPY[intent]
  const eyebrow = intent === 'category' && cat ? cat.name : copy.eyebrow(city.name)
  const accent = cat?.color ?? 'var(--color-coral-500)'

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Brand glows, echoing the city hero so the gate feels like the same room. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-32 h-[28rem] w-[28rem] rounded-full opacity-40 blur-3xl"
        style={{ background: `radial-gradient(circle, ${accent}, transparent 70%)` }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-48 -right-24 h-[28rem] w-[28rem] rounded-full opacity-25 blur-3xl"
        style={{ background: 'radial-gradient(circle, var(--color-slate-500), transparent 70%)' }}
      />

      <header className="relative border-b border-border/70">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link href={base} className="flex items-center gap-2 shrink-0">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-base">🎉</span>
            <span className="font-display text-lg font-semibold tracking-tight text-foreground">Whats Happenin</span>
          </Link>
          <Link
            href={base}
            className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to events
          </Link>
        </div>
      </header>

      <main className="relative mx-auto grid max-w-6xl gap-10 px-4 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 lg:py-20">
        {/* Left: the pitch. min-w-0 so the grid track can shrink below the
            headline's intrinsic width instead of overflowing on narrow screens. */}
        <div className="min-w-0" style={{ animation: 'fade-up 0.5s ease-out both' }}>
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
            <MapPin className="h-3.5 w-3.5" /> {eyebrow}
          </p>
          <h1 className="mt-4 font-display text-4xl font-semibold leading-[1.05] text-foreground text-balance sm:text-5xl">
            Create a free account to unlock {copy.lead}.
          </h1>
          <p className="mt-4 max-w-md text-base text-muted-foreground text-balance">
            It takes less than a minute — just your email and a password, and you’re in.
          </p>

          <ul className="mt-8 space-y-4">
            {BENEFITS.map(({ Icon, title, body }) => (
              <li key={title} className="flex gap-3.5">
                <span
                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: '#F17A7E1c', color: 'var(--color-coral-600)' }}
                >
                  <Icon className="h-5 w-5" strokeWidth={1.9} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">{title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ul>

          {previewEvents.length > 0 && (
            <div className="mt-9">
              <p className="mb-3 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                A taste of what’s inside
              </p>
              <div className="space-y-2">
                {(previewEvents as unknown as EnrichedEvent[]).map(ev => (
                  <PreviewCard key={ev.id} event={ev} />
                ))}
              </div>
              {total > previewEvents.length && (
                <p className="mt-3 text-sm text-muted-foreground">
                  …and{' '}
                  <span className="font-semibold text-foreground">{(total - previewEvents.length).toLocaleString()}</span> more
                  waiting inside.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Right: the sign-up card. */}
        <div className="min-w-0 lg:pt-1" style={{ animation: 'fade-up 0.6s ease-out both' }}>
          <div className="rounded-2xl border border-border bg-card p-6 shadow-xl shadow-slate-900/5 sm:p-8 lg:sticky lg:top-10">
            <h2 className="font-display text-xl font-semibold text-foreground">Get started</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              You’ll pick a few interests next, then jump right into{' '}
              {intent === 'weekend' ? 'this weekend’s events' : intent === 'category' && cat ? `${cat.name.toLowerCase()} events` : 'the full lineup'}.
            </p>
            <div className="mt-5">
              <Suspense>
                <SignUpForm redirectTo={dest} />
              </Suspense>
            </div>
            <ul className="mt-5 space-y-1.5 border-t border-border pt-4">
              {['Free forever', 'Takes under a minute', 'Unsubscribe anytime'].map(t => (
                <li key={t} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Check className="h-3.5 w-3.5 text-primary" /> {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </main>
    </div>
  )
}
