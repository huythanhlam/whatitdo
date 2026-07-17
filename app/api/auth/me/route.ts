import { NextRequest, NextResponse } from 'next/server'
import { getUserById } from '@/lib/db'
import { requireSessionUser } from '@/lib/auth/actor'

// Tiny auth-state probe for the client nav island (components/AuthNav.tsx): the
// city home is ISR-cached and can't render per-visitor auth state, so the nav
// fetches this. Private + no-store so it's never cached across visitors.
export async function GET(req: NextRequest) {
  const userId = await requireSessionUser(req)
  const user = userId ? await getUserById(userId) : null
  return NextResponse.json(
    {
      signedIn: !!user,
      displayName: user?.display_name ?? null,
      onboarded: user ? user.onboarded_at !== null : false,
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
}
