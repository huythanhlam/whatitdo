export const CATEGORIES = [
  { slug: 'music',       name: 'Music',       color: '#C1502E' },
  { slug: 'comedy',      name: 'Comedy',      color: '#E8823C' },
  { slug: 'food-drink',  name: 'Food & Drink',color: '#7C8F63' },
  { slug: 'arts',        name: 'Arts',        color: '#2C5F9E' },
  { slug: 'sports',      name: 'Sports',      color: '#9C3B2E' },
  { slug: 'family',      name: 'Family',      color: '#2A9D96' },
  { slug: 'festivals',   name: 'Festivals',   color: '#8A3B57' },
  { slug: 'film',        name: 'Film',        color: '#573F2C' },
  { slug: 'outdoors',    name: 'Outdoors',    color: '#4F5B41' },
  { slug: 'networking',  name: 'Networking',  color: '#1C3D66' },
  { slug: 'other',       name: 'Other',       color: '#A98866' },
] as const

export type CategorySlug = typeof CATEGORIES[number]['slug']
export const CATEGORY_SLUGS = CATEGORIES.map(c => c.slug) as unknown as CategorySlug[]

export function getCategoryBySlug(slug: string) {
  return CATEGORIES.find(c => c.slug === slug)
}
