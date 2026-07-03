import { NextRequest, NextResponse } from 'next/server'
import { pageFromHtml } from '@/lib/scrapers/crawler'
import { extractEventsFromPages, type CrawlPage } from '@/lib/extractor'
import { persistEvents } from '@/lib/persist'
import { isLocal } from '@/lib/db'
import { requireCronAuth } from '@/lib/auth'
import { safeFetchHtml, SsrfError } from '@/lib/ssrf'

export const maxDuration = 120

// On-demand import for a single influencer post or aggregator page.
//
//   POST /api/import { "url": "https://..." }   → crawl that page, import events
//   POST /api/import { "text": "caption..." }   → extract from pasted text
//   GET  /api/import?url=https://...            → convenience for manual testing
//
// The pasted-text path is the bridge around login-walled platforms: copy an
// Instagram/TikTok caption (or any post text) and import the events from it,
// since those feeds can't be fetched server-side.

async function runImport(url: string, text: string): Promise<NextResponse> {
  let page: CrawlPage | null = null

  if (url) {
    // User-supplied URL: fetch with SSRF protection (no internal addresses,
    // redirects validated per-hop, size/time capped). No browser-render
    // fallback here — for JS-walled pages, paste the post text instead.
    let html: string
    try {
      html = await safeFetchHtml(url)
    } catch (e) {
      if (e instanceof SsrfError) {
        return NextResponse.json({ error: `Cannot fetch that URL: ${e.message}` }, { status: 400 })
      }
      return NextResponse.json(
        { error: 'Could not read that URL (it may require login or returned no content). Paste the post text instead.' },
        { status: 422 }
      )
    }
    page = pageFromHtml(html, url)
    if (page.text.length < 40) {
      return NextResponse.json(
        { error: 'Could not read that URL (it may require login or returned no content). Paste the post text instead.' },
        { status: 422 }
      )
    }
  } else if (text) {
    // Treat pasted text as a page with no fetchable URL.
    page = { source: 'import', url: '', title: null, image_url: null, text }
  } else {
    return NextResponse.json({ error: 'Provide a "url" or "text" field' }, { status: 400 })
  }

  const events = await extractEventsFromPages([page])
  if (events.length === 0) {
    return NextResponse.json({
      inserted: 0,
      skipped: 0,
      total: 0,
      events: [],
      note: process.env.GEMINI_API_KEY
        ? 'No specific upcoming events were found in that content.'
        : 'GEMINI_API_KEY is not configured, so events cannot be extracted from free text.',
      mode: isLocal() ? 'local' : 'supabase',
    })
  }

  const { inserted, skipped, total } = await persistEvents(events)

  return NextResponse.json({
    inserted,
    skipped,
    total,
    events: events.map(e => ({
      title: e.title,
      start_time: e.start_time,
      venue_name: e.venue_name,
      ticket_url: e.ticket_url,
    })),
    mode: isLocal() ? 'local' : 'supabase',
  })
}

export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  let body: { url?: unknown; text?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON with a "url" or "text" field' }, { status: 400 })
  }

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  return runImport(url, text)
}

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied
  const url = req.nextUrl.searchParams.get('url')?.trim() ?? ''
  if (!url) {
    return NextResponse.json({ usage: 'POST { url } or { text }; or GET ?url=https://...' })
  }
  return runImport(url, '')
}
