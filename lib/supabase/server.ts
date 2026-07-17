import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Supabase client for Server Components, Route Handlers, and Server Actions. It
// carries the signed-in user's session from the request cookies, so every query
// it makes runs as the `authenticated` role and RLS enforces `auth.uid()`. This
// is the client all user-private reads/writes go through.
//
// `setAll` is a no-op-with-catch inside a Server Component (cookies are
// read-only there); the middleware (middleware.ts) is what actually refreshes the
// session cookie on the response.
export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // Called from a Server Component render — the middleware refreshes
            // the session instead, so this can be safely ignored.
          }
        },
      },
    }
  )
}
