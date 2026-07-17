import { NextResponse } from 'next/server'
import { currentProfile } from '@/lib/auth/server'

// Auth-state probe for the client nav island (components/AuthNav.tsx). The city
// home is ISR-cached and can't render per-visitor auth state, so the nav fetches
// this. Private + no-store so it's never cached across visitors.
export async function GET() {
  const profile = await currentProfile()
  return NextResponse.json(
    {
      signedIn: !!profile,
      displayName: profile?.display_name ?? null,
      onboarded: profile ? profile.onboarded_at !== null : false,
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
}
