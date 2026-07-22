import { NextRequest, NextResponse } from 'next/server'
import { recentSourceRuns, getCityBySlug, type SourceRun } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/server'

export const dynamic = 'force-dynamic'

const WINDOW = 10          // recent runs to inspect per source
const STALE_THRESHOLD = 3  // consecutive bad runs (after a good one) → stale

// A run is "bad" if it errored or produced zero events; 'skipped'/'running' runs
// are ignored (skipped = intentionally off, running = not yet finished).
function isBad(r: SourceRun): boolean {
  return r.status === 'error' || (r.status === 'ok' && r.events_upserted === 0)
}

// A source is stale if its most recent finished runs are a streak of >= 3 bad
// ones AND it has produced events before — i.e. it used to work and now doesn't.
// A source that has simply never produced (or is always skipped) is not stale.
function evaluate(runs: SourceRun[]): { stale: boolean; consecutiveBad: number; everProduced: boolean } {
  const finished = runs.filter(r => r.status === 'ok' || r.status === 'error')
  const everProduced = finished.some(r => r.events_upserted > 0)
  let consecutiveBad = 0
  for (const r of finished) {
    if (isBad(r)) consecutiveBad++
    else break
  }
  return { stale: everProduced && consecutiveBad >= STALE_THRESHOLD, consecutiveBad, everProduced }
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const citySlug = req.nextUrl.searchParams.get('city')
  if (!citySlug) return NextResponse.json({ error: 'city query param is required' }, { status: 400 })
  const city = await getCityBySlug(citySlug)
  if (!city) return NextResponse.json({ error: 'Unknown city' }, { status: 404 })

  const runs = await recentSourceRuns(WINDOW, city.id)

  const bySource = new Map<string, SourceRun[]>()
  for (const r of runs) {
    const list = bySource.get(r.source) ?? []
    list.push(r)
    bySource.set(r.source, list)
  }

  const sources = [...bySource.entries()].map(([source, list]) => {
    const { stale, consecutiveBad, everProduced } = evaluate(list)
    const last = list[0]
    return {
      source,
      stale,
      consecutive_bad: consecutiveBad,
      ever_produced: everProduced,
      last_status: last?.status ?? null,
      last_run_at: last?.started_at ?? null,
      recent: list.map(r => ({
        status: r.status,
        started_at: r.started_at,
        events_found: r.events_found,
        events_upserted: r.events_upserted,
        events_rejected: r.events_rejected,
        gemini_requests: r.gemini_requests,
        error: r.error,
      })),
    }
  })

  const stale = sources.filter(s => s.stale).map(s => s.source)

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    healthy: stale.length === 0,
    stale,
    sources,
  })
}
