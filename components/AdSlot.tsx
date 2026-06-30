export function AdSlot({ slot }: { slot: string }) {
  return (
    <div
      className="border border-dashed border-slate-200 rounded-xl flex items-center justify-center bg-slate-50/50 h-44 text-slate-400 text-xs"
      data-ad-slot={slot}
    >
      Advertisement
    </div>
  )
}
