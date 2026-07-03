'use client' // Error boundaries must be Client Components

import { useEffect } from 'react'

// Route-level error boundary. Replaces the old pattern of catching DB errors in
// the page and rendering an empty grid, which made an outage indistinguishable
// from "no events". Note: this Next.js build passes `unstable_retry` (not the
// stock `reset`) to re-render the failed segment.
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <h1 className="text-xl font-semibold text-slate-800 mb-2">Something went wrong</h1>
        <p className="text-sm text-slate-500 mb-6">
          We couldn&apos;t load events right now. Please try again in a moment.
        </p>
        <button
          onClick={() => unstable_retry()}
          className="text-sm bg-violet-600 text-white px-4 py-2 rounded-md hover:bg-violet-700 transition-colors font-medium"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
