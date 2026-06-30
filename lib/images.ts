import type { CategorySlug } from './categories'

// Curated, stable stock images per category. Used as a fallback so every event
// card has an attractive, on-theme image even when its source supplies none.
// Unsplash CDN URLs with fixed crop/size params — deterministic and free.
const IMG = (id: string) => `https://images.unsplash.com/photo-${id}?w=800&h=440&fit=crop&q=80`

export const CATEGORY_IMAGES: Record<CategorySlug, string> = {
  music:       IMG('1470229722913-7c0e2dbbafd3'), // concert crowd + stage lights
  comedy:      IMG('1585699324551-f6c309eedeca'), // microphone on stage
  'food-drink':IMG('1414235077428-338989a2e8c0'), // restaurant table spread
  arts:        IMG('1460661419201-fd4cecdf8a8b'), // art gallery interior
  sports:      IMG('1461896836934-ffe607ba8211'), // stadium crowd
  family:      IMG('1530103862676-de8c9debad1d'), // family outdoors fun
  festivals:   IMG('1533174072545-7a4b6ad7a6c3'), // festival crowd daytime
  film:        IMG('1489599849927-2ee91cede3ba'), // cinema seats / screen
  outdoors:    IMG('1551632811-561732d1e306'),   // hiking trail nature
  networking:  IMG('1556761175-5973dc0f32e7'),   // people networking event
  other:       IMG('1492684223066-81342ee5ff30'), // generic event crowd
}

// Pick an image for an event from its tagged categories, defaulting to `other`.
export function imageForCategories(slugs: CategorySlug[]): string {
  for (const slug of slugs) {
    if (CATEGORY_IMAGES[slug]) return CATEGORY_IMAGES[slug]
  }
  return CATEGORY_IMAGES.other
}
