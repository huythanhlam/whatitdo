import type { SupabaseClient, User } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Server-side auth via Supabase. Replaces the home-grown session/cookie layer:
// identity is the Supabase JWT (validated by getUser), and the returned client is
// scoped to that user so every query it makes is RLS-enforced.

export type Profile = {
  id: string
  email: string
  display_name: string | null
  home_city_id: number | null
  onboarded_at: string | null
  personalization_opt_out: boolean
  is_admin: boolean
}

// The authenticated user and their RLS-scoped client, or user=null when signed
// out. Route handlers and Server Components call this instead of the old
// resolveActor/currentUser.
export async function getUser(): Promise<{ supabase: SupabaseClient; user: User | null }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, user }
}

// The current user's profile (or null when signed out). The profiles row is
// created by a DB trigger on signup; we fall back to a synthetic default if it
// hasn't materialized yet so callers never crash.
export async function currentProfile(): Promise<Profile | null> {
  const { supabase, user } = await getUser()
  if (!user) return null
  const { data } = await supabase
    .from('profiles')
    .select('id, display_name, home_city_id, onboarded_at, personalization_opt_out, is_admin')
    .eq('id', user.id)
    .maybeSingle()
  return {
    id: user.id,
    email: user.email ?? '',
    display_name: data?.display_name ?? null,
    home_city_id: data?.home_city_id ?? null,
    onboarded_at: data?.onboarded_at ?? null,
    personalization_opt_out: data?.personalization_opt_out ?? false,
    is_admin: data?.is_admin ?? false,
  }
}

// The session plus the global admin permission (profiles.is_admin, migration
// 040), resolved in a single pass. Reads the user's own profile row via the
// RLS-scoped client — the "own profile" SELECT policy allows this. user is null
// (and admin false) when signed out. Server Components use this to gate the
// admin page; requireAdmin wraps it for route handlers.
export async function getAdmin(): Promise<{ supabase: SupabaseClient; user: User | null; admin: boolean }> {
  const { supabase, user } = await getUser()
  if (!user) return { supabase, user: null, admin: false }
  const { data } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle()
  return { supabase, user, admin: data?.is_admin === true }
}

// Route-handler guard for admin-only endpoints. Returns the resolved
// { supabase, user } when the caller is a signed-in admin, or a NextResponse
// (401 signed out / 403 non-admin) to return directly — mirroring the
// requireCronAuth ergonomics but keyed on the Supabase session + is_admin
// instead of the shared CRON_SECRET. Resolves the session once so handlers
// don't re-run getUser().
export async function requireAdmin(): Promise<
  { supabase: SupabaseClient; user: User } | NextResponse
> {
  const { supabase, user, admin } = await getAdmin()
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  if (!admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  return { supabase, user }
}
