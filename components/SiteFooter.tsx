import Link from 'next/link'
import { LANDING_PAGES } from '@/lib/landingPages'

export function SiteFooter() {
  return (
    <footer className="border-t mt-12 bg-white/60">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <p className="text-sm font-medium text-slate-700 mb-3">Popular in Austin</p>
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2">
          {LANDING_PAGES.map(p => (
            <li key={p.slug}>
              <Link href={`/${p.slug}`} className="text-sm text-violet-600 hover:underline">
                {p.title.replace(' in Austin', '')}
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground mt-6">
          What It Do ATX — every Austin event, in one place.{' '}
          <Link href="/submit" className="text-violet-600 hover:underline">Submit an event</Link>.
        </p>
      </div>
    </footer>
  )
}
