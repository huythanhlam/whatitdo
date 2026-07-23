import { NextRequest, NextResponse } from 'next/server'
import { checkBotId } from 'botid/server'
import { Resend } from 'resend'
import { CATEGORY_SLUGS } from '@/lib/categories'
import { addSubscription, getCityBySlug, getDistinctNeighborhoods } from '@/lib/db'
import { escapeHtml } from '@/lib/html'
import { getBaseUrl } from '@/lib/site'
import { EMAIL_FROM } from '@/lib/email/digest'
import { checkRateLimit, clientIp } from '@/lib/rateLimit'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

// 5/hour/IP — same budget as /api/submissions. Public and unauthenticated by
// design (no accounts), so without a limit it's an open mailer: unlimited
// "confirm your subscription" emails to any address on demand (harassment,
// and it burns the Resend send quota other subscribers depend on).
const SUBSCRIBE_MAX = 5
const SUBSCRIBE_WINDOW_MS = 60 * 60 * 1000

export async function POST(req: NextRequest) {
  // Bot gate before the per-IP limit: stops distributed automation that stays
  // under the rate cap from using this as an open mailer.
  if ((await checkBotId()).isBot) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  if (!checkRateLimit(`subscribe:${clientIp(req)}`, SUBSCRIBE_MAX, SUBSCRIBE_WINDOW_MS)) {
    return NextResponse.json({ error: 'Too many subscription attempts from this address — please try again later.' }, { status: 429 })
  }

  let body: { email?: unknown; frequency?: unknown; category_slugs?: unknown; city?: unknown; free_only?: unknown; neighborhoods?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const frequency = body.frequency === 'weekly' ? 'weekly' : 'daily'
  const rawSlugs = Array.isArray(body.category_slugs) ? body.category_slugs : []
  const citySlug = typeof body.city === 'string' ? body.city.trim() : ''
  const freeOnly = body.free_only === true
  const rawNeighborhoods = Array.isArray(body.neighborhoods) ? body.neighborhoods : []

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  const city = citySlug ? await getCityBySlug(citySlug) : null
  if (!city || !city.enabled) return NextResponse.json({ error: 'Unknown city' }, { status: 400 })

  const validSlugs = rawSlugs.filter((s: unknown): s is string =>
    typeof s === 'string' && (CATEGORY_SLUGS as string[]).includes(s))

  // Validate against the city's real neighborhoods (dynamic, unlike the fixed
  // category list) so a subscription can't accumulate junk that will never
  // match any event.
  const knownNeighborhoods = await getDistinctNeighborhoods(city.id)
  const validNeighborhoods = rawNeighborhoods.filter((n: unknown): n is string =>
    typeof n === 'string' && knownNeighborhoods.includes(n))

  const token = await addSubscription({
    email, frequency, category_slugs: validSlugs, cityId: city.id,
    freeOnly, neighborhoods: validNeighborhoods,
  })
  if (!token) {
    return NextResponse.json({ error: 'Could not save subscription' }, { status: 500 })
  }

  const confirmUrl = `${getBaseUrl()}/api/subscribe/confirm?token=${token}`
  const unsubscribeUrl = `${getBaseUrl()}/api/unsubscribe?token=${token}`
  const categoryLabel = validSlugs.length ? validSlugs.join(', ') : 'all categories'

  try {
    await resend?.emails.send({
      from: EMAIL_FROM,
      to: email,
      subject: `Confirm your ${city.name} events subscription`,
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
          <h2 style="color:#C1502E">Almost there!</h2>
          <p>You signed up for <strong>${escapeHtml(frequency)}</strong> ${escapeHtml(city.name)} events updates for: <strong>${escapeHtml(categoryLabel)}</strong>.</p>
          <p>Confirm your email to start receiving digests:</p>
          <p><a href="${escapeHtml(confirmUrl)}" style="display:inline-block;background:#C1502E;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px">Confirm subscription</a></p>
          <hr style="border:none;border-top:1px solid #F2E6D8;margin:24px 0">
          <p style="font-size:12px;color:#8A6B4D">Didn't sign up? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#8A6B4D">Unsubscribe</a></p>
        </div>
      `,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    })
  } catch (e) {
    console.error('Confirmation email failed:', e)
    // Don't fail the subscription if email fails
  }

  return NextResponse.json({ ok: true })
}
