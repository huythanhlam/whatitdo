import * as cheerio from 'cheerio'
import type { RawEvent } from './types'

export async function fetchAustinChronicleEvents(): Promise<RawEvent[]> {
  const results: RawEvent[] = []

  try {
    const res = await fetch('https://www.austinchronicle.com/events/', {
      headers: { 'User-Agent': 'WhatItDo Events Bot/1.0 (contact: events@whatitdo.app)' },
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) return results

    const html = await res.text()
    const $ = cheerio.load(html)

    $('article, .event-listing, .calendar-event, [class*="EventListing"], [class*="event-item"]').each((_, el) => {
      const $el = $(el)

      const title = $el.find('h2, h3, h4, [class*="title"], [class*="Title"]').first().text().trim()
      if (!title || title.length < 3) return

      const dateText = $el.find('time, [class*="date"], [class*="Date"]').first().attr('datetime')
        ?? $el.find('time, [class*="date"], [class*="Date"]').first().text().trim()
      const venueText = $el.find('[class*="venue"], [class*="Venue"], [class*="location"]').first().text().trim()
      const description = $el.find('p, [class*="description"]').first().text().trim() || null
      const link = $el.find('a[href*="/event"], a[href*="/calendar"]').first().attr('href')
        ?? $el.find('a').first().attr('href') ?? ''
      const imgSrc = $el.find('img').first().attr('src') ?? null

      const parsed = dateText ? new Date(dateText) : null
      const start_time = parsed && !isNaN(parsed.getTime())
        ? parsed.toISOString()
        : new Date(Date.now() + 86400000).toISOString()

      const ticket_url = link.startsWith('http') ? link : `https://www.austinchronicle.com${link}`

      results.push({
        title,
        description,
        start_time,
        end_time: null,
        venue_name: venueText || null,
        venue_address: null,
        image_url: imgSrc,
        ticket_url: ticket_url || null,
        source: 'austin-chronicle',
        source_id: ticket_url || `chronicle-${title.slice(0, 40)}`,
        is_free: !!(description?.toLowerCase().includes('free') || title.toLowerCase().includes('free')),
        price_min: null,
        price_max: null,
      })
    })
  } catch (e) {
    console.error('Austin Chronicle scraper error:', e)
  }

  return results
}
