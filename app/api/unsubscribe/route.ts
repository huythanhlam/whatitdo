import { NextRequest, NextResponse } from 'next/server'
import { removeSubscription } from '@/lib/db'
import { escapeHtml } from '@/lib/html'

function htmlPage(body: string): NextResponse {
  return new NextResponse(
    `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:420px;margin:80px auto;text-align:center;color:#3B2A20">${body}</body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  )
}

// GET does NOT unsubscribe — email clients and link scanners prefetch links, so
// a destructive GET would silently drop subscriptions. Instead it renders a
// confirmation page whose button POSTs back here.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.redirect(new URL('/', req.url))

  const action = `/api/unsubscribe?token=${encodeURIComponent(token)}`
  return htmlPage(
    `<h2>Unsubscribe?</h2>
     <p>Stop receiving Austin events emails?</p>
     <form method="POST" action="${escapeHtml(action)}">
       <button type="submit" style="background:#C1502E;color:#fff;border:none;padding:10px 20px;border-radius:6px;font-size:14px;cursor:pointer">Yes, unsubscribe</button>
     </form>
     <p style="margin-top:16px"><a href="/" style="color:#C1502E">No, keep me subscribed</a></p>`
  )
}

// POST performs the unsubscribe. Works both for the confirmation form above and
// for RFC 8058 one-click unsubscribe (List-Unsubscribe-Post) — the token is in
// the query string, so no request body is required.
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  await removeSubscription(token)

  return htmlPage(
    `<h2>Unsubscribed ✓</h2>
     <p>If that subscription existed, it's been removed from the Austin events list.</p>
     <a href="/" style="color:#C1502E">Back to events</a>`
  )
}
