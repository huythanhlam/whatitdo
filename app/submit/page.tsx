import type { Metadata } from 'next'
import Link from 'next/link'
import { SubmitForm } from '@/components/SubmitForm'

export const metadata: Metadata = {
  title: 'Submit an event',
  description: 'Add an Austin event to What It Do — paste a link or the details and we’ll list it after a quick review.',
}

export default function SubmitPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-white/95 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <Link href="/" className="text-sm text-violet-600 hover:underline">← Back to events</Link>
        </div>
      </header>

      <div className="flex items-start justify-center pt-12 pb-20 px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <p className="text-4xl mb-3">📣</p>
            <h1 className="text-2xl font-bold mb-2">Submit an Austin event</h1>
            <p className="text-sm text-muted-foreground">
              Know something happening that we’re missing? Add it here — a link or a few details is all it takes.
            </p>
          </div>
          <SubmitForm />
        </div>
      </div>
    </div>
  )
}
