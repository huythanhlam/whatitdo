import { getCategoryBySlug } from '@/lib/categories'

// Where a landing CTA wants the visitor to end up once they're signed in and
// onboarded. `browse` → the full events list, `weekend` → the list pre-filtered
// to this weekend, `category` → the list filtered to one category. Kept as a
// small closed set (rather than a free-form URL) so the "join" gate can render
// intent-specific copy and never has to trust an attacker-supplied redirect.
export type Intent = 'browse' | 'weekend' | 'category'

export function toIntent(v: string | string[] | undefined): Intent {
  const s = Array.isArray(v) ? v[0] : v
  return s === 'weekend' || s === 'category' ? s : 'browse'
}

// The post-auth destination for an intent, as a same-origin path. The `#events`
// fragment scrolls to the list (which is what these CTAs promise); the filters
// match what the landing links used before this gate existed.
export function destForIntent(basePath: string, intent: Intent, category?: string): string {
  if (intent === 'weekend') return `${basePath}?when=weekend#events`
  if (intent === 'category' && category) return `${basePath}?category=${encodeURIComponent(category)}#events`
  return `${basePath}#events`
}

// Guard against open redirects: only accept same-origin absolute paths. A value
// that is missing, protocol-relative (`//evil.com`), absolute-URL, or otherwise
// not a rooted path is rejected (null). Query strings and `#` fragments are
// preserved — the destinations above rely on both.
export function sanitizeNext(next: string | string[] | undefined | null): string | null {
  const s = Array.isArray(next) ? next[0] : next
  if (!s || typeof s !== 'string') return null
  if (!s.startsWith('/') || s.startsWith('//') || s.startsWith('/\\')) return null
  return s
}

// A short, human label for an intent — used in the gate's headline/eyebrow.
export function labelForIntent(intent: Intent, cityName: string, category?: string): string {
  if (intent === 'weekend') return `${cityName} this weekend`
  if (intent === 'category' && category) {
    return `${getCategoryBySlug(category)?.name ?? category} in ${cityName}`
  }
  return `everything in ${cityName}`
}
