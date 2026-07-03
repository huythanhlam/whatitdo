import * as cheerio from 'cheerio'
import type { RawEvent } from './types'

export async function fetchDo512Events(): Promise<RawEvent[]> {
  const results: RawEvent[] = []

  try {
    const res = await fetch('https://do512.com/events', {
      headers: { 'User-Agent': 'WhatItDo Events Bot/1.0 (contact: events@whatitdo.app)' },
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) return results

    const html = await res.text()
    const $ = cheerio.load(html)

    $('.ds-listing, [class*="event-listing"], [class*="EventListing"], article[class*="event"]').each((_, el) => {
      const $el = $(el)

      const title = $el.find('[class*="title"], [class*="Title"], h2, h3').first().text().trim()
      if (!title || title.length < 3) return

      const dateAttr = $el.find('time').first().attr('datetime')
      const dateText = dateAttr ?? $el.find('[class*="date"], [class*="Date"]').first().text().trim()
      const venueText = $el.find('[class*="venue"], [class*="Venue"], [class*="location"]').first().text().trim()
      const description = $el.find('[class*="description"], p').first().text().trim() || null
      const link = $el.find('a').first().attr('href') ?? ''
      const imgSrc = $el.find('img').first().attr('src') ?? null

      // Skip events whose date we can't actually parse — never fabricate a time
      // (an invented date is worse than an omitted event).
      const parsed = dateText ? new Date(dateText) : null
      if (!parsed || isNaN(parsed.getTime())) return
      const start_time = parsed.toISOString()

      const ticket_url = link.startsWith('http') ? link : `https://do512.com${link}`

      results.push({
        title,
        description,
        start_time,
        end_time: null,
        venue_name: venueText || null,
        venue_address: null,
        image_url: imgSrc,
        ticket_url: ticket_url || null,
        source: 'do512',
        source_id: ticket_url || `do512-${title.slice(0, 40)}`,
        is_free: false,
        price_min: null,
        price_max: null,
      })
    })
  } catch (e) {
    console.error('Do512 scraper error:', e)
  }

  return results
}
