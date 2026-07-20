// Shared "follow the next page" helper for the roundup crawlers that walk a
// site's own pagination: Tribe's list view (365thingsaustin.com, absolute
// <link rel="next" href="…/list/page/2/">) and Drupal's pager
// (austintexas.gov, relative <a rel="next" href="?page=1">). Both advertise the
// next page with a rel="next" link, so parse that and resolve it against the
// page's own URL — no per-site URL construction needed.

// Absolute URL of the next page, or null when there's no rel="next" link.
export function nextPageUrl(html: string, baseUrl: string): string | null {
  // Match any <a>/<link> tag carrying rel="next", in either attribute order
  // (rel before href or href before rel).
  const tags = html.match(/<(?:a|link)\b[^>]*\brel=["']?next["']?[^>]*>/gi) ?? []
  for (const tag of tags) {
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1]
    if (!href) continue
    try {
      return new URL(href, baseUrl).toString()
    } catch {
      continue
    }
  }
  return null
}
