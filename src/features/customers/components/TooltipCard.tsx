import type { ReactNode } from 'react'

/**
 * Visual shell shared by every chart tooltip.
 *
 * Recharts' default tooltip renders a white card with its own font stack,
 * which reads as a foreign element inside the app's dark chrome. Each chart
 * supplies its own rows because the formatting differs (money vs share vs
 * counts); only the container is shared.
 */
export function TooltipCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-md border border-plm-border-light bg-plm-bg-lighter/95 backdrop-blur-sm px-3 py-2 shadow-lg pointer-events-none">
      <div className="text-[11px] font-medium text-plm-fg mb-1.5">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

export function TooltipRow({
  color,
  label,
  value,
}: {
  color?: string
  label: string
  value: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 text-[11px] whitespace-nowrap">
      {color && (
        <span className="w-2 h-2 rounded-[2px] shrink-0" style={{ backgroundColor: color }} />
      )}
      <span className="text-plm-fg-muted flex-1">{label}</span>
      <span className="text-plm-fg tabular-nums font-medium">{value}</span>
    </div>
  )
}
