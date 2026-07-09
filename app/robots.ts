import type { MetadataRoute } from 'next'
import { getBaseUrl } from '@/lib/site'
import { getEnabledCities } from '@/lib/db'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = getBaseUrl()
  const cities = await getEnabledCities()
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/'],
    },
    sitemap: cities.map(c => `${base}/${c.slug}/sitemap.xml`),
    host: base,
  }
}
