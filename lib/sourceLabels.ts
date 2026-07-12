// Turns a raw `events.source` value (e.g. "crawl:mohawkaustin-com",
// "newspaper:kut", "eventbrite") into a short display label for the source
// filter UI. Namespaced sources (kind:instance) show only the instance segment
// since the prefix is redundant once every option in the list is visible.
export function sourceLabel(source: string): string {
  const slug = source.includes(':') ? source.slice(source.lastIndexOf(':') + 1) : source
  const words = slug.replace(/-com$/, '').split(/[-_]/).filter(Boolean)
  return words.map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
}
