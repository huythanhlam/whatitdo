import { NextRequest, NextResponse } from 'next/server'
import { SOURCES } from '@/lib/sources/registry'
import type { SourceAdapter, SourceContext } from '@/lib/sources/types'
import { persistEvents } from '@/lib/persist'
import { isLocal, startSourceRun, finishSourceRun } from '@/lib/db'
import { requireCronAuth } from '@/lib/auth'

export const maxDuration = 300

// Sources that spend Gemini tokens (crawl/RSS extraction). Used only for the
// rough per-run gemini_requests estimate below; PR3's single Gemini client will
// replace this with an exact per-source count from the budget counter.
const GEMINI_KINDS = new Set(['crawl', 'rss'])
function geminiEstimate(source: SourceAdapter, found: number): number {
  if (!process.env.GEMINI_API_KEY) return 0
  const usesGemini = GEMINI_KINDS.has(source.kind) || source.name === 'youtube'
  return usesGemini ? Math.ceil(found / 25) : 0
}

function contextFor(source: SourceAdapter): SourceContext {
  return {
    city: 'austin',
    since: new Date(),
    logger: {
      log: (...a) => console.log(`[${source.name}]`, ...a),
      warn: (...a) => console.warn(`[${source.name}]`, ...a),
      error: (...a) => console.error(`[${source.name}]`, ...a),
    },
  }
}

// Run one source end to end, wrapped in a source_runs record so a dead source
// shows up as `error`/zero-events rather than silently contributing nothing.
async function runSource(source: SourceAdapter): Promise<{ upserted: number; found: number; rejected: number }> {
  if (!source.enabled()) {
    const id = await startSourceRun(source.name)
    await finishSourceRun(id, { status: 'skipped' })
    return { upserted: 0, found: 0, rejected: 0 }
  }

  const id = await startSourceRun(source.name)
  try {
    const events = await source.fetch(contextFor(source))
    const { inserted, rejected, total } = await persistEvents(events)
    await finishSourceRun(id, {
      status: 'ok',
      events_found: total,
      events_upserted: inserted,
      events_rejected: rejected,
      gemini_requests: geminiEstimate(source, total),
    })
    return { upserted: inserted, found: total, rejected }
  } catch (e) {
    console.error(`Source ${source.name} failed:`, e)
    await finishSourceRun(id, { status: 'error', error: (e as Error).message?.slice(0, 500) ?? 'unknown' })
    return { upserted: 0, found: 0, rejected: 0 }
  }
}

async function runIngest() {
  // Sources run concurrently, but each owns its own run record + persistence, so
  // per-source counts land in source_runs even when one source throws.
  const results = await Promise.all(
    SOURCES.map(async source => ({ name: source.name, ...(await runSource(source)) }))
  )

  const bySource: Record<string, number> = {}
  let inserted = 0
  let found = 0
  let rejected = 0
  for (const r of results) {
    bySource[r.name] = r.upserted
    inserted += r.upserted
    found += r.found
    rejected += r.rejected
  }

  return NextResponse.json({
    inserted, rejected, total: found,
    bySource, mode: isLocal() ? 'local' : 'supabase',
  })
}

export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied
  return runIngest()
}

// Vercel Cron invokes scheduled jobs with a GET request (carrying the
// CRON_SECRET bearer), so GET must be supported — it is guarded identically.
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied
  return runIngest()
}
