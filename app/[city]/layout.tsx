import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { getEnabledCities } from '@/lib/db'
import { requireCity } from '@/lib/cities'

export async function generateStaticParams() {
  const cities = await getEnabledCities()
  return cities.map(c => ({ city: c.slug }))
}

// Per-city default <title>/description/OG so every page nested under
// app/[city]/ (unless it sets its own generateMetadata, like the event detail
// page) shows the right city name instead of the city-agnostic root default.
// Fills the "%s" slot in the root layout's title template.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>
}): Promise<Metadata> {
  const { city: citySlug } = await params
  const city = await requireCity(citySlug)

  const title = `${city.name} Events`
  const description = `Discover things to do in ${city.name}: concerts, festivals, comedy, food & drink, arts, and more — aggregated daily and searchable by date and category.`

  // The share badge has "ATX" baked into the artwork, so it's Austin-only.
  // Other cities fall back to no OG image until they get their own badge.
  const ogImages =
    citySlug === 'austin'
      ? [{ url: '/og-austin.png', width: 1200, height: 630, alt: 'Whats Happenin ATX' }]
      : undefined

  // openGraph/twitter are shallowly overwritten (not deep-merged) across nested
  // metadata exports, so siteName/locale/type from the root layout must be
  // repeated here or they'd be dropped for every page under app/[city]/.
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: 'Whats Happenin',
      locale: 'en_US',
      type: 'website',
      images: ogImages,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ogImages,
    },
  }
}

export default async function CityLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ city: string }>
}) {
  const { city } = await params
  await requireCity(city) // 404s an unknown/disabled city slug
  return children
}
