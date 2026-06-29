import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { CATEGORY_SLUGS } from '@/lib/categories'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { email, frequency = 'daily', category_slugs = [] } = body

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  const validSlugs = category_slugs.filter((s: string) => (CATEGORY_SLUGS as string[]).includes(s))

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase
    .from('subscriptions')
    .upsert({ email, frequency, category_slugs: validSlugs }, { onConflict: 'email' })
    .select('token')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Could not save subscription' }, { status: 500 })
  }

  const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'
  const unsubscribeUrl = `${baseUrl}/api/unsubscribe?token=${data.token}`
  const categoryLabel = validSlugs.length ? validSlugs.join(', ') : 'all categories'

  try {
    await resend.emails.send({
      from: 'What It Do Austin <onboarding@resend.dev>',
      to: email,
      subject: 'You\'re subscribed to Austin events!',
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
          <h2 style="color:#7c3aed">You're in! 🎉</h2>
          <p>You signed up for <strong>${frequency}</strong> Austin events updates for: <strong>${categoryLabel}</strong>.</p>
          <p>Your first digest will arrive tomorrow morning.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="font-size:12px;color:#888"><a href="${unsubscribeUrl}" style="color:#888">Unsubscribe</a></p>
        </div>
      `,
    })
  } catch (e) {
    console.error('Confirmation email failed:', e)
    // Don't fail the subscription if email fails
  }

  return NextResponse.json({ ok: true })
}
