'use client'
import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { CATEGORIES } from '@/lib/categories'
import { trackEvent } from '@/lib/analytics'

export function SubscribeForm({ neighborhoods = [] }: { neighborhoods?: string[] }) {
  const { city } = useParams<{ city: string }>()
  const [email, setEmail] = useState('')
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily')
  const [selected, setSelected] = useState<string[]>([])
  const [freeOnly, setFreeOnly] = useState(false)
  const [selectedNeighborhoods, setSelectedNeighborhoods] = useState<string[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  function toggleCat(slug: string) {
    setSelected(s => s.includes(slug) ? s.filter(x => x !== slug) : [...s, slug])
  }

  function toggleNeighborhood(n: string) {
    setSelectedNeighborhoods(s => s.includes(n) ? s.filter(x => x !== n) : [...s, n])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email, frequency, category_slugs: selected, city,
          free_only: freeOnly, neighborhoods: selectedNeighborhoods,
        }),
      })
      if (res.ok) {
        // Primary lead conversion — the email digest signup.
        trackEvent('generate_lead', { method: 'email_digest', city, frequency })
        setStatus('success')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-5xl">📬</p>
        <h2 className="text-xl font-bold">Almost there!</h2>
        <p className="text-sm text-muted-foreground">Check your inbox and confirm your email — your first digest arrives after that.</p>
        <Link href={`/${city}`} className="block mt-4 text-sm text-primary hover:underline">Browse events now →</Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="email">Email address</label>
        <Input
          id="email"
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Frequency</p>
        <div className="flex gap-4">
          {(['daily', 'weekly'] as const).map(f => (
            <label key={f} className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="radio"
                value={f}
                checked={frequency === f}
                onChange={() => setFrequency(f)}
                className="accent-primary"
              />
              <span className="capitalize">{f}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-1">
          Event types
          <span className="font-normal text-muted-foreground ml-1">(leave all unchecked for everything)</span>
        </p>
        <div className="grid grid-cols-2 gap-2 mt-2">
          {CATEGORIES.map(cat => (
            <label key={cat.slug} className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox
                checked={selected.includes(cat.slug)}
                onCheckedChange={() => toggleCat(cat.slug)}
              />
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: cat.color }} />
                {cat.name}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <Checkbox checked={freeOnly} onCheckedChange={() => setFreeOnly(f => !f)} />
          <span>Only show free events</span>
        </label>
      </div>

      {neighborhoods.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-1">
            Neighborhoods
            <span className="font-normal text-muted-foreground ml-1">(leave all unchecked for everywhere)</span>
          </p>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {neighborhoods.map(n => (
              <label key={n} className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox
                  checked={selectedNeighborhoods.includes(n)}
                  onCheckedChange={() => toggleNeighborhood(n)}
                />
                <span>{n}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {status === 'error' && (
        <p className="text-sm text-destructive">Something went wrong. Please try again.</p>
      )}

      <Button
        type="submit"
        disabled={status === 'loading'}
        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
      >
        {status === 'loading' ? 'Subscribing…' : 'Subscribe'}
      </Button>
    </form>
  )
}
