import { Resend } from 'resend'
import type { Event, Category } from '@/lib/types'
import { listSubscriptions, getEventsBetween } from '@/lib/db'
import { escapeHtml, safeUrl } from '@/lib/html'
import { getBaseUrl } from '@/lib/site'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

// Verified sender for production; falls back to Resend's shared sandbox address
// (which only delivers to the account owner) when EMAIL_FROM is unset.
export const EMAIL_FROM = process.env.EMAIL_FROM ?? 'What It Do Austin <onboarding@resend.dev>'

export type DigestFrequency = 'daily' | 'weekly'

type EventWithCats = Event & { categories?: Category[] }

function buildDigestHtml(events: EventWithCats[], unsubscribeUrl: string, dateLabel: string): string {
  const eventHtml = events.slice(0, 12).map(e => {
    const date = new Date(e.start_time).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    })
    const cats = escapeHtml((e.categories ?? []).map(c => c.name).join(', '))
    const priceLabel = e.is_free ? '🆓 Free' : e.price_min ? `$${escapeHtml(e.price_min)}` : ''
    const image = safeUrl(e.image_url)
    const ticket = safeUrl(e.ticket_url)
    return `
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:12px">
        ${image ? `<img src="${image}" alt="" style="width:100%;height:120px;object-fit:cover;border-radius:4px;margin-bottom:12px">` : ''}
        ${cats ? `<p style="font-size:11px;color:#7c3aed;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.05em">${cats}</p>` : ''}
        <h3 style="margin:0 0 6px;font-size:16px;color:#111">${escapeHtml(e.title)}</h3>
        <p style="margin:0 0 4px;font-size:13px;color:#666">📅 ${escapeHtml(date)}</p>
        ${e.venue_name ? `<p style="margin:0 0 8px;font-size:13px;color:#666">📍 ${escapeHtml(e.venue_name)}</p>` : ''}
        ${priceLabel ? `<p style="margin:0 0 8px;font-size:13px;color:#16a34a">${priceLabel}</p>` : ''}
        ${ticket ? `<a href="${ticket}" style="display:inline-block;background:#7c3aed;color:white;padding:8px 16px;border-radius:6px;text-decoration:none;font-size:13px">View event →</a>` : ''}
      </div>
    `
  }).join('')

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h1 style="color:#7c3aed;margin-bottom:4px">What It Do Austin</h1>
      <p style="color:#666;margin-bottom:8px">Austin events — ${escapeHtml(dateLabel)}</p>
      <hr style="border:none;border-top:1px solid #eee;margin-bottom:24px">
      ${eventHtml}
      ${events.length === 0 ? '<p style="color:#888;text-align:center">No events found for your filters.</p>' : ''}
      <hr style="border:none;border-top:1px solid #eee;margin-top:24px">
      <p style="margin-top:16px;font-size:12px;color:#aaa;text-align:center">
        <a href="${escapeHtml(unsubscribeUrl)}" style="color:#aaa">Unsubscribe</a>
      </p>
    </div>
  `
}

export async function sendDigests(frequency: DigestFrequency = 'daily') {
  const baseUrl = getBaseUrl()

  const subs = await listSubscriptions(frequency)
  if (!subs.length) return { sent: 0, frequency }

  const now = new Date()
  const windowDays = frequency === 'weekly' ? 7 : 1
  const end = new Date(now.getTime() + windowDays * 86400000)

  const rawEvents = await getEventsBetween(now.toISOString(), end.toISOString())
  const events: EventWithCats[] = rawEvents.map(e => e as unknown as EventWithCats)

  const dateLabel = frequency === 'weekly'
    ? `week of ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`
    : now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const subject = frequency === 'weekly'
    ? `Austin events this week — ${dateLabel}`
    : `Austin events today — ${dateLabel}`

  let sent = 0

  for (const sub of subs) {
    const filtered = sub.category_slugs?.length
      ? events.filter(e => e.categories?.some(c => sub.category_slugs.includes(c.slug)))
      : events

    // Unsubscribe is a POST (RFC 8058 one-click); the token travels in the query.
    const unsubscribeUrl = `${baseUrl}/api/unsubscribe?token=${sub.token}`

    if (!resend) { console.log(`[digest] would send to ${sub.email} (${filtered.length} events) — no RESEND_API_KEY`); continue }
    try {
      await resend.emails.send({
        from: EMAIL_FROM,
        to: sub.email,
        subject,
        html: buildDigestHtml(filtered, unsubscribeUrl, dateLabel),
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      })
      sent++
    } catch (e) {
      console.error(`Failed to send digest to ${sub.email}:`, e)
    }
  }

  return { sent, frequency }
}
