import { createBrowserClient } from '@supabase/ssr'

// Supabase client for Client Components (the browser). Used for the sign-in call
// (signInWithOtp) and any client-side session reads. Anon key only — never the
// service key. RLS still applies to everything it does.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
