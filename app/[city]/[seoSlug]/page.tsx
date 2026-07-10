import { Suspense } from 'react'
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { EventList } from '@/components/EventList'
import { listEvents, countEvents, getCityBySlug } from '@/lib/db'
import { requireCity } from '@/lib/cities'
import { resolveDateRange } from '@/lib/dateRanges'
import { getSeoPage, SEO_PAGES } from '@/lib/seoPages'
import type { EnrichedEvent } from '@/lib/types'

export const revalidate = 900

export async function generateStaticParams() {
  return SEO_PAGES.map(p => ({ seoSlug: p.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string; seoSlug: string }>
}): Promise<Metadata> {
  const { city: citySlug, seoSlug } = await params
  const config = getSeoPage(seoSlug)
  if (!config) return {}

  const city = await getCityBySlug(citySlug)
  const cityName = city?.name ?? citySlug
  const description = config.description(cityName)

  return {
    title: config.title,
    description,
    alternates: { canonical: `/${citySlug}/${seoSlug}` },
    openGraph: { title: `${config.title} in ${cityName}`, description, type: 'website' },
    twitter: { card: 'summary_large_image', title: `${config.title} in ${cityName}`, description },
  }
}

export default async function SeoPage({
  params,
}: {
  params: Promise<{ city: string; seoSlug: string }>
}) {
  const { city: citySlug, seoSlug } = await params
  const config = getSeoPage(seoSlug)
  if (!config) notFound()

  const city = await requireCity(citySlug)
  const range = resolveDateRange({ when: config.when })
  const filterArgs = {
    cityId: city.id,
    categories: config.categories ?? [],
    from: range.fromIso,
    to: range.toIso ?? undefined,
    isFree: config.isFree,
  }

  const [events, total] = await Promise.all([
    listEvents({ ...filterArgs, limit: 24, offset: 0 }),
    countEvents(filterArgs),
  ])

  const qs = new URLSearchParams()
  if (config.when) qs.set('when', config.when)
  ;(config.categories ?? []).forEach(c => qs.append('category', c))
  if (config.isFree) qs.set('isFree', 'true')

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-white/95 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <Link href={`/${city.slug}`} className="text-sm text-violet-600 hover:underline">← All {city.name} events</Link>
        </div>
      </header>
      <div className="max-w-7xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-1">{config.title} in {city.name}</h1>
        <p className="text-sm text-muted-foreground mb-6">{config.description(city.name)}</p>
        <Suspense>
          <EventList
            initialEvents={events as unknown as EnrichedEvent[]}
            query={qs.toString()}
            total={total}
            basePath={`/${city.slug}`}
          />
        </Suspense>
      </div>
    </div>
  )
}
