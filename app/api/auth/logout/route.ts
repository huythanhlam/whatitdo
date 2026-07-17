import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// End the Supabase session (clears the auth cookies). POST so a prefetch/scanner
// can't sign someone out.
export async function POST() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } })
}
