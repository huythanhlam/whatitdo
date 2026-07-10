'use client'
import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function SubmitForm() {
  const { city } = useParams<{ city: string }>()
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    try {
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), text: text.trim(), city }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage(data.error ?? 'Something went wrong.')
        setStatus('error')
        return
      }
      setMessage(data.note ?? 'Submitted!')
      setStatus('success')
    } catch {
      setMessage('Something went wrong. Please try again.')
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-5xl">📮</p>
        <h2 className="text-xl font-bold">Thanks!</h2>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="url">Event page URL</label>
        <Input id="url" type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." />
      </div>
      <p className="text-center text-xs text-muted-foreground">— or —</p>
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="text">Paste event details</label>
        <textarea
          id="text"
          value={text}
          onChange={e => setText(e.target.value)}
          rows={4}
          placeholder="Sat July 4, 8pm — Indie Night @ Mohawk, $15..."
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
      </div>
      {status === 'error' && <p className="text-sm text-destructive">{message}</p>}
      <Button
        type="submit"
        disabled={status === 'loading' || (!url.trim() && !text.trim())}
        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
      >
        {status === 'loading' ? 'Submitting…' : 'Submit event'}
      </Button>
    </form>
  )
}
