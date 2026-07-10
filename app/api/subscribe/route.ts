import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { CATEGORY_SLUGS } from '@/lib/categories'
import { addSubscription, getCityBySlug } from '@/lib/db'
import { escapeHtml } from '@/lib/html'
import { getBaseUrl } from '@/lib/site'
import { EMAIL_FROM } from '@/lib/email/digest'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

export async function POST(req: NextRequest) {
  let body: { email?: unknown; frequency?: unknown; category_slugs?: unknown; city?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const frequency = body.frequency === 'weekly' ? 'weekly' : 'daily'
  const rawSlugs = Array.isArray(body.category_slugs) ? body.category_slugs : []
  const citySlug = typeof body.city === 'string' ? body.city.trim() : ''

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  const city = citySlug ? await getCityBySlug(citySlug) : null
  if (!city || !city.enabled) return NextResponse.json({ error: 'Unknown city' }, { status: 400 })

  const validSlugs = rawSlugs.filter((s: unknown): s is string =>
    typeof s === 'string' && (CATEGORY_SLUGS as string[]).includes(s))

  const token = await addSubscription({ email, frequency, category_slugs: validSlugs, cityId: city.id })
  if (!token) {
    return NextResponse.json({ error: 'Could not save subscription' }, { status: 500 })
  }

  const unsubscribeUrl = `${getBaseUrl()}/api/unsubscribe?token=${token}`
  const categoryLabel = validSlugs.length ? validSlugs.join(', ') : 'all categories'

  try {
    await resend?.emails.send({
      from: EMAIL_FROM,
      to: email,
      subject: `You're subscribed to ${city.name} events!`,
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
          <h2 style="color:#7c3aed">You're in! 🎉</h2>
          <p>You signed up for <strong>${escapeHtml(frequency)}</strong> ${escapeHtml(city.name)} events updates for: <strong>${escapeHtml(categoryLabel)}</strong>.</p>
          <p>Your first digest will arrive soon.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="font-size:12px;color:#888"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#888">Unsubscribe</a></p>
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
