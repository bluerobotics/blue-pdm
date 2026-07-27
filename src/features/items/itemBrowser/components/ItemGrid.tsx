import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import type { ItemImage, ItemRow } from '@/types/item'

import { ItemCard } from './ItemCard'

interface ItemGridProps {
  rows: ItemRow[]
  search: string
  iconSize: number
  imagesByPart?: Map<string, ItemImage>
  onOpenImageMenu?: (event: React.MouseEvent, itemNumber: string) => void
}

// Layout constants (mirror the Tailwind classes used on the containers/cards).
const CONTAINER_PADDING = 16 // p-4 horizontal padding on each side
const GRID_GAP = 12 // gap-3
const CARD_EXTRA_WIDTH = 24 // ItemCard width = iconSize + 24
// Rough per-card vertical space beyond the icon (label + optional badges). The
// virtualizer measures actual row heights, so this only affects initial estimate.
const CARD_VERTICAL_EXTRA = 64

export function ItemGrid({ rows, search, iconSize, imagesByPart, onOpenImageMenu }: ItemGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return rows
    return rows.filter((row) =>
      `${row.itemNumber} ${row.description ?? ''}`.toLowerCase().includes(query),
    )
  }, [rows, search])

  // Track available width to compute responsive column count.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const cardWidth = iconSize + CARD_EXTRA_WIDTH
  const columnsPerRow = useMemo(() => {
    const available = width - CONTAINER_PADDING * 2
    if (available <= 0) return 1
    return Math.max(1, Math.floor((available + GRID_GAP) / (cardWidth + GRID_GAP)))
  }, [width, cardWidth])

  // Chunk the flat list into rows of `columnsPerRow` cards for row virtualization.
  const gridRows = useMemo(() => {
    const out: ItemRow[][] = []
    for (let i = 0; i < filteredRows.length; i += columnsPerRow) {
      out.push(filteredRows.slice(i, i + columnsPerRow))
    }
    return out
  }, [filteredRows, columnsPerRow])

  const estimatedRowHeight = iconSize + CARD_VERTICAL_EXTRA + GRID_GAP

  const virtualizer = useVirtualizer({
    count: gridRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 4,
  })

  // Re-measure when card size or column layout changes.
  useEffect(() => {
    virtualizer.measure()
  }, [estimatedRowHeight, columnsPerRow, virtualizer])

  if (filteredRows.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-plm-fg-muted">
        No items match the current definition and filters.
      </div>
    )
  }

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto">
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((virtualRow) => {
          const rowItems = gridRows[virtualRow.index]
          if (!rowItems) return null
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full px-4 grid gap-3"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                gridTemplateColumns: `repeat(${columnsPerRow}, minmax(${cardWidth}px, 1fr))`,
              }}
            >
              {rowItems.map((row) => (
                <ItemCard
                  key={row.itemNumber}
                  row={row}
                  iconSize={iconSize}
                  override={imagesByPart?.get(row.itemNumber)}
                  onContextMenu={
                    onOpenImageMenu ? (e) => onOpenImageMenu(e, row.itemNumber) : undefined
                  }
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
