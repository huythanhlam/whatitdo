'use client'
import { useState, useEffect, useCallback } from 'react'

type PendingEvent = { id: string; title: string; venue_name: string | null; start_time: string; source: string; created_at: string }
type HealthSource = { source: string; stale: boolean; last_status: string | null; last_run_at: string | null }
type HealthResponse = { healthy: boolean; stale: string[]; sources: HealthSource[] }

// The admin dashboard body. Access is already gated server-side by the parent
// page (AdminPage → requireAdmin), so there is no token prompt here: the
// same-origin fetches below send the Supabase session cookie automatically and
// the /api/admin/* routes authorize on it.
export function AdminDashboard({ city }: { city: string }) {
  const [pending, setPending] = useState<PendingEvent[] | null>(null)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([
      fetch(`/api/admin/pending?city=${city}`),
      fetch(`/api/admin/health?city=${city}`),
    ])
      .then(([pRes, hRes]) => {
        if (!pRes.ok || !hRes.ok) throw new Error('Request failed')
        return Promise.all([pRes.json(), hRes.json()])
      })
      .then(([pData, hData]) => {
        setError(null)
        setPending(pData.pending)
        setHealth(hData)
      })
      .catch((e: Error) => setError(e.message))
  }, [city])

  useEffect(() => {
    load()
  }, [load])

  async function act(id: string, action: 'approve' | 'reject') {
    await fetch(`/api/admin/pending/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    load()
  }

  return (
    <div className="max-w-3xl mx-auto py-10 px-4 space-y-10">
      <h1 className="text-xl font-bold capitalize">{city} admin</h1>
      {error && <p className="text-destructive text-sm">{error}</p>}

      <section>
        <h2 className="font-semibold mb-3">Pending submissions ({pending?.length ?? 0})</h2>
        <div className="space-y-2">
          {(pending ?? []).map(e => (
            <div key={e.id} className="border rounded-md p-3 flex items-center justify-between gap-3">
              <div className="text-sm">
                <p className="font-medium">{e.title}</p>
                <p className="text-muted-foreground">
                  {e.venue_name ?? 'No venue'} · {new Date(e.start_time).toLocaleString()} · via {e.source}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => act(e.id, 'approve')} className="text-xs bg-success text-success-foreground px-3 py-1.5 rounded-md">Approve</button>
                <button onClick={() => act(e.id, 'reject')} className="text-xs bg-destructive text-destructive-foreground px-3 py-1.5 rounded-md">Reject</button>
              </div>
            </div>
          ))}
          {pending?.length === 0 && <p className="text-sm text-muted-foreground">Nothing pending.</p>}
        </div>
      </section>

      <section>
        <h2 className="font-semibold mb-3">
          Source health {health && (health.healthy ? '✅' : `⚠️ ${health.stale.length} stale`)}
        </h2>
        <div className="space-y-1 text-sm">
          {(health?.sources ?? []).map(s => (
            <div key={s.source} className={`flex justify-between border-b py-1 ${s.stale ? 'text-destructive' : ''}`}>
              <span>{s.source}</span>
              <span>{s.last_status ?? '—'} · {s.last_run_at ? new Date(s.last_run_at).toLocaleString() : 'never'}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
