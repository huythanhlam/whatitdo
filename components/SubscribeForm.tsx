'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { CATEGORIES } from '@/lib/categories'

export function SubscribeForm() {
  const [email, setEmail] = useState('')
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily')
  const [selected, setSelected] = useState<string[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  function toggleCat(slug: string) {
    setSelected(s => s.includes(slug) ? s.filter(x => x !== slug) : [...s, slug])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, frequency, category_slugs: selected }),
      })
      setStatus(res.ok ? 'success' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-5xl">🎉</p>
        <h2 className="text-xl font-bold">You&apos;re subscribed!</h2>
        <p className="text-sm text-muted-foreground">Check your inbox — first digest arrives tomorrow morning.</p>
        <a href="/" className="block mt-4 text-sm text-violet-600 hover:underline">Browse events now →</a>
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
                className="accent-violet-600"
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

      {status === 'error' && (
        <p className="text-sm text-red-500">Something went wrong. Please try again.</p>
      )}

      <Button
        type="submit"
        disabled={status === 'loading'}
        className="w-full bg-violet-600 hover:bg-violet-700 text-white"
      >
        {status === 'loading' ? 'Subscribing…' : 'Subscribe to Austin events'}
      </Button>
    </form>
  )
}
