/**
 * Item Number column cell renderer
 *
 * Uses both contexts:
 * - useFilePaneContext() for UI state (editing state, refs)
 * - useFilePaneHandlers() for action handlers
 *
 * NOTE: Drawing files can have their item number locked via settings because
 * it typically comes from the referenced model, not from editable properties.
 */
import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles, Loader2, Check, ArrowLeft, Box } from 'lucide-react'
import { useFilePaneContext, useFilePaneHandlers } from '../../../context'
import { usePDMStore } from '@/stores/pdmStore'
import { getNextSerialNumber, previewNextSerialNumber } from '@/lib/serialization'
import { useCellSlowHighlight } from '../../../hooks/useCellSlowHighlight'
import { CopyHighlightInput } from './CopyHighlightInput'
import type { CellRendererBaseProps } from './types'

export function ItemNumberCell({ file }: CellRendererBaseProps): React.ReactNode {
  // UI state from FilePaneContext
  const { editingCell, editValue, setEditValue, inlineEditInputRef } = useFilePaneContext()

  // Handlers from FilePaneHandlersContext
  const {
    isFileEditable,
    handleSaveCellEdit,
    handleCancelCellEdit,
    handleStartCellEdit,
    saveConfigsToSWFile,
  } = useFilePaneHandlers()

  // Store selectors for organization, toast, pending metadata, and drawing lockout
  const organization = usePDMStore((s) => s.organization)
  const addToast = usePDMStore((s) => s.addToast)
  const updatePendingMetadata = usePDMStore((s) => s.updatePendingMetadata)
  const lockDrawingItemNumber = usePDMStore((s) => s.lockDrawingItemNumber)

  // Calculate minimum width for item number box based on serialization settings
  // This ensures consistent sizing and alignment across all rows
  const serializationSettings = organization?.serialization_settings
  const prefixLength = serializationSettings?.prefix?.length ?? 3
  const paddingDigits = serializationSettings?.padding_digits ?? 5
  const suffixLength = serializationSettings?.suffix?.length ?? 0
  // Each character is roughly 7px wide in our font, add buffer for generate button (24px) and padding (8px)
  const expectedSerialLength = prefixLength + paddingDigits + suffixLength
  const minItemNumberWidth = Math.max(60, expectedSerialLength * 7 + 32)

  // Local state for generation
  const [isGenerating, setIsGenerating] = useState(false)

  // Read-only "highlight for copying" mode (shown when the value can't be edited)
  const [isHighlighting, setIsHighlighting] = useState(false)
  const handleSlowHighlightClick = useCellSlowHighlight(() => setIsHighlighting(true))

  // Confirmation state for inline BR number generation
  const [confirmingGenerate, setConfirmingGenerate] = useState(false)
  const [previewNumber, setPreviewNumber] = useState<string | null>(null)
  const [popupPosition, setPopupPosition] = useState<{ top: number; left: number } | null>(null)
  const itemBoxRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const justDismissedRef = useRef(false)

  // Calculate popup position when confirmation opens
  useLayoutEffect(() => {
    if (confirmingGenerate && itemBoxRef.current) {
      const rect = itemBoxRef.current.getBoundingClientRect()
      setPopupPosition({
        top: rect.top + rect.height / 2,
        left: rect.right + 4, // 4px gap from the box
      })
    }
  }, [confirmingGenerate])

  // Click-outside handler to cancel confirmation
  useEffect(() => {
    if (!confirmingGenerate) return

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      // Check if click is outside both the item box and the popup
      const isOutsideItemBox = itemBoxRef.current && !itemBoxRef.current.contains(target)
      const isOutsidePopup = popupRef.current && !popupRef.current.contains(target)

      if (isOutsideItemBox && isOutsidePopup) {
        setConfirmingGenerate(false)
        setPreviewNumber(null)
        // Mark that we just dismissed - prevents the same click from triggering edit mode
        justDismissedRef.current = true
        // Clear the flag after a tick so future clicks work normally
        setTimeout(() => {
          justDismissedRef.current = false
        }, 0)
      }
    }

    // Use timeout to avoid immediate trigger from the click that opened confirmation
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [confirmingGenerate])

  if (file.isDirectory) return ''

  // Drawing files can have their item number locked via settings
  const isDrawing = file.extension?.toLowerCase() === '.slddrw'
  const isDrawingLocked = isDrawing && lockDrawingItemNumber
  const canEditItemNumber = isFileEditable(file) && !isDrawingLocked
  const isEditingItemNumber =
    editingCell?.path === file.path && editingCell?.column === 'itemNumber'

  // Handle starting confirmation flow for BR number generation (from hover button)
  const handleStartConfirm = async () => {
    if (!organization?.id) {
      addToast('error', 'No organization connected')
      return
    }

    try {
      const preview = await previewNextSerialNumber(organization.id)
      if (!preview) {
        addToast('error', 'Serialization is disabled or failed')
        return
      }
      setPreviewNumber(preview)
      setConfirmingGenerate(true)
    } catch (error) {
      addToast(
        'error',
        `Failed to preview serial: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // Handle confirming the BR number generation
  const handleConfirmGenerate = async () => {
    setConfirmingGenerate(false)
    setPreviewNumber(null)
    await handleGenerateSerial(true)
  }

  // Handle generating a serial number for item number - auto-saves immediately
  // Works for both synced files (checked out) and unsynced local files
  const handleGenerateSerial = async (fromHover?: boolean) => {
    if (!organization?.id) {
      addToast('error', 'No organization connected')
      return
    }

    // No longer require file to be synced - BR numbers can be generated for local files
    // The org counter increments atomically, so there won't be conflicts when multiple users
    // generate numbers for their local files before syncing

    try {
      // Generate the serial number first (no spinner yet - this is fast)
      const serial = await getNextSerialNumber(organization.id)
      if (!serial) {
        addToast('error', 'Serialization is disabled or failed')
        return
      }

      // Show the generated number immediately in the input (if editing)
      if (!fromHover) {
        setEditValue(serial)
      }

      // Update pending metadata in store
      updatePendingMetadata(file.path, { part_number: serial })

      // Now start the save operation (this is what takes time)
      setIsGenerating(true)

      // Auto-save to SolidWorks file
      const ext = file.extension?.toLowerCase() || ''
      if (['.sldprt', '.sldasm', '.slddrw'].includes(ext)) {
        const updatedFile = {
          ...file,
          pendingMetadata: { ...file.pendingMetadata, part_number: serial },
        }
        await saveConfigsToSWFile(updatedFile)
      } else {
        addToast('success', `Generated: ${serial}`)
      }

      // Exit edit mode after successful save
      handleCancelCellEdit()
    } catch (error) {
      addToast(
        'error',
        `Failed to generate serial: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      setIsGenerating(false)
    }
  }

  // Prioritize pendingMetadata over pdmData - pending edits should always show
  const displayValue =
    file.pendingMetadata?.part_number !== undefined
      ? (file.pendingMetadata.part_number ?? '-')
      : file.pdmData?.part_number || '-'
  const hasValue = displayValue !== '-'

  if (isEditingItemNumber && canEditItemNumber) {
    return (
      <div className="flex items-center gap-1">
        {/* Base number input with generate button inside - sized based on serialization settings */}
        <div
          ref={itemBoxRef}
          className="relative inline-flex"
          style={{ minWidth: minItemNumberWidth }}
        >
          <input
            ref={inlineEditInputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSaveCellEdit()
              } else if (e.key === 'Escape') {
                handleCancelCellEdit()
              }
              e.stopPropagation()
            }}
            onBlur={(e) => {
              // Don't save on blur if clicking the generate button or confirmation popup
              const relatedTarget = e.relatedTarget as HTMLElement | null
              if (relatedTarget?.dataset?.generateBtn) return
              if (confirmingGenerate) return
              handleSaveCellEdit()
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            disabled={isGenerating}
            size={Math.max(editValue.length || 6, 6)}
            className="bg-plm-bg border border-plm-accent rounded pl-1 pr-8 py-0 text-sm text-plm-fg focus:outline-none focus:ring-1 focus:ring-plm-accent disabled:opacity-50"
          />
          <button
            data-generate-btn="true"
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              handleStartConfirm()
            }}
            onMouseDown={(e) => e.stopPropagation()}
            disabled={isGenerating || confirmingGenerate}
            className="absolute right-0.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-plm-fg-muted hover:text-plm-accent hover:bg-plm-accent/20 disabled:opacity-50 transition-colors"
            title="Generate next serial number"
          >
            {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          </button>
        </div>

        {/* Confirmation popup - rendered via portal to escape table overflow */}
        {confirmingGenerate &&
          popupPosition &&
          createPortal(
            <div
              ref={popupRef}
              className="fixed z-[9999] flex items-center gap-1 px-2 py-1 bg-plm-bg rounded shadow-lg animate-in fade-in slide-in-from-left-2 duration-150"
              style={{
                top: popupPosition.top,
                left: popupPosition.left,
                transform: 'translateY(-50%)',
              }}
            >
              <span className="text-plm-fg-muted text-xs whitespace-nowrap">→</span>
              <span className="text-sm text-green-500 font-medium whitespace-nowrap">
                {previewNumber}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  handleConfirmGenerate()
                }}
                onMouseDown={(e) => e.stopPropagation()}
                disabled={isGenerating}
                className="p-0.5 rounded bg-green-700 text-white hover:bg-green-400 disabled:opacity-50 transition-colors"
                title="Confirm generation"
              >
                {isGenerating ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Check size={12} />
                )}
              </button>
            </div>,
            document.body,
          )}
      </div>
    )
  }

  // Read-only highlight mode for copying (only for non-editable cells with a value)
  if (isHighlighting && !canEditItemNumber && hasValue) {
    return <CopyHighlightInput value={displayValue} onExit={() => setIsHighlighting(false)} />
  }

  // Get appropriate tooltip
  const getTooltip = () => {
    if (isDrawingLocked) return 'Drawing item number is inherited from the referenced model'
    if (canEditItemNumber) return 'Click to edit'
    if (file.pdmData?.id) {
      return hasValue ? `${displayValue} • Check out file to edit` : 'Check out file to edit'
    }
    return 'Sign in to edit'
  }

  return (
    <div
      className="group/cell flex items-center h-full gap-1"
      data-no-drag
      onClick={(e) => {
        // Non-editable values: slow double-click opens read-only copy box
        // (fast double-click still bubbles to the row to open the file)
        if (!canEditItemNumber && hasValue) {
          handleSlowHighlightClick(e)
        }
      }}
      onMouseDown={(e) => {
        // Only stop propagation for editable cells to prevent row selection during edit
        // For non-editable cells, allow native text selection
        if (canEditItemNumber) {
          e.stopPropagation()
        }
      }}
      title={getTooltip()}
    >
      {/* Main item number box - sized based on serialization settings */}
      <div
        ref={itemBoxRef}
        className={`relative inline-flex items-center rounded pl-1 pr-8 py-0 ${canEditItemNumber ? 'cursor-text border border-transparent group-hover/cell:border-plm-border/50 group-hover/cell:bg-plm-bg' : 'select-text cursor-text'}`}
        style={{ minWidth: minItemNumberWidth }}
        onClick={(e) => {
          // Don't start edit if we just dismissed confirmation (same click)
          if (canEditItemNumber && !confirmingGenerate && !justDismissedRef.current) {
            e.stopPropagation()
            e.preventDefault()
            handleStartCellEdit(file, 'itemNumber')
          }
          // Allow click through for text selection when not editable
        }}
      >
        <span
          className={`text-sm flex items-center gap-1 ${!hasValue || !canEditItemNumber ? 'text-plm-fg-muted' : ''} ${!canEditItemNumber ? 'select-text' : ''}`}
        >
          {displayValue}
          {isDrawingLocked && (
            <span
              className="inline-flex items-center gap-0.5 text-plm-fg-muted/50 flex-shrink-0"
              title="Inherited from referenced model"
            >
              <ArrowLeft size={10} />
              <Box size={12} />
            </span>
          )}
        </span>
        {canEditItemNumber && !confirmingGenerate && (
          <button
            data-generate-btn="true"
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              handleStartConfirm()
            }}
            onMouseDown={(e) => e.stopPropagation()}
            disabled={isGenerating}
            className="absolute right-0.5 top-1/2 -translate-y-1/2 opacity-0 group-hover/cell:opacity-100 p-0.5 rounded text-plm-fg-muted hover:text-plm-accent hover:bg-plm-accent/20 disabled:opacity-50 transition-all"
            title="Generate next serial number"
          >
            {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          </button>
        )}
      </div>

      {/* Confirmation popup - rendered via portal to escape table overflow */}
      {confirmingGenerate &&
        popupPosition &&
        createPortal(
          <div
            ref={popupRef}
            className="fixed z-[9999] flex items-center gap-1 px-2 py-1 bg-plm-bg rounded shadow-lg animate-in fade-in slide-in-from-left-2 duration-150"
            style={{
              top: popupPosition.top,
              left: popupPosition.left,
              transform: 'translateY(-50%)',
            }}
          >
            <span className="text-plm-fg-muted text-xs whitespace-nowrap">→</span>
            <span className="text-sm text-green-500 font-medium whitespace-nowrap">
              {previewNumber}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                handleConfirmGenerate()
              }}
              onMouseDown={(e) => e.stopPropagation()}
              disabled={isGenerating}
              className="p-0.5 rounded bg-green-700 text-white hover:bg-green-400 disabled:opacity-50 transition-colors"
              title="Confirm generation"
            >
              {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}
