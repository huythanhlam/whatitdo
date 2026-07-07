import { NextRequest, NextResponse } from 'next/server'
import { pageFromHtml } from '@/lib/sources/crawler'
import { extractEventsFromPages, type CrawlPage } from '@/lib/extractor'
import { persistEvents } from '@/lib/persist'
import { safeFetchHtml, SsrfError } from '@/lib/ssrf'

export const maxDuration = 120

// Public event submission (PRODUCT-SPEC §4.5). Anyone can submit an event by URL
// or pasted text; it runs the same extraction as /api/import but lands the events
// as `status = 'pending'` (invisible to the site) for admin approval.
//
// Unauthenticated by design, but bounded: SSRF guards on URLs (safeFetchHtml),
// a pasted-text length cap, a honeypot field, and the global Gemini daily budget.
// Heavy-duty bot defense (Vercel BotID / WAF rate limiting) is the production
// hardening layer and is configured at the platform, not here.
const MAX_TEXT = 8000

export async function POST(req: NextRequest) {
  let body: { url?: unknown; text?: unknown; website?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON with a "url" or "text" field' }, { status: 400 })
  }

  // Honeypot: real users never fill a hidden "website" field; bots do. Silently
  // accept (200) so scrapers get no signal, but do nothing.
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return NextResponse.json({ received: 0 })
  }

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_TEXT) : ''

  let page: CrawlPage | null = null
  if (url) {
    try {
      const html = await safeFetchHtml(url)
      page = pageFromHtml(html, url)
    } catch (e) {
      if (e instanceof SsrfError) {
        return NextResponse.json({ error: `Cannot fetch that URL: ${e.message}` }, { status: 400 })
      }
      return NextResponse.json(
        { error: 'Could not read that URL. Paste the event details instead.' },
        { status: 422 }
      )
    }
    if (page.text.length < 40) {
      return NextResponse.json(
        { error: 'Could not read that URL. Paste the event details instead.' },
        { status: 422 }
      )
    }
    page.source = 'submission'
  } else if (text) {
    page = { source: 'submission', url: '', title: null, image_url: null, text }
  } else {
    return NextResponse.json({ error: 'Provide a "url" or "text" field' }, { status: 400 })
  }

  const events = await extractEventsFromPages([page])
  if (events.length === 0) {
    return NextResponse.json({
      received: 0,
      note: process.env.GEMINI_API_KEY
        ? 'We could not find a specific upcoming event in that. Try pasting the date, time, and venue.'
        : 'Submissions are temporarily unavailable.',
    })
  }

  // Land as pending for moderation. Events with source 'submission' get NULL
  // source_id in provenance (no sources row) — expected.
  const { inserted } = await persistEvents(events, { status: 'pending' })
  return NextResponse.json({
    received: inserted,
    message: 'Thanks! Your event was submitted and will appear after a quick review.',
  })
}
