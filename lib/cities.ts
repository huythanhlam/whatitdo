import { notFound } from 'next/navigation'
import { getCityBySlug, type City } from '@/lib/db'

// Resolve a URL city slug to its row, or 404. Shared by every page and route
// nested under app/[city]/ so an unknown or disabled city slug behaves like
// any other missing resource instead of a raw DB null check per call site.
export async function requireCity(slug: string): Promise<City> {
  const city = await getCityBySlug(slug)
  if (!city || !city.enabled) notFound()
  return city
}
