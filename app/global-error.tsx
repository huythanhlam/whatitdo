'use client' // Error boundaries must be Client Components

import { useEffect } from 'react'

// Last-resort boundary for errors thrown in the root layout itself (app/error.tsx
// only catches errors *below* the layout). When this renders, Next has discarded
// the root layout — so there is no <html>/<body>, no globals.css, and no fonts.
// Everything here is therefore self-contained: it renders its own document shell
// and styles inline with the brand palette (light + dark via prefers-color-scheme).
export default function GlobalError({
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
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          background: 'var(--wh-bg)',
          color: 'var(--wh-fg)',
        }}
      >
        {/* Palette mirrors app/globals.css so the fallback still looks on-brand
            in both color schemes even though the stylesheet never loaded. */}
        <style>{`
          :root { --wh-bg:#F9FAF4; --wh-fg:#4A6163; --wh-muted:#7C9092; --wh-primary:#F17A7E; --wh-primary-fg:#1C2929; }
          @media (prefers-color-scheme: dark) {
            :root { --wh-bg:#1C2929; --wh-fg:#F3F0E1; --wh-muted:#9DB2B1; --wh-primary:#F79599; --wh-primary-fg:#1C2929; }
          }
          .wh-retry:hover { opacity: 0.9; }
          .wh-retry:focus-visible { outline: 2px solid var(--wh-primary); outline-offset: 2px; }
        `}</style>
        <div style={{ textAlign: 'center', maxWidth: '28rem' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--wh-muted)', margin: '0 0 1.5rem', lineHeight: 1.5 }}>
            The page couldn&apos;t load. This one&apos;s on us — please try again in a moment.
          </p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="wh-retry"
            style={{
              fontSize: '0.875rem',
              fontWeight: 600,
              background: 'var(--wh-primary)',
              color: 'var(--wh-primary-fg)',
              border: 'none',
              padding: '0.5rem 1.25rem',
              borderRadius: '0.375rem',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
