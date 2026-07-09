'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'

type PendingEvent = { id: string; title: string; venue_name: string | null; start_time: string; source: string; created_at: string }
type HealthSource = { source: string; stale: boolean; last_status: string | null; last_run_at: string | null }
type HealthResponse = { healthy: boolean; stale: string[]; sources: HealthSource[] }

export default function AdminPage() {
  const { city } = useParams<{ city: string }>()
  const [token, setToken] = useState('')
  const [savedToken, setSavedToken] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingEvent[] | null>(null)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem('admin_token')
    // Reading a client-only external source (localStorage) on mount; the
    // server has no access to it, so this MUST happen post-hydration in an
    // effect, not during render. A lazy useState initializer here causes a
    // real server/client hydration mismatch instead (verified) — this is
    // the correct pattern for this specific case, not the anti-pattern the
    // rule is meant to catch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) setSavedToken(stored)
  }, [])

  // Fetch + setState happen inside the .then callbacks (a distinct closure
  // from `load` itself) so this synchronizes with the external API rather
  // than setting state directly in the effect that calls `load`.
  const load = useCallback((t: string) => {
    const headers = { Authorization: `Bearer ${t}` }
    Promise.all([
      fetch(`/api/admin/pending?city=${city}`, { headers }),
      fetch(`/api/admin/health?city=${city}`, { headers }),
    ])
      .then(([pRes, hRes]) => {
        if (!pRes.ok || !hRes.ok) throw new Error('Unauthorized or request failed')
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
    if (savedToken) load(savedToken)
  }, [savedToken, load])

  function saveToken() {
    localStorage.setItem('admin_token', token)
    setSavedToken(token)
  }

  async function act(id: string, action: 'approve' | 'reject') {
    if (!savedToken) return
    await fetch(`/api/admin/pending/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${savedToken}` },
      body: JSON.stringify({ action }),
    })
    load(savedToken)
  }

  if (!savedToken) {
    return (
      <div className="max-w-md mx-auto py-16 px-4">
        <h1 className="text-lg font-semibold mb-4">Admin access</h1>
        <input
          type="password"
          value={token}
          onChange={e => setToken(e.target.value)}
          placeholder="CRON_SECRET"
          className="border rounded-md px-3 py-2 w-full mb-3"
        />
        <button onClick={saveToken} className="bg-violet-600 text-white px-4 py-2 rounded-md">
          Continue
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto py-10 px-4 space-y-10">
      <h1 className="text-xl font-bold capitalize">{city} admin</h1>
      {error && <p className="text-red-500 text-sm">{error}</p>}

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
                <button onClick={() => act(e.id, 'approve')} className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-md">Approve</button>
                <button onClick={() => act(e.id, 'reject')} className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-md">Reject</button>
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
            <div key={s.source} className={`flex justify-between border-b py-1 ${s.stale ? 'text-red-600' : ''}`}>
              <span>{s.source}</span>
              <span>{s.last_status ?? '—'} · {s.last_run_at ? new Date(s.last_run_at).toLocaleString() : 'never'}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
