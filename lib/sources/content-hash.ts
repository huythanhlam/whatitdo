import { createHash } from 'node:crypto'

// Stable content fingerprint of a crawled page's readable text. Whitespace is
// normalized first so cosmetic reflow (re-minified HTML, changed indentation)
// doesn't defeat the skip; only meaningful text changes flip the hash. Used to
// skip the Gemini extraction call when a page is unchanged since last crawl
// (PRODUCT-SPEC §6.1 — the ~70–90% cost saving).
export function hashPageText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return createHash('sha256').update(normalized).digest('hex')
}
