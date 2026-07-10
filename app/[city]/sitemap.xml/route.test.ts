import { describe, it, expect } from 'vitest'
import type { MetadataRoute } from 'next'
import { serializeSitemap } from './route'

describe('serializeSitemap', () => {
  it('produces well-formed XML with one <url> block per entry, in field order', () => {
    const entries: MetadataRoute.Sitemap = [
      {
        url: 'https://example.com/austin',
        lastModified: new Date('2026-07-01T12:00:00.000Z'),
        changeFrequency: 'hourly',
        priority: 1,
      },
      {
        url: 'https://example.com/austin/subscribe',
        changeFrequency: 'monthly',
        priority: 0.3,
      },
    ]

    const xml = serializeSitemap(entries)

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true)
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    )
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true)

    // First entry: all fields present, in <loc>/<lastmod>/<changefreq>/<priority> order.
    expect(xml).toContain(
      '<url>\n' +
        '<loc>https://example.com/austin</loc>\n' +
        '<lastmod>2026-07-01T12:00:00.000Z</lastmod>\n' +
        '<changefreq>hourly</changefreq>\n' +
        '<priority>1</priority>\n' +
        '</url>'
    )

    // Second entry: no lastModified, so <lastmod> must be omitted entirely.
    expect(xml).toContain(
      '<url>\n' +
        '<loc>https://example.com/austin/subscribe</loc>\n' +
        '<changefreq>monthly</changefreq>\n' +
        '<priority>0.3</priority>\n' +
        '</url>'
    )
    expect(xml).not.toMatch(/subscribe<\/loc>\n<lastmod>/)
  })

  it('omits <lastmod> when lastModified is undefined (mirrors events with no updated_at)', () => {
    const xml = serializeSitemap([{ url: 'https://example.com/x' }])
    expect(xml).not.toContain('<lastmod>')
    expect(xml).toContain('<loc>https://example.com/x</loc>')
  })

  it('includes <lastmod> when lastModified is a Date, serialized as ISO string', () => {
    const xml = serializeSitemap([
      { url: 'https://example.com/x', lastModified: new Date('2026-01-02T00:00:00.000Z') },
    ])
    expect(xml).toContain('<lastmod>2026-01-02T00:00:00.000Z</lastmod>')
  })

  it('produces a valid empty <urlset> for an empty array (unknown-city fallback)', () => {
    const xml = serializeSitemap([])
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        '</urlset>\n'
    )
  })
})
