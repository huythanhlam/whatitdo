'use client'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { CATEGORIES } from '@/lib/categories'

export function SidebarFilters({ compact = false }: { compact?: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selected = searchParams.getAll('category')

  function toggle(slug: string) {
    const params = new URLSearchParams(searchParams.toString())
    const existing = params.getAll('category')
    params.delete('category')
    if (existing.includes(slug)) {
      existing.filter(s => s !== slug).forEach(s => params.append('category', s))
    } else {
      [...existing, slug].forEach(s => params.append('category', s))
    }
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
  }

  function clearAll() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('category')
    router.push(`${pathname}?${params.toString()}`)
  }

  if (compact) {
    // Horizontal scrollable chips for mobile, where the sidebar is hidden.
    return (
      <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {CATEGORIES.map(cat => {
          const on = selected.includes(cat.slug)
          return (
            <button
              key={cat.slug}
              onClick={() => toggle(cat.slug)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap border transition-colors flex items-center gap-1.5 ${
                on ? 'text-white border-transparent' : 'bg-background text-muted-foreground border-border'
              }`}
              style={on ? { backgroundColor: cat.color } : undefined}
            >
              {!on && <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />}
              {cat.name}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <aside className="w-full space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">Categories</h2>
        {selected.length > 0 && (
          <button onClick={clearAll} className="text-xs text-primary hover:underline">
            Clear
          </button>
        )}
      </div>
      <Separator />
      <div className="space-y-2.5">
        {CATEGORIES.map(cat => (
          <div key={cat.slug} className="flex items-center gap-2">
            <Checkbox
              id={cat.slug}
              checked={selected.includes(cat.slug)}
              onCheckedChange={() => toggle(cat.slug)}
            />
            <Label htmlFor={cat.slug} className="flex items-center gap-1.5 cursor-pointer text-sm font-normal">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: cat.color }}
              />
              {cat.name}
            </Label>
          </div>
        ))}
      </div>
    </aside>
  )
}
