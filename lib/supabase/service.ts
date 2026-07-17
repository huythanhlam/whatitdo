import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Service-role Supabase client: bypasses RLS. SERVER-ONLY — never import this
// into a Client Component or expose the key. Used for the few privileged,
// non-user-scoped operations that must reach past RLS: account deletion
// (auth.admin.deleteUser) and creating a confirmed subscription for a verified
// email at sign-up. Bulk backend catalog work (ingest, dedup, digest) stays on
// the raw pg service pool in lib/db.
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}
