import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, FileText, Box, AlertTriangle } from 'lucide-react'

export interface DuplicatePartDialogProps {
  /** Name of the part being duplicated, e.g. "PART-001.SLDPRT" */
  partName: string
  /** Name of the drawing that will be duplicated alongside it, if there is one */
  drawingName: string | null
  /** Extension of the part, e.g. ".SLDPRT" */
  partExtension: string
  /** Extension of the drawing, e.g. ".SLDDRW" */
  drawingExtension: string | null
  /** Initial value for the base name input */
  initialBaseName: string
  /** Resolves to a conflicting file name, or null when the name is free */
  checkConflict: (baseName: string) => Promise<string | null>
  onConfirm: (baseName: string) => void
  onCancel: () => void
}

const INVALID_CHARACTERS = /[\\/:*?"<>|]/

/**
 * Prompts for the new base name of a duplicated part, previewing the resulting file names
 * and blocking names that are invalid or already taken.
 */
export const DuplicatePartDialog = memo(function DuplicatePartDialog({
  partName,
  drawingName,
  partExtension,
  drawingExtension,
  initialBaseName,
  checkConflict,
  onConfirm,
  onCancel,
}: DuplicatePartDialogProps) {
  const [baseName, setBaseName] = useState(initialBaseName)
  const [conflict, setConflict] = useState<string | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const trimmed = baseName.trim()

  const formatError = useMemo(() => {
    if (!trimmed) return 'Enter a name'
    if (INVALID_CHARACTERS.test(trimmed)) return 'Name cannot contain \\ / : * ? " < > |'
    if (trimmed.endsWith('.')) return 'Name cannot end with a period'
    return null
  }, [trimmed])

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // Debounced so a conflict check does not run on every keystroke
  useEffect(() => {
    if (formatError) {
      setConflict(null)
      return
    }

    let cancelled = false
    setIsChecking(true)
    const timer = setTimeout(async () => {
      const result = await checkConflict(trimmed)
      if (cancelled) return
      setConflict(result)
      setIsChecking(false)
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmed, formatError, checkConflict])

  const canConfirm = !formatError && !conflict && !isChecking

  const handleConfirm = () => {
    if (!canConfirm) return
    onConfirm(trimmed)
  }

  const error = formatError ?? (conflict ? `${conflict} already exists` : null)

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center"
      onClick={onCancel}
    >
      <div
        className="bg-plm-bg-light border border-plm-border rounded-lg p-6 w-[440px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-plm-accent-primary/20 flex items-center justify-center">
            <Copy size={20} className="text-plm-accent-primary" />
          </div>
          <h3 className="text-lg font-semibold text-plm-fg">
            {drawingName ? 'Duplicate part and drawing' : 'Duplicate part'}
          </h3>
        </div>

        <p className="text-sm text-plm-fg-dim mb-4">
          {drawingName
            ? `Copies ${partName} and ${drawingName}. The new drawing will reference the new part.`
            : `Copies ${partName}. No matching drawing was found.`}
        </p>

        <label className="block text-xs font-medium text-plm-fg-muted mb-1.5" htmlFor="duplicate-base-name">
          New name
        </label>
        <input
          id="duplicate-base-name"
          ref={inputRef}
          type="text"
          value={baseName}
          onChange={(e) => setBaseName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleConfirm()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
          className="w-full bg-plm-bg border border-plm-border rounded px-2 py-1.5 text-sm text-plm-fg focus:outline-none focus:ring-1 focus:ring-plm-accent focus:border-plm-accent"
          spellCheck={false}
          autoComplete="off"
        />

        <div className="bg-plm-bg rounded px-3 py-2 mt-3 space-y-1.5 text-xs">
          <div className="flex items-center gap-2 text-plm-fg-dim">
            <Box size={13} className="flex-shrink-0 text-plm-fg-muted" />
            <span className="truncate">
              {trimmed || '...'}
              {partExtension}
            </span>
          </div>
          {drawingName && drawingExtension && (
            <div className="flex items-center gap-2 text-plm-fg-dim">
              <FileText size={13} className="flex-shrink-0 text-plm-fg-muted" />
              <span className="truncate">
                {trimmed || '...'}
                {drawingExtension}
              </span>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 mt-3 text-xs text-plm-error">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancel} className="btn btn-ghost">
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={!canConfirm} className="btn btn-primary">
            Duplicate
          </button>
        </div>
      </div>
    </div>
  )
})
