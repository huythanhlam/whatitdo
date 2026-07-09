import { NextRequest, NextResponse } from 'next/server'
import { resolvePage, extractAndPersist, InputError } from '@/lib/submissions'
import { getCityBySlug } from '@/lib/db'

export const maxDuration = 120

// Public, UNAUTHENTICATED submission intake (the point of the feature — no
// accounts, anyone can submit): url or pasted text → extracted → persisted as
// `pending` (never auto-published) for review at /[city]/admin. SSRF-guarded
// exactly like /api/import via lib/submissions.ts's shared resolvePage().
export async function POST(req: NextRequest) {
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
