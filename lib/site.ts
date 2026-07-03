// Canonical base URL for links that leave the app (unsubscribe links in emails,
// and later OG/sitemap URLs). Prefer an explicitly-configured SITE_URL: VERCEL_URL
// is the per-deployment host (e.g. a preview URL), so unsubscribe links built
// from it can point at the wrong deployment.
export function getBaseUrl(): string {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}
