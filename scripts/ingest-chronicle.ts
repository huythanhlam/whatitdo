// End-to-end ingest of the Austin Chronicle *Staff Pick* calendar through the
// app's real pipeline: crawl the paginated Staff Pick view (obtain) →
// buildEventsFromPage (the app's own validator) → persistEvents (dedupe, tag,
// geocode, insert). Proves the configured source
//   crawl:calendar-austinchronicle-com
//   → https://calendar.austinchronicle.com/austin/EventSearch?feature=Staff+Pick&sortType=date&v=g
//   → parser 'crawl-paginated'
// actually lands Staff Pick events in the application.
//
//   npx tsx scripts/ingest-chronicle.ts
//
// With no DATABASE_URL it targets the embedded PGlite (seeded with the baseline
// Austin events), exactly like `npm run dev`; set DATABASE_URL to ingest into a
// real Postgres instead. It persists twice so the second pass demonstrates the
// dedup: a re-ingest of the same events inserts nothing.
//
// WHY FIRECRAWL HERE: calendar.austinchronicle.com sits behind a Cloudflare JS
// challenge (a plain server fetch 403s), and the events are prose in the page
// (dates like "Sun., Aug. 30, 3-9 p.m."), not machine-readable markup. The
// production parser handles both with BROWSER_FETCH_URL (headless render) +
// GEMINI_API_KEY (prose → structured events). When those two secrets are set,
// the daily /api/ingest cron does this automatically and this script isn't
// needed. Locally, with neither secret configured, this script substitutes the
// authenticated Firecrawl CLI for BOTH roles — it renders past Cloudflare and
// returns the same structured event fields the app's Gemini prompt asks for —
// then hands the result to the app's REAL buildEventsFromPage + persistEvents
// so the validation, dedup, tagging, geocoding and insert are all exercised
// exactly as in production. The only thing swapped is the LLM provider behind
// the extraction call.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildEventsFromPage, dedupeEvents, type CrawlPage } from '@/lib/extractor'
import { buildPageUrls } from '@/lib/sources/paginated-crawl'
import { persistEvents } from '@/lib/persist'
import { isLocal } from '@/lib/db'
import { getPgliteDb } from '@/lib/db/pglite'
import { getPgDb } from '@/lib/db/pg'
import type { Db } from '@/lib/db/driver'
import type { ExtractedEvent } from '@/lib/extractor'

const SOURCE = 'crawl:calendar-austinchronicle-com'
const CITY_ID = 1 // Austin

async function db(): Promise<Db> {
  return isLocal() ? getPgliteDb() : getPgDb()
}

type SourceRow = {
  id: number
  name: string
  url: string | null
  parser: string
  cadence: string
  enabled: boolean
  max_pages: number | null
}

async function loadSource(): Promise<SourceRow> {
  const rows = await (await db()).query<SourceRow>(
    `SELECT id, name, url, parser, cadence, enabled, max_pages FROM sources WHERE name = $1`,
    [SOURCE],
  )
  if (!rows[0]) {
    console.error(`  Source ${SOURCE} not found in the DB — migrations 019/020 should have inserted it.`)
    process.exit(1)
  }
  return rows[0]
}

