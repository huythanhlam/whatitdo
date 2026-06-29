export const CATEGORIES = [
  { slug: 'music',       name: 'Music',       color: '#7c3aed' },
  { slug: 'comedy',      name: 'Comedy',      color: '#ea580c' },
  { slug: 'food-drink',  name: 'Food & Drink',color: '#16a34a' },
  { slug: 'arts',        name: 'Arts',        color: '#0284c7' },
  { slug: 'sports',      name: 'Sports',      color: '#dc2626' },
  { slug: 'family',      name: 'Family',      color: '#d97706' },
  { slug: 'festivals',   name: 'Festivals',   color: '#db2777' },
  { slug: 'film',        name: 'Film',        color: '#475569' },
  { slug: 'outdoors',    name: 'Outdoors',    color: '#15803d' },
  { slug: 'networking',  name: 'Networking',  color: '#6d28d9' },
  { slug: 'other',       name: 'Other',       color: '#71717a' },
] as const

export type CategorySlug = typeof CATEGORIES[number]['slug']
export const CATEGORY_SLUGS = CATEGORIES.map(c => c.slug) as unknown as CategorySlug[]

export function getCategoryBySlug(slug: string) {
  return CATEGORIES.find(c => c.slug === slug)
}
