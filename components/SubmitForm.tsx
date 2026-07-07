'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function SubmitForm() {
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim() && !text.trim()) {
      setStatus('error')
      setMessage('Add a link or paste the event details.')
      return
    }
    setStatus('loading')
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, text, website }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && (data.received ?? 0) > 0) {
        setStatus('success')
        setMessage(data.message ?? 'Thanks! Your event was submitted for review.')
      } else {
        setStatus('error')
        setMessage(data.error ?? data.note ?? 'We could not find an event in that. Try adding the date, time, and venue.')
      }
    } catch {
      setStatus('error')
      setMessage('Something went wrong. Please try again.')
    }
  }

  if (status === 'success') {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-5xl">✅</p>
        <h2 className="text-xl font-bold">Submitted!</h2>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Link href="/" className="block mt-4 text-sm text-violet-600 hover:underline">Browse events now →</Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="url">Event link</label>
        <Input
          id="url"
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://…  (Eventbrite, a venue page, a post)"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="text">…or paste the details</label>
        <textarea
          id="text"
          value={text}
          onChange={e => setText(e.target.value)}
          rows={5}
          maxLength={8000}
          placeholder="What, when, where — e.g. 'Taco popup at Someone's Yard, Sat July 12 at 6pm, free'"
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      {/* Honeypot: hidden from users, catches bots. */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={e => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      {status === 'error' && <p className="text-sm text-red-500">{message}</p>}

      <Button
        type="submit"
        disabled={status === 'loading'}
        className="w-full bg-violet-600 hover:bg-violet-700 text-white"
      >
        {status === 'loading' ? 'Submitting…' : 'Submit event'}
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        Submissions are reviewed before they appear.
      </p>
    </form>
  )
}
