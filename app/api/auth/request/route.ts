import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createAuthToken } from '@/lib/db'
import { escapeHtml } from '@/lib/html'
import { getBaseUrl } from '@/lib/site'
import { EMAIL_FROM } from '@/lib/email/digest'
import { checkRateLimit, clientIp } from '@/lib/rateLimit'
import { newAuthToken, AUTH_TOKEN_TTL_MS } from '@/lib/auth/session'

// Step 1 of magic-link sign-in: take an email (+ the "email me the digest"
// checkbox), mint a single-use token, and email a verify link. No password ever.
// Deliberately returns a neutral response whether or not the address maps to an
// existing account, so this can't be used to probe who has signed up.

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

// Same budget as /api/subscribe: unauthenticated and it sends email, so without a
// cap it's an open mailer (link-spam to any address, and it burns the send quota).
const AUTH_MAX = 5
const AUTH_WINDOW_MS = 60 * 60 * 1000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  if (!checkRateLimit(`auth:${clientIp(req)}`, AUTH_MAX, AUTH_WINDOW_MS)) {
    return NextResponse.json(
      { error: 'Too many sign-in attempts — please try again in a little while.' },
      { status: 429 }
    )
  }

  let body: { email?: unknown; wantsDigest?: unknown; redirect?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const wantsDigest = body.wantsDigest === true
  // Only accept a same-site path as the post-login destination (no open redirect).
  const redirect =
    typeof body.redirect === 'string' && body.redirect.startsWith('/') && !body.redirect.startsWith('//')
      ? body.redirect
      : ''
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }

  const token = newAuthToken()
  await createAuthToken({ token, email, wantsDigest, expiresAt: new Date(Date.now() + AUTH_TOKEN_TTL_MS) })

  const params = new URLSearchParams({ token })
  if (redirect) params.set('redirect', redirect)
  const verifyUrl = `${getBaseUrl()}/api/auth/verify?${params.toString()}`

  // Local dev with no Resend key: there's no inbox, so surface the link (log +
  // response) so sign-in is testable. Strictly non-production — never leak a live
  // token in the response.
  const devLink = !resend && process.env.NODE_ENV !== 'production' ? verifyUrl : undefined
  if (devLink) console.log(`[auth] magic link for ${email}: ${verifyUrl}`)

  try {
    await resend?.emails.send({
      from: EMAIL_FROM,
      to: email,
      subject: 'Your Whats Happenin sign-in link',
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
          <h2 style="color:#C1502E">Sign in to Whats Happenin 🎉</h2>
          <p>Click below to sign in. This link works once and expires in 15 minutes.</p>
          <p><a href="${escapeHtml(verifyUrl)}" style="display:inline-block;background:#C1502E;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px">Sign in</a></p>
          <hr style="border:none;border-top:1px solid #F2E6D8;margin:24px 0">
          <p style="font-size:12px;color:#8A6B4D">Didn't request this? You can safely ignore this email.</p>
        </div>
      `,
    })
  } catch (e) {
    console.error('Magic-link email failed:', e)
    // Don't reveal the failure — the response stays neutral either way.
  }

  return NextResponse.json({ ok: true, ...(devLink ? { devLink } : {}) })
}
