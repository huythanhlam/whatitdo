import { NextRequest, NextResponse } from 'next/server'
import { removeSubscription } from '@/lib/db'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.redirect(new URL('/', req.url))

  await removeSubscription(token)

  return new NextResponse(
    `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:400px;margin:80px auto;text-align:center;color:#333">
      <h2>Unsubscribed ✓</h2>
      <p>You've been removed from the Austin events list.</p>
      <a href="/" style="color:#7c3aed">Back to events</a>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  )
}
