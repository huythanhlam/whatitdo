// Normalized match keys for cross-source dedup (PRODUCT-SPEC §2.2). Pure and
// deterministic so the matching policy is unit-testable with fixtures. Imported
// by persist.ts (at ingest), the PGlite seed, and lib/db — must stay dependency-free.

function basicNorm(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, '') // delete apostrophes (no gap) before punctuation collapses to spaces
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // drop punctuation/symbols (unicode-aware)
    .replace(/\s+/g, ' ')
    .trim()
}

// Venue key: lowercase, punctuation-stripped, whitespace-collapsed. Null-safe.
export function normalizeVenue(venue: string | null | undefined): string | null {
  if (!venue) return null
  const n = basicNorm(venue)
  return n.length > 0 ? n : null
}

// Title key: strip promoter prefixes ("X presents"), "live at <venue>" suffixes,
// and — when the venue is known — the venue name itself, then basic-normalize.
export function normalizeTitle(title: string, venueName?: string | null): string {
  let t = title

  // "<Label>: <title>" → "<title>" (e.g. "Live Music: The Black Angels")
  t = t.replace(/^[^:]{1,40}:\s*/, '')

  // "<promoter> presents <title>" → "<title>"
  t = t.replace(/^.*?\bpresents\b[:\s-]*/i, '')

  // "<title> live at <venue>" / "<title> at <venue>" → "<title>"
  t = t.replace(/\s+(?:live\s+)?at\s+.*$/i, '')

  let n = basicNorm(t)

  // Remove the venue tokens if they leaked into the title.
  const vn = normalizeVenue(venueName)
  if (vn) {
    n = n.replace(new RegExp(`\\b${vn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '')
    n = n.replace(/\s+/g, ' ').trim()
  }

  return n
}