async function countFromSource(): Promise<number> {
  const rows = await (await db()).query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM events WHERE source = $1`,
    [SOURCE],
  )
  return parseInt(rows[0]?.count ?? '0', 10)
}

// The app's Gemini prompt (lib/extractor.ts) pins a REFERENCE DATE so the model
// resolves "Sat., July 26" to the right YEAR. Firecrawl's schema extractor has
// no such anchor, so bake today's date into the field descriptions — otherwise
// it guesses a past year and every event gets dropped by buildEvent's past-date
// guard. Mirrors the production prompt's date-resolution rules.
function schemaJson(nowIso: string): string {
  const today = nowIso.slice(0, 10)
  return JSON.stringify({
    type: 'object',
    properties: {
      events: {
        type: 'array',
        description:
          'Every specific, upcoming, dated real-world event on this Austin Chronicle Staff Pick calendar page (concerts, festivals, shows, screenings, readings, markets, games, etc.).',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'The specific event / performer / act name' },
            description: { type: 'string', description: 'One-sentence blurb' },
            url: { type: 'string', description: "The event's own calendar.austinchronicle.com detail-page link" },
            start_time: {
              type: 'string',
              description: `ISO 8601 with America/Chicago offset. TODAY is ${today}; this calendar is sorted ascending from today, so every event is on or after ${today} — never output an earlier year. If only a date is known, use 19:00 local.`,
            },
            end_time: { type: 'string', description: 'ISO 8601 or omit' },
            venue_name: { type: 'string' },
            venue_address: { type: 'string' },
            is_free: { type: 'boolean' },
            price_min: { type: 'number' },
            price_max: { type: 'number' },
          },
          required: ['title', 'start_time'],
        },
      },
    },
    required: ['events'],
  })
}

// Render + extract ONE page URL through the authenticated Firecrawl CLI,
// returning the app's ExtractedEvent shape. Throws on CLI/parse failure so a
// dead page surfaces loudly rather than silently yielding zero events.
function firecrawlExtract(url: string, schemaPath: string, workDir: string): ExtractedEvent[] {
  const outPath = join(workDir, `out-${Buffer.from(url).toString('hex').slice(0, 12)}.json`)
  execFileSync(
    'firecrawl',
    ['scrape', url, '--format', 'json', '--schema-file', schemaPath, '-o', outPath],
    { stdio: ['ignore', 'ignore', 'inherit'], timeout: 120_000 },
  )
  const parsed = JSON.parse(readFileSync(outPath, 'utf8')) as { json?: { events?: ExtractedEvent[] } }
  return parsed.json?.events ?? []
}

async function main() {
  console.log(`Mode: ${isLocal() ? 'local (PGlite, seeded)' : 'Postgres (DATABASE_URL)'}`)

  const src = await loadSource()
  console.log(`\n[1/5] Source row (from the DB — proves migrations 019/020 wired it):`)
  console.log(`  name=${src.name}  enabled=${src.enabled}  parser=${src.parser}  cadence=${src.cadence}  max_pages=${src.max_pages ?? '(default)'}`)
  console.log(`  url=${src.url}`)
  if (!src.url) {
    console.error('  Source has no URL — aborting.')
    process.exit(1)
  }

  const nowIso = new Date().toISOString()
  const urls = buildPageUrls(src.url, src.max_pages ?? 2) // Staff Pick view is 2 pages TOTAL — complete coverage
  console.log(`\n[2/5] Crawling ${urls.length} Staff Pick page(s) via Firecrawl (renders past Cloudflare)...`)

  const workDir = mkdtempSync(join(tmpdir(), 'chronicle-'))
  const schemaPath = join(workDir, 'schema.json')
  writeFileSync(schemaPath, schemaJson(nowIso))

  let events
  try {
    const perPage = urls.map((url, i) => {
      const extracted = firecrawlExtract(url, schemaPath, workDir)
      console.log(`  page ${i + 1}: extracted ${extracted.length} raw event objects`)
      // Emit under the configured source name so provenance links to this row,
      // exactly like the production parser (paginated-crawl.ts) does.
      const page: CrawlPage = { source: SOURCE, url, title: 'Austin Chronicle Staff Picks', image_url: null, text: '' }
      return buildEventsFromPage(page, extracted, nowIso)
    })
    events = dedupeEvents(perPage.flat())
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }

  console.log(`\n[3/5] Validated ${events.length} events (app's buildEvent: real, dated, non-past, within 270 days).`)
  if (events.length === 0) {
    console.error('  No events survived validation — aborting.')
    process.exit(1)
  }
  const withVenue = events.filter(e => e.venue_name).length
  const free = events.filter(e => e.is_free).length
  console.log(`  ${withVenue}/${events.length} have a venue, ${free} are free.`)
  console.log('  Sample:')
  for (const e of events.slice(0, 6)) {
    console.log(`    • ${e.start_time.slice(0, 16).replace('T', ' ')}Z  ${e.title}  @ ${e.venue_name ?? '—'}`)
  }

  const before = await countFromSource()

  // persistEvents' `inserted` counts events successfully processed (created OR
  // merged into an existing canonical event), so the authoritative proof of
  // dedup is the actual row count in the DB before/after each pass.
  console.log(`\n[4/5] Persisting (dedupe + tag + geocode + insert) into the application...`)
  const first = await persistEvents(events, { cityId: CITY_ID, status: 'approved' })
  const afterFirst = await countFromSource()
  console.log(`  persist result: ${JSON.stringify(first)}`)
  console.log(`  new canonical rows: ${afterFirst - before} (from ${events.length} obtained → ${events.length - (afterFirst - before)} collapsed by title+venue dedup)`)

  console.log(`\n  Re-persisting the SAME events to demonstrate idempotent dedup...`)
  const second = await persistEvents(events, { cityId: CITY_ID, status: 'approved' })
  const afterSecond = await countFromSource()
  const grew = afterSecond - afterFirst
  console.log(`  persist result: ${JSON.stringify(second)}`)
  console.log(
    grew === 0
      ? `  ✓ Re-ingest added 0 new rows (count steady at ${afterSecond}) — dedup holds.`
      : `  ✗ Re-ingest added ${grew} rows — expected 0.`,
  )

  console.log(`\n[5/5] Verification (from the DB)`)
  console.log(`  events with source=${SOURCE}: ${before} → ${afterFirst} → ${afterSecond}`)
  const sample = await (await db()).query<{ title: string; start_time: string; venue_name: string | null; is_free: boolean }>(
    `SELECT title, start_time, venue_name, is_free FROM events WHERE source = $1 ORDER BY start_time LIMIT 10`,
    [SOURCE],
  )
  console.log('  Persisted sample:')
  for (const r of sample) {
    console.log(`    • ${new Date(r.start_time).toISOString().slice(0, 16).replace('T', ' ')}Z  ${r.title}  @ ${r.venue_name ?? '—'}${r.is_free ? '  (free)' : ''}`)
  }

  process.exit(0)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
