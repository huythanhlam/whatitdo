import { NextRequest, NextResponse } from 'next/server'
import { confirmSubscription } from '@/lib/db'

function htmlPage(body: string): NextResponse {
  return new NextResponse(
    `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:420px;margin:80px auto;text-align:center;color:#4A6163">${body}</body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  )
}

// The welcome email's "Confirm your subscription" link. GET is safe here
// (unlike unsubscribe) since confirming is non-destructive — an email client
// or link scanner prefetching it just confirms a subscription the recipient
// already asked for.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.redirect(new URL('/', req.url))

  await confirmSubscription(token)

  return htmlPage(
    `<h2>You're confirmed! ✓</h2>
     <p>Your subscription is active — your first digest will arrive on schedule.</p>
     <a href="/" style="color:#F17A7E">Back to events</a>`
  )
}
