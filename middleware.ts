import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// Root middleware: keep the Supabase auth session fresh on navigations. Excludes
// static assets and images (nothing auth-relevant there).
export async function middleware(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
