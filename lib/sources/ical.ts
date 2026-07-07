import type { RawEvent } from './types'

const ICAL_FEEDS = [
  { url: 'https://www.austintexas.gov/calendar/ical', source_prefix: 'austin-gov' },
]

function parseIcalDate(val: string): Date | null {
  // Handle TZID=...:20260628T120000 or 20260628T120000Z or 20260628
  const cleaned = val.includes(':') ? val.split(':').pop()! : val
  if (!cleaned) return null

  if (cleaned.length === 8) {
    // YYYYMMDD
    return new Date(`${cleaned.slice(0,4)}-${cleaned.slice(4,6)}-${cleaned.slice(6,8)}`)
  }
  if (cleaned.length >= 15) {
    // YYYYMMDDTHHmmss[Z]
    const dt = `${cleaned.slice(0,4)}-${cleaned.slice(4,6)}-${cleaned.slice(6,8)}T${cleaned.slice(9,11)}:${cleaned.slice(11,13)}:${cleaned.slice(13,15)}${cleaned.endsWith('Z') ? 'Z' : ''}`
    return new Date(dt)
  }
  return null
}

function parseIcalText(icalText: string): RawEvent[] {
  const results: RawEvent[] = []
  // Split into VEVENT blocks
  const eventBlocks = icalText.split('BEGIN:VEVENT').slice(1)

  for (const block of eventBlocks) {
    const end = block.indexOf('END:VEVENT')
    const content = block.slice(0, end)

    // Unfold lines (RFC 5545: continuation lines start with space/tab)
    const unfolded = content.replace(/\r?\n[ \t]/g, '')
    const lines = unfolded.split(/\r?\n/)

    const props: Record<string, string> = {}
    for (const line of lines) {
      const sep = line.indexOf(':')
      if (sep < 0) continue
      const key = line.slice(0, sep).split(';')[0].trim().toUpperCase()
      const value = line.slice(sep + 1).trim()
      if (key && value && !props[key]) props[key] = value
    }

    const startDate = props['DTSTART'] ? parseIcalDate(props['DTSTART']) : null
    const endDate = props['DTEND'] ? parseIcalDate(props['DTEND']) : null
    const uid = props['UID'] ?? `ical-${Math.random()}`

    if (!startDate || isNaN(startDate.getTime())) continue
    if (startDate < new Date()) continue

    const title = (props['SUMMARY'] ?? 'Untitled').replace(/\\,/g, ',').replace(/\\n/g, ' ')
    const description = props['DESCRIPTION']
      ? props['DESCRIPTION'].replace(/\\,/g, ',').replace(/\\n/g, '\n')
      : null

    results.push({
      title,
      description,
      start_time: startDate.toISOString(),
      end_time: endDate ? endDate.toISOString() : null,
      venue_name: props['LOCATION'] ?? null,
      venue_address: props['LOCATION'] ?? null,
      image_url: null,
      ticket_url: props['URL'] ?? null,
      source: 'ical',
      source_id: uid,
      is_free: false,
      price_min: null,
      price_max: null,
    })
  }

  return results
}

// Fetch and parse ONE iCal feed, tagging every event with the given source name.
// Never throws — returns [] on any network/parse failure so one dead feed can't
// sink the run. This is the per-URL mechanism the config-driven `ical` parser
// dispatches to; each iCal feed is now a `sources` row rather than a code entry.
export async function fetchIcalUrl(url: string, source: string): Promise<RawEvent[]> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'WhatItDo Events Bot/1.0' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return []
    const text = await res.text()
    return parseIcalText(text).map(e => ({ ...e, source }))
  } catch (e) {
    console.error(`Failed to fetch iCal feed ${url}:`, e)
    return []
  }
}

// Back-compat aggregate over the built-in list. Retained for the dev path and
// any direct callers; the orchestrator now drives iCal via `sources` rows.
export async function fetchIcalEvents(): Promise<RawEvent[]> {
  const out: RawEvent[] = []
  for (const feed of ICAL_FEEDS) out.push(...(await fetchIcalUrl(feed.url, feed.source_prefix)))
  return out
}
