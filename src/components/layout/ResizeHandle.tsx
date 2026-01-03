interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical'
  onResizeStart: () => void
  className?: string
}

/**
 * Draggable resize handle for panels
 * - horizontal: vertical bar for width resizing (e.g., sidebar)
 * - vertical: horizontal bar for height resizing (e.g., details panel)
 */
export function ResizeHandle({ direction, onResizeStart, className = '' }: ResizeHandleProps) {
  if (direction === 'horizontal') {
    return (
      <div
        className={`w-1.5 bg-plm-border hover:bg-plm-accent cursor-col-resize transition-colors flex-shrink-0 relative group ${className}`}
        onMouseDown={onResizeStart}
      >
        {/* Wider invisible hit area for easier grabbing */}
        <div className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize" />
      </div>
    )
  }

  return (
    <div
      className={`h-1.5 bg-plm-border hover:bg-plm-accent cursor-row-resize transition-colors flex-shrink-0 relative z-10 ${className}`}
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onResizeStart()
      }}
    >
      {/* Taller invisible hit area for easier grabbing - prevents file drag from taking over */}
      <div className="absolute inset-x-0 -top-2 -bottom-2 cursor-row-resize" />
    </div>
  )
}
