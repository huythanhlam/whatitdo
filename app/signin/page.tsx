import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { SignInForm } from '@/components/SignInForm'

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to save events and get personalized recommendations.',
  robots: { index: false }, // account surface — nothing to index
}

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card/95">
        <div className="max-w-5xl mx-auto px-4 py-3">
          <Link href="/austin" className="text-sm text-primary hover:underline">← Back to events</Link>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <h1 className="font-display text-2xl font-semibold mb-1 text-center">Sign in</h1>
          <p className="text-sm text-muted-foreground text-center mb-6">
            Save events, get picks tuned to you, and manage your digest.
          </p>
          {/* SignInForm reads search params (redirect, error) → needs a Suspense boundary. */}
          <Suspense>
            <SignInForm />
          </Suspense>
        </div>
      </main>
    </div>
  )
}
