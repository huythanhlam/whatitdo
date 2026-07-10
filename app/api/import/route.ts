import { NextRequest, NextResponse } from 'next/server'
import { resolvePage, extractAndPersist, InputError } from '@/lib/submissions'
import { isLocal, getCityBySlug } from '@/lib/db'
import { requireCronAuth } from '@/lib/auth'

export const maxDuration = 120

// On-demand import for a single influencer post or aggregator page.
//
//   POST /api/import { "url": "https://..." }   → crawl that page, import events
//   POST /api/import { "text": "caption..." }   → extract from pasted text
//   GET  /api/import?url=https://...            → convenience for manual testing
//
// The pasted-text path is the bridge around login-walled platforms: copy an
// Instagram/TikTok caption (or any post text) and import the events from it,
// since those feeds can't be fetched server-side.

async function runImport(url: string, text: string, citySlug: string): Promise<NextResponse> {
  const city = await getCityBySlug(citySlug || 'austin')
  if (!city || !city.enabled) return NextResponse.json({ error: `Unknown city "${citySlug}"` }, { status: 400 })

  try {
    const page = await resolvePage(url, text)
    const result = await extractAndPersist(page, { cityId: city.id, status: 'approved' })
    const note = result.events.length === 0
      ? (process.env.GEMINI_API_KEY
          ? 'No specific upcoming events were found in that content.'
          : 'GEMINI_API_KEY is not configured, so events cannot be extracted from free text.')
      : undefined
    return NextResponse.json({ ...result, note, mode: isLocal() ? 'local' : 'supabase' })
  } catch (e) {
    if (e instanceof InputError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }
}

export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  let body: { url?: unknown; text?: unknown; city?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON with a "url" or "text" field' }, { status: 400 })
  }

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const city = typeof body.city === 'string' ? body.city.trim() : ''
  return runImport(url, text, city)
}

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied
  const url = req.nextUrl.searchParams.get('url')?.trim() ?? ''
  if (!url) {
    return NextResponse.json({ usage: 'POST { url, text?, city? }; or GET ?url=https://...&city=austin' })
  }
  const city = req.nextUrl.searchParams.get('city')?.trim() ?? ''
  return runImport(url, '', city)
}
