// Escaping helpers for building HTML emails from untrusted data. Event titles,
// venue names, descriptions and links come from scraped third-party pages, so
// they must never be interpolated into HTML unescaped (stored-XSS into every
// subscriber's inbox otherwise).

// Escape text for safe use in element content and double-quoted attributes.
export function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Escape a value for an href/src attribute, and drop anything that isn't an
// absolute http(s) URL (neutralizes javascript:/data: scheme injection from
// scraped links). Returns '' when the input is not a usable URL.
export function safeUrl(input: unknown): string {
  const raw = String(input ?? '').trim()
  if (!/^https?:\/\//i.test(raw)) return ''
  return escapeHtml(raw)
}

// Validate a scraped/submitted URL is absolute http(s) (never javascript:,
// data:, vbscript:, etc.), without HTML-escaping — for sanitizing values
// before they're stored, as opposed to safeUrl's use at HTML-interpolation
// time. Returns the original string unchanged, or null if it isn't a usable
// http(s) URL.
export function httpOrNull(input: string | null | undefined): string | null {
  if (!input) return null
  try {
    const u = new URL(input)
    return u.protocol === 'http:' || u.protocol === 'https:' ? input : null
  } catch {
    return null
  }
}
