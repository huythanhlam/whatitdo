import { NextRequest, NextResponse } from 'next/server'
import { PARSERS } from '@/lib/sources/registry'
import type { SourceRow, SourceContext } from '@/lib/sources/types'
import { persistEvents } from '@/lib/persist'
import { isLocal, getEnabledSources, startSourceRun, finishSourceRun, touchSourceSuccess } from '@/lib/db'
import { withGeminiMeter } from '@/lib/gemini'
import { requireCronAuth } from '@/lib/auth'

export const maxDuration = 300

// Austin until Phase 3 wires multi-city through the orchestrator.
const CITY_ID = 1

// Minimal compile-fix for SourceContext.city's new object shape (Task 3 of the
// Phase 2/3 plan) — still hardcoded to Austin, matching prior behavior. Wiring
// this to the actual per-city `cities` row via CITY_ID/getCityById is Task 6's
// job, not this one; that's the still-deferred multi-city orchestrator wiring.
const AUSTIN_CITY = { id: CITY_ID, slug: 'austin', name: 'Austin', state: 'TX' }

function contextFor(source: SourceRow): SourceContext {
  return {
    city: AUSTIN_CITY,
    since: new Date(),
    logger: {
      log: (...a) => console.log(`[${source.name}]`, ...a),
      warn: (...a) => console.warn(`[${source.name}]`, ...a),
      error: (...a) => console.error(`[${source.name}]`, ...a),
    },
  }
}

// Run one configured source end to end, wrapped in a source_runs record linked to
// its sources row. A missing parser or unavailable mechanism (no API key) is a
// visible `skipped`, never a silent empty source.
async function runSource(source: SourceRow): Promise<{ upserted: number; found: number; rejected: number }> {
  const parser = PARSERS[source.parser]
  if (!parser || !parser.available()) {
    const id = await startSourceRun(source.name, source.id)
    await finishSourceRun(id, {
      status: 'skipped',
      error: parser ? 'parser unavailable (missing key)' : `unknown parser: ${source.parser}`,
    })
    return { upserted: 0, found: 0, rejected: 0 }
  }

  const id = await startSourceRun(source.name, source.id)
  try {
    // Scope a Gemini meter to this source so its fetch-time extraction and
    // persist-time tagging requests are attributed to it, even though sources
    // run concurrently.
    const { result, meter } = await withGeminiMeter(async () => {
      const { events, skipped } = await parser.fetch(source, contextFor(source))
      if (skipped) return { skipped: true as const, persist: null }
      return { skipped: false as const, persist: await persistEvents(events) }
    })

    if (result.skipped) {
      // Content-hash short-circuit: page unchanged, no Gemini spent.
      await finishSourceRun(id, { status: 'skipped', error: 'unchanged since last crawl' })
      await touchSourceSuccess(source.id)
      return { upserted: 0, found: 0, rejected: 0 }
    }

    const { inserted, rejected, total } = result.persist!

    // A source shut out entirely by the daily budget (made zero requests, all
    // deferred, no events) is recorded as skipped-for-budget so it's visible and
    // goes first next run — not silently dropped (PRODUCT-SPEC §6.1).
    const budgetBlocked = meter.requests === 0 && meter.skippedForBudget > 0 && total === 0
    await finishSourceRun(id, {
      status: budgetBlocked ? 'skipped' : 'ok',
      events_found: total,
      events_upserted: inserted,
      events_rejected: rejected,
      gemini_requests: meter.requests,
      error: meter.skippedForBudget > 0 ? `${meter.skippedForBudget} Gemini calls skipped (daily budget)` : null,
    })
    if (!budgetBlocked) await touchSourceSuccess(source.id)
    return { upserted: inserted, found: total, rejected }
  } catch (e) {
    console.error(`Source ${source.name} failed:`, e)
    await finishSourceRun(id, { status: 'error', error: (e as Error).message?.slice(0, 500) ?? 'unknown' })
    return { upserted: 0, found: 0, rejected: 0 }
  }
}

async function runIngest() {
  // Ingestion is driven entirely by the `sources` table (Phase 2B): enabled rows
  // for the city, each dispatched to its parser mechanism. Adding coverage is an
  // INSERT, not a code change. Sources run concurrently; each owns its run record.
  const sources = await getEnabledSources(CITY_ID)
  const results = await Promise.all(
    sources.map(async source => ({ name: source.name, ...(await runSource(source)) }))
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
