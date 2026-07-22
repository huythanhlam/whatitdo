import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getAdmin } from '@/lib/auth/server'
import { AdminDashboard } from '@/components/AdminDashboard'

// Admin console for a city. Gated on a signed-in user with the global admin
// permission (profiles.is_admin) — no more shared CRON_SECRET. Dynamic because
// it reads the session; not indexed.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false },
}

export default async function AdminPage({ params }: { params: Promise<{ city: string }> }) {
  const { city } = await params

  const { user, admin } = await getAdmin()
  if (!user) redirect(`/signin?redirect=/${city}/admin`)
  if (!admin) {
    return (
      <div className="max-w-md mx-auto py-16 px-4">
        <h1 className="text-lg font-semibold mb-2">Admin access</h1>
        <p className="text-sm text-muted-foreground">
          Your account doesn’t have admin access. Ask an existing admin to grant it.
        </p>
      </div>
    )
  }

  return <AdminDashboard city={city} />
}
