import { NextRequest, NextResponse } from 'next/server'
import { SOURCES } from '@/lib/sources/registry'
import type { SourceAdapter, SourceContext } from '@/lib/sources/types'
import { persistEvents } from '@/lib/persist'
import { isLocal, startSourceRun, finishSourceRun } from '@/lib/db'
import { withGeminiMeter } from '@/lib/gemini'
import { requireCronAuth } from '@/lib/auth'

export const maxDuration = 300

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
    // Scope a Gemini meter to this source so its fetch-time extraction and
    // persist-time tagging requests are attributed to it, even though sources
    // run concurrently.
    const { result, meter } = await withGeminiMeter(async () => {
      const events = await source.fetch(contextFor(source))
      return persistEvents(events)
    })
    const { inserted, rejected, total } = result

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
