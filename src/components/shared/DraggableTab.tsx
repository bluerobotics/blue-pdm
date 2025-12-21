import { useState, useRef } from 'react'
import { GripVertical } from 'lucide-react'

export type PanelLocation = 'bottom' | 'right'

export interface DraggableTabProps {
  id: string
  label: string
  active: boolean
  location: PanelLocation
  index: number
  onClick: () => void
  onDoubleClick?: () => void
  onDragStart: (tabId: string, fromLocation: PanelLocation) => void
  onDragEnd: () => void
  onReorder?: (tabId: string, newIndex: number) => void
  tooltip?: string
}

export function DraggableTab({
  id,
  label,
  active,
  location,
  index,
  onClick,
  onDoubleClick,
  onDragStart,
  onDragEnd,
  onReorder,
  tooltip
}: DraggableTabProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [dropIndicator, setDropIndicator] = useState<'left' | 'right' | null>(null)
  const dragRef = useRef<HTMLButtonElement>(null)

  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true)
    // Set drag data
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', JSON.stringify({ tabId: id, fromLocation: location, fromIndex: index }))
    
    // Create a custom drag image with a styled clone
    if (dragRef.current) {
      const clone = dragRef.current.cloneNode(true) as HTMLElement
      clone.style.position = 'absolute'
      clone.style.top = '-9999px'
      clone.style.left = '-9999px'
      clone.style.backgroundColor = 'var(--plm-bg-lighter)'
      clone.style.border = '1px solid var(--plm-accent)'
      clone.style.borderRadius = '4px'
      clone.style.padding = '6px 12px'
      clone.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)'
      document.body.appendChild(clone)
      
      const rect = clone.getBoundingClientRect()
      e.dataTransfer.setDragImage(clone, rect.width / 2, rect.height / 2)
      
      // Clean up the clone after a short delay
      setTimeout(() => clone.remove(), 0)
    }
    
    onDragStart(id, location)
  }

  const handleDragEnd = () => {
    setIsDragging(false)
    setDropIndicator(null)
    onDragEnd()
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (!dragRef.current) return
    
    const rect = dragRef.current.getBoundingClientRect()
    const midpoint = rect.left + rect.width / 2
    
    if (e.clientX < midpoint) {
      setDropIndicator('left')
    } else {
      setDropIndicator('right')
    }
  }

  const handleDragLeave = () => {
    setDropIndicator(null)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDropIndicator(null)
    
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'))
      if (data.tabId && data.fromLocation === location && onReorder && data.tabId !== id) {
        // Reordering within the same panel - adjust index based on drag direction
        const adjustedIndex = data.fromIndex < index && dropIndicator === 'right' ? index : 
                             data.fromIndex < index && dropIndicator === 'left' ? index - 1 :
                             dropIndicator === 'left' ? index : index + 1
        onReorder(data.tabId, Math.max(0, adjustedIndex))
      }
    } catch {
      // Invalid drop data
    }
  }

  return (
    <button
      ref={dragRef}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`tab group relative ${active ? 'active' : ''} ${isDragging ? 'opacity-40 scale-95' : ''} transition-all duration-150`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={tooltip}
    >
      {/* Drop indicator - left */}
      {dropIndicator === 'left' && (
        <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-plm-accent rounded-full -translate-x-0.5" />
      )}
      
      <span className="flex items-center gap-1">
        <GripVertical 
          size={12} 
          className="text-plm-fg-muted opacity-0 group-hover:opacity-60 hover:opacity-100 cursor-grab active:cursor-grabbing flex-shrink-0 -ml-1 transition-opacity" 
        />
        {label}
      </span>
      
      {/* Drop indicator - right */}
      {dropIndicator === 'right' && (
        <div className="absolute right-0 top-1 bottom-1 w-0.5 bg-plm-accent rounded-full translate-x-0.5" />
      )}
    </button>
  )
}

export interface TabDropZoneProps {
  location: PanelLocation
  onDrop: (tabId: string, fromLocation: PanelLocation, toLocation: PanelLocation, dropIndex?: number) => void
  children: React.ReactNode
  className?: string
  tabCount?: number
}

export function TabDropZone({
  location,
  onDrop,
  children,
  className = '',
  tabCount = 0
}: TabDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [isFromOtherPanel, setIsFromOtherPanel] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
    setIsFromOtherPanel(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    // Only set to false if we're actually leaving the drop zone
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX
    const y = e.clientY
    
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDragOver(false)
      setIsFromOtherPanel(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    setIsFromOtherPanel(false)
    
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'))
      if (data.tabId && data.fromLocation) {
        // Only handle drops that are from a different panel (cross-panel moves)
        // Same-panel reordering is handled by individual tabs
        if (data.fromLocation !== location) {
          onDrop(data.tabId, data.fromLocation, location, tabCount) // Add at end
        }
      }
    } catch {
      // Invalid drop data
    }
  }

  const dropMessage = location === 'bottom' ? 'Drop to move to bottom panel' : 'Drop to move to right panel'

  return (
    <div
      ref={containerRef}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`${className} ${isDragOver ? 'ring-2 ring-plm-accent ring-inset bg-plm-accent/5' : ''} transition-all duration-150`}
    >
      {children}
      {isDragOver && isFromOtherPanel && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center pointer-events-none z-10">
          <span className="text-[10px] text-plm-accent font-medium bg-plm-bg-lighter/95 px-2 py-0.5 rounded border border-plm-accent/30 shadow-sm whitespace-nowrap">
            {dropMessage}
          </span>
        </div>
      )}
    </div>
  )
}
