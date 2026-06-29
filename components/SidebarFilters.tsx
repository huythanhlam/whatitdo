'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { CATEGORIES } from '@/lib/categories'

export function SidebarFilters() {
  const router = useRouter()
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
    router.push(`/?${params.toString()}`)
  }

  function clearAll() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('category')
    router.push(`/?${params.toString()}`)
  }

  return (
    <aside className="w-full space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">Categories</h2>
        {selected.length > 0 && (
          <button onClick={clearAll} className="text-xs text-violet-600 hover:underline">
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
