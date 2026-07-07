import type { MetadataRoute } from 'next'
import { listEvents } from '@/lib/db'
import { getBaseUrl } from '@/lib/site'
import { LANDING_PAGES } from '@/lib/landingPages'

// Regenerate hourly; event content changes at most once a day.
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getBaseUrl()

  let events: Awaited<ReturnType<typeof listEvents>> = []
  try {
    events = await listEvents({ limit: 1000, offset: 0 })
  } catch {
    // A DB hiccup shouldn't 500 the sitemap — fall back to the static routes.
    events = []
  }

  const eventUrls: MetadataRoute.Sitemap = events.map(e => {
    const updated = e.updated_at ? new Date(e.updated_at as string) : null
    return {
      url: `${base}/events/${e.id}`,
      lastModified: updated && !Number.isNaN(updated.getTime()) ? updated : undefined,
      changeFrequency: 'daily',
      priority: 0.7,
    }
  })

  const landingUrls: MetadataRoute.Sitemap = LANDING_PAGES.map(p => ({
    url: `${base}/${p.slug}`,
    changeFrequency: 'daily',
    priority: 0.8,
  }))

  return [
    { url: base, changeFrequency: 'hourly', priority: 1 },
    ...landingUrls,
    { url: `${base}/subscribe`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${base}/submit`, changeFrequency: 'monthly', priority: 0.3 },
    ...eventUrls,
  ]
}
