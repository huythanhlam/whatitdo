import { NextRequest, NextResponse } from 'next/server'
import { checkBotId } from 'botid/server'
import { resolvePage, extractAndPersist, InputError } from '@/lib/submissions'
import { getCityBySlug } from '@/lib/db'
import { checkRateLimit, clientIp } from '@/lib/rateLimit'

export const maxDuration = 120

// 5 submissions/hour/IP — generous for a real person submitting a few events,
// low enough to blunt a flood against the shared Gemini daily budget
// (lib/gemini.ts), which the scheduled ingest cron also depends on.
const SUBMIT_MAX = 5
const SUBMIT_WINDOW_MS = 60 * 60 * 1000

// Public, UNAUTHENTICATED submission intake (the point of the feature — no
// accounts, anyone can submit): url or pasted text → extracted → persisted as
// `pending` (never auto-published) for review at /[city]/admin. SSRF-guarded
// exactly like /api/import via lib/submissions.ts's shared resolvePage().
export async function POST(req: NextRequest) {
  // Bot gate before the per-IP limit: extraction hits the shared Gemini budget,
  // so keep automated floods off it even when they stay under the rate cap.
  if ((await checkBotId()).isBot) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  if (!checkRateLimit(`submissions:${clientIp(req)}`, SUBMIT_MAX, SUBMIT_WINDOW_MS)) {
    return NextResponse.json({ error: 'Too many submissions from this address — please try again later.' }, { status: 429 })
  }

  let body: { url?: unknown; text?: unknown; city?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON with a "url" or "text" field' }, { status: 400 })
  }

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const citySlug = typeof body.city === 'string' ? body.city.trim() : ''

  const city = citySlug ? await getCityBySlug(citySlug) : null
  if (!city || !city.enabled) return NextResponse.json({ error: 'Unknown or missing city' }, { status: 400 })

  try {
    const page = await resolvePage(url, text, 'submission')
    const result = await extractAndPersist(page, { cityId: city.id, status: 'pending' })
    if (result.events.length === 0) {
      return NextResponse.json({
        submitted: 0,
        note: process.env.GEMINI_API_KEY
          ? 'No specific upcoming events were found in that content.'
          : 'GEMINI_API_KEY is not configured, so events cannot be extracted from free text.',
      })
    }
    return NextResponse.json({
      submitted: result.events.length,
      note: 'Thanks! Your submission is pending review before it appears publicly.',
    })
  } catch (e) {
    if (e instanceof InputError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('Submission failed:', e)
    return NextResponse.json({ error: 'Could not process that submission' }, { status: 500 })
  }
}
