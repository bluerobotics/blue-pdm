/**
 * Read-only, auto-selected input used to "highlight" a cell's text for copying.
 *
 * Mirrors the Name column's highlight mode (see NameCell.tsx): shown when a value
 * is not editable (file not checked out) so users can cleanly select + copy the
 * text without being able to change it.
 */
import { useEffect, useRef } from 'react'

interface CopyHighlightInputProps {
  value: string
  onExit: () => void
}

export function CopyHighlightInput({ value, onExit }: CopyHighlightInputProps): React.ReactNode {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <input
      ref={inputRef}
      type="text"
      readOnly
      value={value}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onExit()
        }
        e.stopPropagation()
      }}
      onBlur={onExit}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDragStart={(e) => e.preventDefault()}
      draggable={false}
      className="w-full bg-plm-bg border border-plm-border rounded px-1 py-0 text-sm text-plm-fg focus:outline-none focus:ring-1 focus:ring-plm-border select-text cursor-text"
    />
  )
}
