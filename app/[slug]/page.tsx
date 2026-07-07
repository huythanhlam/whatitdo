import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { EventGrid } from '@/components/EventGrid'
import { listEvents } from '@/lib/db'
import { resolveDateRange } from '@/lib/dateRanges'
import { getBaseUrl } from '@/lib/site'
import { LANDING_PAGES, getLandingPage } from '@/lib/landingPages'
import type { EnrichedEvent } from '@/lib/types'

// Static generation: only the configured slugs exist; anything else 404s.
export const dynamicParams = false
// ISR: "tonight"/"this weekend" windows resolve at generation time; refresh every
// 15 minutes like the homepage so they stay current without per-request rendering.
export const revalidate = 900

export function generateStaticParams() {
  return LANDING_PAGES.map(p => ({ slug: p.slug }))
}

const MAX_EVENTS = 48

async function eventsFor(slug: string): Promise<EnrichedEvent[]> {
  const page = getLandingPage(slug)
  if (!page) return []
  const range = resolveDateRange({ when: page.filters.when ?? null })
  const events = await listEvents({
    categories: page.filters.categories as string[] | undefined,
    from: range.fromIso,
    to: range.toIso ?? undefined,
    isFree: page.filters.isFree,
    limit: MAX_EVENTS,
    offset: 0,
  })
  return events as unknown as EnrichedEvent[]
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const page = getLandingPage(slug)
  if (!page) return { title: 'Page not found' }
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: `/${page.slug}` },
    openGraph: { title: page.title, description: page.description, type: 'website' },
    twitter: { card: 'summary_large_image', title: page.title, description: page.description },
  }
}

export default async function LandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = getLandingPage(slug)
  if (!page) notFound()

  const events = await eventsFor(slug)

  // Link to the filtered homepage for the full list beyond the capped grid.
  const qs = new URLSearchParams()
  ;(page.filters.categories ?? []).forEach(c => qs.append('category', c))
  if (page.filters.when) qs.set('when', page.filters.when)
  const moreHref = `/?${qs.toString()}`

  const base = getBaseUrl()
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: page.title,
    itemListElement: events.map((e, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${base}/events/${e.id}`,
      name: e.title as string,
    })),
  }

  return (
    <div className="min-h-screen bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }} />
      <header className="border-b bg-white/95 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="font-bold text-lg text-violet-600">🎉 What It Do ATX</Link>
          <Link href="/subscribe" className="text-sm text-violet-600 hover:underline">Get updates</Link>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-2 text-slate-900">{page.title}</h1>
        <p className="text-sm text-muted-foreground mb-6 max-w-2xl">{page.description}</p>

        {events.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">
            Nothing on the calendar for this just yet — <Link href="/" className="text-violet-600 hover:underline">browse all Austin events</Link>.
          </div>
        ) : (
          <>
            <EventGrid events={events} />
            <div className="text-center mt-8">
              <Link href={moreHref} className="text-sm text-violet-600 hover:underline">
                See more Austin events →
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
