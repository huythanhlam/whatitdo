import * as cheerio from 'cheerio'
import { extractEventsFromPages, type CrawlPage } from '@/lib/extractor'
import type { RawEvent, SourceRow } from './types'
import { hashPageText } from './content-hash'
import { getSourceContentHash, setSourceContentHash } from '@/lib/db'

// Generic page crawler for influencer posts and social-media aggregator pages
// that share events (link-in-bio pages, "things to do in Austin" roundups, etc.).
// Any publicly fetchable URL works: we strip the HTML to readable text and hand
// the whole page to the multi-event extractor, which pulls out every concrete
// upcoming event. Pages behind a login (Instagram/TikTok feeds) can't be fetched
// server-side — for those, paste the post URL or caption into POST /api/import.

function hostSlug(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-')
  } catch {
    return 'page'
  }
}

// Fetch a URL and reduce it to clean, readable text plus a title and lead image.
// Returns null on any failure (so one dead URL can't sink the crawl).
// A page yielding less readable text than this is treated as blocked or
// JS-rendered, triggering the browser-render fallback (when configured).
const MIN_PAGE_TEXT = 200

// Tier 1: fast, free, dependency-light fetch. Returns raw HTML or null.
async function lightFetch(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WhatItDo Events Bot/1.0; +https://whatitdo.app)',
        Accept: 'text/html,application/xhtml+xml,*/*',
      },
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.warn(`Crawl ${url} returned HTTP ${res.status}`)
      return null
    }
    return await res.text()
  } catch (e) {
    console.error(`Crawl fetch failed for ${url}:`, e)
    return null
  }
}

type Rendered = { html?: string; text?: string }

function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v
  return undefined
}

// Normalize the many shapes a browser-render service can return into HTML or
// text. Handles crawl4ai (`/md` → {markdown}, `/crawl` → {results:[{html,...}]}),
// Browserless/ScrapingBee-style {html}/{content}, and bare string bodies.
function pickRendered(data: unknown): Rendered | null {
  if (typeof data === 'string') return data.trim() ? { html: data } : null
  const root = data as Record<string, unknown>
  const results = root?.results
  const node = (Array.isArray(results) ? results[0] : Array.isArray(data) ? (data as unknown[])[0] : data) as
    | Record<string, unknown>
    | undefined
  if (!node || typeof node !== 'object') return null

  const html = firstString(node.cleaned_html, node.html, node.fit_html)
  if (html) return { html }

  const md = node.markdown as Record<string, unknown> | string | undefined
  const mdStr =
    typeof md === 'string' ? md : firstString(md?.fit_markdown, md?.raw_markdown, md?.markdown)
  const text = firstString(mdStr, node.text, node.content)
  return text ? { text } : null
}

// Tier 2: hand the URL to a headless-browser render service (crawl4ai,
// Browserless, ScrapingBee, a Vercel Sandbox worker — anything that accepts
// `POST {url}` and returns rendered HTML or markdown). Configured via
// BROWSER_FETCH_URL; a no-op (returns null) when unset. This is what defeats
// JS-render / Cloudflare-style blocks — provide a proxied service for IP blocks.
async function browserFetch(url: string): Promise<Rendered | null> {
  const endpoint = process.env.BROWSER_FETCH_URL
  if (!endpoint) return null
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, text/html, */*',
    }
    if (process.env.BROWSER_FETCH_TOKEN) headers.Authorization = `Bearer ${process.env.BROWSER_FETCH_TOKEN}`
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(45000),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.warn(`Browser render for ${url} returned HTTP ${res.status}`)
      return null
    }
    const ctype = res.headers.get('content-type') ?? ''
    if (!ctype.includes('json')) {
      const body = (await res.text()).trim()
      return body ? (body.includes('<') ? { html: body } : { text: body }) : null
    }
    return pickRendered(await res.json())
  } catch (e) {
    console.error(`Browser render failed for ${url}:`, e)
    return null
  }
}

// Two-tier fetch: try the light fetch first; if it's blocked or the page is too
// thin to be useful (JS-rendered SPA, bot wall), fall back to the browser-render
// service. Returns null only when both tiers come up empty.
export async function fetchPage(url: string): Promise<CrawlPage | null> {
  const html = await lightFetch(url)
  let page = html ? pageFromHtml(html, url) : null
  if (page && page.text.length >= MIN_PAGE_TEXT) return page

  const rendered = await browserFetch(url)
  if (rendered?.html) {
    const rp = pageFromHtml(rendered.html, url)
    if (!page || rp.text.length > page.text.length) page = rp
  } else if (rendered?.text) {
    const text = rendered.text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n').trim()
    if (text && (!page || text.length > page.text.length)) {
      page = { source: `crawl:${hostSlug(url)}`, url, title: page?.title ?? null, image_url: page?.image_url ?? null, text }
    }
  }

  return page
}

// Pure HTML → CrawlPage reduction (no network) so it can be unit-tested.
export function pageFromHtml(html: string, url: string): CrawlPage {
  const $ = cheerio.load(html)

  // Drop non-content noise before reading text.
  $('script, style, noscript, svg, iframe, nav, footer, header, form, aside').remove()

  const title =
    ($('meta[property="og:title"]').attr('content') || $('title').first().text() || '').trim() || null
  const image =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    null

  // Prefer the main content region when present; fall back to the body.
  const scope = $('main').length ? $('main') : $('body').length ? $('body') : $.root()
  const text = scope.text().replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n').trim()

  return {
    source: `crawl:${hostSlug(url)}`,
    url,
    title,
    image_url: image && /^https?:\/\//i.test(image) ? image : null,
    text,
  }
}

// Crawl ONE configured source (the config-driven `crawl` parser). Fetches
// source.url, and — the Phase 2B cost lever — computes a content hash of the
// readable text and skips the expensive Gemini extraction when the page is
// unchanged since the last successful crawl. Returns { events, skipped } so the
// orchestrator can record a budget-free 'skipped' run instead of a zero-event
// 'ok' one (PRODUCT-SPEC §6.1).
export async function fetchCrawlSource(
  source: SourceRow
): Promise<{ events: RawEvent[]; skipped: boolean }> {
  if (!source.url) return { events: [], skipped: false }

  const page = await fetchPage(source.url)
  if (!page || page.text.length <= 80) return { events: [], skipped: false }

  const hash = hashPageText(page.text)
  const previous = await getSourceContentHash(source.id)
  if (previous && previous === hash) {
    // Unchanged since last crawl — no new events possible, so don't spend Gemini.
    return { events: [], skipped: true }
  }

  // Emit under the configured source name so provenance links to this row.
  const named: CrawlPage = { ...page, source: source.name }
  const events = await extractEventsFromPages([named])
  // Persist the new hash only after a successful extraction, so a transient
  // Gemini failure doesn't wrongly mark the page "seen" and skip it next run.
  await setSourceContentHash(source.id, hash)
  return { events, skipped: false }
}
