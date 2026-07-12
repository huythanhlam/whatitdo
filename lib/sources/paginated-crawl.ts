import { extractEventsFromPages, type CrawlPage } from '@/lib/extractor'
import { mapPool } from '@/lib/gemini'
import { getSourceContentHash, setSourceContentHash } from '@/lib/db'
import { fetchPage } from './crawler'
import { hashPageText } from './content-hash'
import type { RawEvent, SourceRow } from './types'

// Multi-page variant of the config-driven `crawl` parser (see
// `fetchCrawlSource` in ./crawler.ts), for sources whose events are spread
// across a numbered `?page=N` pagination rather than fit on one page. Reuses
// `fetchPage()` unchanged, so it stays provider-agnostic (works with
// whichever BROWSER_FETCH_URL renderer is configured, not Firecrawl-specific)
// and gets its content-hash-skip behavior from the same `hashPageText()`
// mechanism, just applied to the combined text of every fetched page.

// Default page count when a source doesn't override it via `max_pages`.
// Chronicle's Staff Pick view is 2 pages TOTAL — this default is complete
// coverage there, not a sample. Sources with far more pages (e.g. a full
// events calendar) should set `max_pages` explicitly rather than inherit
// this and silently only cover a small slice.
const DEFAULT_MAX_PAGES = 2
const FETCH_CONCURRENCY = 3

// Page 1 is the URL unchanged; pages 2..maxPages set/replace a `page` query
// param on it. Pure (no network) so it's unit-testable.
export function buildPageUrls(baseUrl: string, maxPages: number): string[] {
  const urls = [baseUrl]
  for (let page = 2; page <= maxPages; page++) {
    try {
      const u = new URL(baseUrl)
      u.searchParams.set('page', String(page))
      urls.push(u.toString())
    } catch {
      break // malformed baseUrl — just return what we already have
    }
  }
  return urls
}

// Drop null fetches and any page whose text duplicates an earlier (lower-
// numbered) page's — handles a site clamping an out-of-range page number
// back to page 1 or its last page, so that content isn't extracted twice.
export function dedupePages(pages: (CrawlPage | null)[]): CrawlPage[] {
  const out: CrawlPage[] = []
  const seenHashes = new Set<string>()
  for (const page of pages) {
    if (!page) continue
    const hash = hashPageText(page.text)
    if (seenHashes.has(hash)) continue
    seenHashes.add(hash)
    out.push(page)
  }
  return out
}

export async function fetchPaginatedCrawlSource(
  source: SourceRow
): Promise<{ events: RawEvent[]; skipped: boolean }> {
  if (!source.url) return { events: [], skipped: false }

  const urls = buildPageUrls(source.url, source.max_pages ?? DEFAULT_MAX_PAGES)
  const fetched = await mapPool(urls, FETCH_CONCURRENCY, fetchPage)

  const page1 = fetched[0]
  if (!page1 || page1.text.length <= 80) return { events: [], skipped: false }

  const pages = dedupePages(fetched)

  // Combine surviving pages' text, in page order, into one string so the
  // existing single-hash content_hash column can still gate re-extraction:
  // a change on any one page changes the combined hash.
  const combinedText = pages.map(p => p.text).join('\n\n')
  const hash = hashPageText(combinedText)
  const previous = await getSourceContentHash(source.id)
  if (previous && previous === hash) {
    return { events: [], skipped: true }
  }

  // Emit under the configured source name so provenance links to this row.
  const named: CrawlPage[] = pages.map(p => ({ ...p, source: source.name }))
  const events = await extractEventsFromPages(named)
  // Persist the new hash only after a successful extraction, so a transient
  // Gemini failure doesn't wrongly mark the pages "seen" and skip them next run.
  await setSourceContentHash(source.id, hash)
  return { events, skipped: false }
}
