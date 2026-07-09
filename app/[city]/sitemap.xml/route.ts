import type { MetadataRoute } from 'next'
import { listEvents, getEnabledCities } from '@/lib/db'
import { getBaseUrl } from '@/lib/site'

// NOTE: this is deliberately a plain Route Handler rather than the
// `sitemap.ts` metadata-file convention. In the installed Next.js version
// (16.2.9), the metadata-route loader calls a `sitemap.ts` default export
// with zero arguments (see
// node_modules/next/dist/build/webpack/loaders/next-metadata-route-loader.js,
// getSingleSitemapRouteCode/getDynamicSitemapRouteCode) — it never forwards
// the enclosing route's dynamic segment params (unlike opengraph-image/icon
// routes, which do receive `{ params }`). A `sitemap.ts` placed under
// `app/[city]/` therefore cannot learn which city it's being generated for.
// A regular `route.ts` under the same `[city]` folder does get `{ params }`
// like any other Route Handler, so we hand-roll the small bit of sitemap XML
// serialization that the metadata convention would otherwise do for us.
export const revalidate = 3600

export async function generateStaticParams() {
  const cities = await getEnabledCities()
  return cities.map(c => ({ city: c.slug }))
}

// Supports url/lastModified/changeFrequency/priority only — alternates/images/videos
// from MetadataRoute.Sitemap are NOT implemented and will silently be dropped if used.
export function serializeSitemap(entries: MetadataRoute.Sitemap): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  for (const entry of entries) {
    xml += '<url>\n'
    xml += `<loc>${entry.url}</loc>\n`
    if (entry.lastModified) {
      const serialized =
        entry.lastModified instanceof Date
          ? entry.lastModified.toISOString()
          : entry.lastModified
      xml += `<lastmod>${serialized}</lastmod>\n`
    }
    if (entry.changeFrequency) {
      xml += `<changefreq>${entry.changeFrequency}</changefreq>\n`
    }
    if (typeof entry.priority === 'number') {
      xml += `<priority>${entry.priority}</priority>\n`
    }
    xml += '</url>\n'
  }
  xml += '</urlset>\n'
  return xml
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ city: string }> }
): Promise<Response> {
  const { city: citySlug } = await params
  const base = getBaseUrl()

  const cities = await getEnabledCities()
  const city = cities.find(c => c.slug === citySlug)

  let entries: MetadataRoute.Sitemap = []
  if (city) {
    let events: Awaited<ReturnType<typeof listEvents>> = []
    try {
      events = await listEvents({ cityId: city.id, limit: 1000, offset: 0 })
    } catch {
      events = []
    }

    const eventUrls: MetadataRoute.Sitemap = events.map(e => {
      const updated = e.updated_at ? new Date(e.updated_at as string) : null
      return {
        url: `${base}/${citySlug}/events/${e.id}`,
        lastModified:
          updated && !Number.isNaN(updated.getTime()) ? updated : undefined,
        changeFrequency: 'daily',
        priority: 0.7,
      }
    })

    entries = [
      { url: `${base}/${citySlug}`, changeFrequency: 'hourly', priority: 1 },
      {
        url: `${base}/${citySlug}/subscribe`,
        changeFrequency: 'monthly',
        priority: 0.3,
      },
      ...eventUrls,
    ]
  }

  return new Response(serializeSitemap(entries), {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control':
        process.env.NODE_ENV !== 'production'
          ? 'no-cache, no-store'
          : 'public, max-age=0, must-revalidate',
    },
  })
}
