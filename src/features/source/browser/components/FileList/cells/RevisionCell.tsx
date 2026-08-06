/**
 * Revision column cell renderer
 *
 * Uses both contexts:
 * - useFilePaneContext() for UI state (editing state, refs)
 * - useFilePaneHandlers() for action handlers
 *
 * NOTE: Drawing files (.slddrw) can have their revision locked via settings because
 * it typically comes from the drawing's revision table, not from editable properties.
 *
 * NOTE: Part/assembly files (.sldprt/.sldasm) can have file-level revision locked
 * via the org-wide allow_file_level_revision_for_models setting. When disabled,
 * revisions are only controlled from drawings via configuration_revisions.
 */
import { ArrowLeft, FileText } from 'lucide-react'
import { usePDMStore } from '@/stores/pdmStore'
import { resolveRevision, resolvedText } from '@/lib/metadata/overlay'
import { useFilePaneContext, useFilePaneHandlers } from '../../../context'
import type { CellRendererBaseProps } from './types'

export function RevisionCell({ file }: CellRendererBaseProps): React.ReactNode {
  // UI state from FilePaneContext
  const { editingCell, editValue, setEditValue, inlineEditInputRef } = useFilePaneContext()

  // Handlers from FilePaneHandlersContext
  const { isFileEditable, handleSaveCellEdit, handleCancelCellEdit, handleStartCellEdit } =
    useFilePaneHandlers()

  // Drawing lockout setting (per-user)
  const lockDrawingRevision = usePDMStore((s) => s.lockDrawingRevision)

  // Org-wide: parts/assemblies file-level revision lockout
  const allowModelRevision = usePDMStore(
    (s) => s.organization?.settings?.allow_file_level_revision_for_models,
  )

  if (file.isDirectory) return ''

  // Drawing files can have their revision locked via settings
  const ext = file.extension?.toLowerCase()
  const isDrawing = ext === '.slddrw'
  const isDrawingLocked = isDrawing && lockDrawingRevision

  // Part/assembly files: file-level revision locked unless org allows it
  const isModel = ext === '.sldprt' || ext === '.sldasm'
  const isModelLocked = isModel && !allowModelRevision

  const canEditRevision = isFileEditable(file) && !isDrawingLocked && !isModelLocked
  const isEditingRevision = editingCell?.path === file.path && editingCell?.column === 'revision'

  if (isEditingRevision && canEditRevision) {
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
        onDragStart={(e) => e.preventDefault()}
        draggable={false}
        className="w-full bg-plm-bg border border-plm-accent rounded px-1 py-0 text-sm text-plm-fg focus:outline-none focus:ring-1 focus:ring-plm-accent"
      />
    )
  }

  // When model revision is controlled at config level, hide file-level display entirely.
  // Config-level rows (ConfigRow) read from configuration_revisions independently.
  const displayValue = isModelLocked ? '-' : resolvedText(resolveRevision(file), '-')

  // Determine appropriate tooltip message
  const getTooltip = () => {
    if (isDrawingLocked) return 'Drawing revision is driven by the drawing file'
    if (isModelLocked) return 'Revision is controlled from drawings (org policy)'
    if (canEditRevision) return 'Click to edit'
    return 'Check out file to edit'
  }

  return (
    <span
      className={`flex items-center gap-1 w-full h-full px-1 rounded ${canEditRevision ? 'cursor-text hover:bg-plm-bg-light' : 'text-plm-fg-muted'}`}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        if (canEditRevision) {
          handleStartCellEdit(file, 'revision')
        }
      }}
      onMouseDown={(e) => {
        // Stop mousedown from triggering row drag or file focus
        e.stopPropagation()
      }}
      onDragStart={(e) => {
        // Prevent row drag when user is trying to select text
        e.preventDefault()
        e.stopPropagation()
      }}
      draggable={false}
      title={getTooltip()}
    >
      {displayValue}
      {isDrawingLocked && (
        <span
          className="inline-flex items-center gap-0.5 text-plm-fg-muted/50 flex-shrink-0"
          title="Driven by drawing revision table"
        >
          <ArrowLeft size={10} />
          <FileText size={12} />
        </span>
      )}
    </span>
  )
}
