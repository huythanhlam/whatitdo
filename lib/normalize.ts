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

// Known listing *section labels* (the app's category labels plus "live music").
// Only these — matched as a whole label immediately before a colon — are stripped
// as a leading prefix. A generic "anything before a colon" strip would delete a
// distinctive first word ("Jazz: A History" → "a history"), which risks false
// merges in dedup, so the allowlist is deliberately narrow. Ordered longest-first
// so "live music" wins over "music" and "food & drink" over "food".
const SECTION_LABELS = [
  'live music', 'food & drink', 'festivals', 'festival', 'networking', 'nightlife',
  'outdoors', 'comedy', 'family', 'sports', 'events', 'music', 'drink', 'arts',
  'food', 'film', 'event',
]
const SECTION_LABEL_RE = new RegExp(
  `^(?:${SECTION_LABELS.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*:\\s*`,
  'i'
)

// Title key: strip promoter prefixes ("X presents"), "live at <venue>" suffixes,
// and — when the venue is known — the venue name itself, then basic-normalize.
export function normalizeTitle(title: string, venueName?: string | null): string {
  let t = title

  // "<Section Label>: <title>" → "<title>" (e.g. "Live Music: The Black Angels").
  // Only known section labels are stripped — see SECTION_LABELS.
  t = t.replace(SECTION_LABEL_RE, '')

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
