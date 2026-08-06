/**
 * Description column cell renderer
 *
 * Uses both contexts:
 * - useFilePaneContext() for UI state (editing state, refs)
 * - useFilePaneHandlers() for action handlers
 *
 * NOTE: Drawing files can have their description locked via settings because
 * it typically comes from the referenced model, not from editable properties.
 */
import { useState } from 'react'
import { ArrowLeft, Box } from 'lucide-react'
import { usePDMStore } from '@/stores/pdmStore'
import { resolveDescription, resolvedText } from '@/lib/metadata/overlay'
import { MetadataWriteStateMarker } from '@/components/MetadataWriteStateMarker'
import { useFilePaneContext, useFilePaneHandlers } from '../../../context'
import { useCellSlowHighlight } from '../../../hooks/useCellSlowHighlight'
import { CopyHighlightInput } from './CopyHighlightInput'
import { isFileWriteInFlight } from '@/lib/metadata/writeInFlight'
import type { CellRendererBaseProps } from './types'

export function DescriptionCell({ file }: CellRendererBaseProps): React.ReactNode {
  // UI state from FilePaneContext
  const { editingCell, editValue, setEditValue, inlineEditInputRef } = useFilePaneContext()

  // Handlers from FilePaneHandlersContext
  const {
    isFileEditable,
    handleSaveCellEdit,
    handleCancelCellEdit,
    handleStartCellEdit,
    saveConfigsToSWFile,
    savingConfigsToSW,
  } = useFilePaneHandlers()

  // Drawing lockout setting
  const lockDrawingDescription = usePDMStore((s) => s.lockDrawingDescription)

  // Read-only "highlight for copying" mode (shown when the value can't be edited)
  const [isHighlighting, setIsHighlighting] = useState(false)
  const handleSlowHighlightClick = useCellSlowHighlight(() => setIsHighlighting(true))

  if (file.isDirectory) return ''

  // Drawing files can have their description locked via settings
  const isDrawing = file.extension?.toLowerCase() === '.slddrw'
  const isDrawingLocked = isDrawing && lockDrawingDescription
  const canEditDescription = isFileEditable(file) && !isDrawingLocked
  const isEditingDescription =
    editingCell?.path === file.path && editingCell?.column === 'description'

  if (isEditingDescription && canEditDescription) {
    return (
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
        onBlur={handleSaveCellEdit}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full bg-plm-bg border border-plm-accent rounded px-1 py-0 text-sm text-plm-fg focus:outline-none focus:ring-1 focus:ring-plm-accent"
      />
    )
  }

  const displayValue = resolvedText(resolveDescription(file), '-')
  const hasValue = displayValue !== '-'

  // Read-only highlight mode for copying (only for non-editable cells with a value)
  if (isHighlighting && !canEditDescription && hasValue) {
    return <CopyHighlightInput value={displayValue} onExit={() => setIsHighlighting(false)} />
  }

  // Get appropriate tooltip
  const getTooltip = () => {
    if (isDrawingLocked) return 'Drawing description is inherited from the referenced model'
    if (canEditDescription) return displayValue !== '-' ? displayValue : 'Click to edit'
    return hasValue ? `${displayValue} • Check out file to edit` : 'Check out file to edit'
  }

  return (
    <span
      className={`flex items-center gap-1 w-full h-full px-1 rounded truncate ${canEditDescription ? 'cursor-text hover:bg-plm-bg-light' : 'select-text cursor-text'} ${!hasValue || !canEditDescription ? 'text-plm-fg-muted' : ''}`}
      data-no-drag
      onClick={(e) => {
        if (canEditDescription) {
          e.stopPropagation()
          e.preventDefault()
          handleStartCellEdit(file, 'description')
        } else if (hasValue) {
          // Non-editable values: slow double-click opens read-only copy box
          // (fast double-click still bubbles to the row to open the file)
          handleSlowHighlightClick(e)
        }
      }}
      onMouseDown={(e) => {
        // Only stop propagation for editable cells to prevent row selection during edit
        // For non-editable cells, allow native text selection
        if (canEditDescription) {
          e.stopPropagation()
        }
      }}
      title={getTooltip()}
    >
      <span className="truncate">{displayValue}</span>
      {/* A description - the file's or a configuration's - that is not in the file, kept and
          labelled rather than discarded. */}
      <MetadataWriteStateMarker
        file={file}
        field="description"
        isWriting={isFileWriteInFlight(savingConfigsToSW, file.path)}
        onRetry={saveConfigsToSWFile}
      />
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
  )
}
