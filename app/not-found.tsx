import Link from 'next/link'

// Rendered when a route segment calls notFound() (e.g. an unknown event id on
// app/events/[id]) or an unmatched path.
export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <h1 className="text-xl font-semibold text-slate-800 mb-2">Page not found</h1>
        <p className="text-sm text-slate-500 mb-6">
          That event or page doesn&apos;t exist or may have ended.
        </p>
        <Link
          href="/"
          className="text-sm bg-violet-600 text-white px-4 py-2 rounded-md hover:bg-violet-700 transition-colors font-medium"
        >
          Back to events
        </Link>
      </div>
    </div>
  )
}
