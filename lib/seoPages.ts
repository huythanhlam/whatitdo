// Canned filter combinations over the existing listEvents/countEvents,
// statically generated per city — the "config array, no new code" SEO play
// from PRODUCT-SPEC §4.
export type SeoPageConfig = {
  slug: string
  title: string
  description: (cityName: string) => string
  when?: 'today' | 'weekend'
  categories?: string[]
  isFree?: boolean
}

export const SEO_PAGES: SeoPageConfig[] = [
  {
    slug: 'this-weekend',
    title: 'This Weekend',
    description: city => `Everything happening in ${city} this weekend — concerts, markets, festivals, and more.`,
    when: 'weekend',
  },
  {
    slug: 'live-music-tonight',
    title: 'Live Music Tonight',
    description: city => `Tonight's live music lineup in ${city}, updated daily.`,
    when: 'today',
    categories: ['music'],
  },
  {
    slug: 'family',
    title: 'Family Events',
    description: city => `Family-friendly things to do in ${city} — museums, story times, festivals, and more.`,
    categories: ['family'],
  },
  {
    slug: 'free-things-to-do-this-weekend',
    title: 'Free Things To Do This Weekend',
    description: city => `Free events in ${city} this weekend — no ticket required.`,
    when: 'weekend',
    isFree: true,
  },
]

export function getSeoPage(slug: string): SeoPageConfig | undefined {
  return SEO_PAGES.find(p => p.slug === slug)
}
