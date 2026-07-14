export const CATEGORIES = [
  { slug: 'music',       name: 'Music',       color: '#F17A7E' },
  { slug: 'comedy',      name: 'Comedy',      color: '#FFC94B' },
  { slug: 'food-drink',  name: 'Food & Drink',color: '#F9A66C' },
  { slug: 'arts',        name: 'Arts',        color: '#4A6163' },
  { slug: 'sports',      name: 'Sports',      color: '#B8454A' },
  { slug: 'family',      name: 'Family',      color: '#7C9092' },
  { slug: 'festivals',   name: 'Festivals',   color: '#8C4A5E' },
  { slug: 'film',        name: 'Film',        color: '#2A3B3C' },
  { slug: 'outdoors',    name: 'Outdoors',    color: '#7C9A4F' },
  { slug: 'networking',  name: 'Networking',  color: '#3E5A72' },
  { slug: 'other',       name: 'Other',       color: '#A98F66' },
] as const

export type CategorySlug = typeof CATEGORIES[number]['slug']
export const CATEGORY_SLUGS = CATEGORIES.map(c => c.slug) as unknown as CategorySlug[]

export function getCategoryBySlug(slug: string) {
  return CATEGORIES.find(c => c.slug === slug)
}
