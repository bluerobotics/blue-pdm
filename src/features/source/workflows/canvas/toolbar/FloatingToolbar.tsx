/**
 * FloatingToolbar - Quick styling options for states and transitions
 *
 * This is a thin container that positions the toolbar and delegates to
 * StateToolbar or TransitionToolbar based on the type.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import type {
  WorkflowState,
  WorkflowTransition,
  TransitionLineStyle,
  TransitionPathType,
  TransitionArrowHead,
  TransitionLineThickness,
} from '@/types/workflow'
import { StateToolbar } from './StateToolbar'
import { TransitionToolbar } from './TransitionToolbar'

interface FloatingToolbarProps {
  x: number
  y: number
  type: 'state' | 'transition'
  isAdmin: boolean
  targetState?: WorkflowState
  targetTransition?: WorkflowTransition
  onColorChange: (color: string) => void
  onLineStyleChange?: (style: TransitionLineStyle) => void
  onPathTypeChange?: (pathType: TransitionPathType) => void
  onArrowHeadChange?: (arrowHead: TransitionArrowHead) => void
  onThicknessChange?: (thickness: TransitionLineThickness) => void
  // State-specific styling
  onFillOpacityChange?: (opacity: number) => void
  onBorderColorChange?: (color: string | null) => void
  onBorderOpacityChange?: (opacity: number) => void
  onBorderThicknessChange?: (thickness: number) => void
  onCornerRadiusChange?: (radius: number) => void
  onShapeChange?: (shape: 'rectangle' | 'diamond' | 'hexagon' | 'ellipse') => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onAddGate?: () => void
  onClose: () => void
}

export function FloatingToolbar({
  x,
  y,
  type,
  isAdmin,
  targetState,
  targetTransition,
  onColorChange,
  onLineStyleChange,
  onPathTypeChange,
  onArrowHeadChange,
  onThicknessChange,
  onFillOpacityChange,
  onBorderColorChange,
  onBorderOpacityChange,
  onBorderThicknessChange,
  onCornerRadiusChange,
  onShapeChange,
  onEdit,
  onDuplicate,
  onDelete,
  onAddGate: _onAddGate,
  onClose,
}: FloatingToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [adjustedPos, setAdjustedPos] = useState<{ x: number; y: number } | null>(null)
  const [dropdownsKey, setDropdownsKey] = useState(0)

  // Close all dropdowns by incrementing key (forces re-render with closed state)
  const closeAllDropdowns = useCallback(() => {
    setDropdownsKey((k) => k + 1)
  }, [])

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  // Adjust position to keep toolbar on screen
  useEffect(() => {
    if (toolbarRef.current) {
      const rect = toolbarRef.current.getBoundingClientRect()
      let newX = x - rect.width / 2 // Center horizontally
      let newY = y

      // Keep on screen
      if (newX + rect.width > window.innerWidth) {
        newX = window.innerWidth - rect.width - 8
      }
      if (newX < 8) newX = 8
      if (newY < 8) newY = 8
      if (newY + rect.height > window.innerHeight) {
        newY = window.innerHeight - rect.height - 8
      }

      setAdjustedPos({ x: newX, y: newY })
    }
  }, [x, y])

  return (
    <div
      ref={toolbarRef}
      className={`fixed z-50 flex flex-col items-center gap-1 transition-opacity duration-75 ${
        adjustedPos ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ left: adjustedPos?.x ?? x, top: adjustedPos?.y ?? y }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Main horizontal toolbar */}
      <div className="flex items-center gap-0.5 bg-plm-sidebar rounded-lg shadow-2xl border border-plm-border p-1">
        {type === 'state' && targetState && (
          <StateToolbar
            key={dropdownsKey}
            targetState={targetState}
            isAdmin={isAdmin}
            onColorChange={onColorChange}
            onFillOpacityChange={onFillOpacityChange}
            onBorderColorChange={onBorderColorChange}
            onBorderOpacityChange={onBorderOpacityChange}
            onBorderThicknessChange={onBorderThicknessChange}
            onCornerRadiusChange={onCornerRadiusChange}
            onShapeChange={onShapeChange}
            onEdit={onEdit}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            closeAllDropdowns={closeAllDropdowns}
          />
        )}

        {type === 'transition' && targetTransition && (
          <TransitionToolbar
            key={dropdownsKey}
            targetTransition={targetTransition}
            isAdmin={isAdmin}
            onColorChange={onColorChange}
            onLineStyleChange={onLineStyleChange}
            onPathTypeChange={onPathTypeChange}
            onArrowHeadChange={onArrowHeadChange}
            onThicknessChange={onThicknessChange}
            onEdit={onEdit}
            onDelete={onDelete}
            closeAllDropdowns={closeAllDropdowns}
          />
        )}
      </div>

      {/* Connection hint arrow pointing down to object */}
      <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-plm-border" />
    </div>
  )
}
