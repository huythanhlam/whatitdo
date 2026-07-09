import { pageFromHtml } from '@/lib/sources/crawler'
import { extractEventsFromPages, type CrawlPage } from '@/lib/extractor'
import { persistEvents, type EventStatus } from '@/lib/persist'
import { safeFetchHtml, SsrfError } from '@/lib/ssrf'

// Thrown for any user-facing input problem (bad URL, unreadable page, missing
// url/text) so route handlers can turn it into the right HTTP status without
// duplicating the message text.
export class InputError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// Resolve either a URL or pasted text into a CrawlPage, the shared input to
// extraction. `sourceOverride` tags the resulting page's `source` field (used
// by /api/submissions to mark every public submission as 'submission',
// regardless of whether it arrived as a URL or pasted text); omitted for
// /api/import, which keeps its existing crawl:<host>/'import' source naming.
export async function resolvePage(url: string, text: string, sourceOverride?: string): Promise<CrawlPage> {
  if (url) {
    let html: string
    try {
      html = await safeFetchHtml(url)
    } catch (e) {
      if (e instanceof SsrfError) throw new InputError(`Cannot fetch that URL: ${e.message}`, 400)
      throw new InputError('Could not read that URL (it may require login or returned no content). Paste the post text instead.', 422)
    }
    const page = pageFromHtml(html, url)
    if (page.text.length < 40) {
      throw new InputError('Could not read that URL (it may require login or returned no content). Paste the post text instead.', 422)
    }
    return sourceOverride ? { ...page, source: sourceOverride } : page
  }
  if (text) {
    return { source: sourceOverride ?? 'import', url: '', title: null, image_url: null, text }
  }
  throw new InputError('Provide a "url" or "text" field', 400)
}

export async function extractAndPersist(
  page: CrawlPage,
  opts: { cityId: number; status: EventStatus }
): Promise<{ inserted: number; skipped: number; total: number; events: { title: string; start_time: string; venue_name: string | null; ticket_url: string | null }[] }> {
  const events = await extractEventsFromPages([page])
  if (events.length === 0) return { inserted: 0, skipped: 0, total: 0, events: [] }

  const { inserted, skipped, total } = await persistEvents(events, opts)
  return {
    inserted, skipped, total,
    events: events.map(e => ({ title: e.title, start_time: e.start_time, venue_name: e.venue_name, ticket_url: e.ticket_url })),
  }
}
