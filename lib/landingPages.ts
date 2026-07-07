import type { WhenPreset } from './dateRanges'
import type { CategorySlug } from './categories'

// A programmatic SEO landing page: a canned filter combination over listEvents
// with its own copy. Adding coverage of a new organic-search query is one row
// here — no new route, no new component (PRODUCT-SPEC §4.2).
export type LandingFilters = {
  categories?: CategorySlug[]
  when?: WhenPreset
  isFree?: boolean
}

export type LandingPage = {
  slug: string        // URL + generateStaticParams key
  title: string       // <title>, <h1>
  description: string  // meta description + on-page intro
  filters: LandingFilters
}

export const LANDING_PAGES: LandingPage[] = [
  {
    slug: 'things-to-do-this-weekend',
    title: 'Things to Do in Austin This Weekend',
    description: 'The best events happening in Austin this weekend — concerts, markets, comedy, food, and more, updated daily.',
    filters: { when: 'weekend' },
  },
  {
    slug: 'free-things-to-do-this-weekend',
    title: 'Free Things to Do in Austin This Weekend',
    description: 'Every free event in Austin this weekend, in one place — live music, festivals, markets, and family fun that costs nothing.',
    filters: { when: 'weekend', isFree: true },
  },
  {
    slug: 'live-music-tonight',
    title: 'Live Music in Austin Tonight',
    description: 'Where to catch live music in Austin tonight — every show we can find, from dive bars to the big rooms.',
    filters: { categories: ['music'], when: 'today' },
  },
  {
    slug: 'live-music-this-weekend',
    title: 'Live Music in Austin This Weekend',
    description: 'Austin’s live music this weekend — gigs, concerts, and residencies across the city, updated daily.',
    filters: { categories: ['music'], when: 'weekend' },
  },
  {
    slug: 'family-friendly-events-this-weekend',
    title: 'Family-Friendly Things to Do in Austin This Weekend',
    description: 'Kid-friendly events in Austin this weekend — story times, markets, festivals, and outdoor fun for the whole family.',
    filters: { categories: ['family'], when: 'weekend' },
  },
  {
    slug: 'comedy-shows-this-week',
    title: 'Comedy Shows in Austin This Week',
    description: 'Stand-up, improv, and open mics in Austin this week — every comedy show we can find.',
    filters: { categories: ['comedy'], when: 'week' },
  },
  {
    slug: 'free-events-this-week',
    title: 'Free Events in Austin This Week',
    description: 'Everything free happening in Austin this week — no ticket required.',
    filters: { isFree: true, when: 'week' },
  },
  {
    slug: 'food-and-drink-events-this-weekend',
    title: 'Food & Drink Events in Austin This Weekend',
    description: 'Tastings, pop-ups, markets, and food festivals in Austin this weekend.',
    filters: { categories: ['food-drink'], when: 'weekend' },
  },
]

export function getLandingPage(slug: string): LandingPage | undefined {
  return LANDING_PAGES.find(p => p.slug === slug)
}
