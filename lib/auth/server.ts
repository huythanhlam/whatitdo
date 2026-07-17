import type { SupabaseClient, User } from '@supabase/supabase-js'
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
    .select('id, display_name, home_city_id, onboarded_at, personalization_opt_out')
    .eq('id', user.id)
    .maybeSingle()
  return {
    id: user.id,
    email: user.email ?? '',
    display_name: data?.display_name ?? null,
    home_city_id: data?.home_city_id ?? null,
    onboarded_at: data?.onboarded_at ?? null,
    personalization_opt_out: data?.personalization_opt_out ?? false,
  }
}
