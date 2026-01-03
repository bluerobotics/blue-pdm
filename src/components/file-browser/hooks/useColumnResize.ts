import { useState, useCallback } from 'react'
import { MIN_COLUMN_WIDTH } from '../constants'

export interface UseColumnResizeOptions {
  setColumnWidth: (columnId: string, width: number) => void
}

export interface UseColumnResizeReturn {
  resizingColumn: string | null
  handleColumnResize: (e: React.MouseEvent, columnId: string) => void
}

/**
 * Hook to manage column resize functionality
 */
export function useColumnResize({
  setColumnWidth
}: UseColumnResizeOptions): UseColumnResizeReturn {
  const [resizingColumn, setResizingColumn] = useState<string | null>(null)

  const handleColumnResize = useCallback((e: React.MouseEvent, columnId: string) => {
    e.preventDefault()
    e.stopPropagation()
    
    setResizingColumn(columnId)
    const startX = e.clientX
    const columnElement = (e.target as HTMLElement).closest('[data-column-id]') as HTMLElement
    const startWidth = columnElement?.offsetWidth || 100

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX
      const newWidth = Math.max(MIN_COLUMN_WIDTH, startWidth + delta)
      setColumnWidth(columnId, newWidth)
    }

    const handleMouseUp = () => {
      setResizingColumn(null)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [setColumnWidth])

  return {
    resizingColumn,
    handleColumnResize
  }
}
