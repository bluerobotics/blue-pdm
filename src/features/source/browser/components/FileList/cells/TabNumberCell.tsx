/**
 * Tab Number column cell renderer
 *
 * File-level tab number editing for single-config or no-config SolidWorks files.
 * Uses both contexts:
 * - useFilePaneContext() for UI state (editing state, refs)
 * - useFilePaneHandlers() for action handlers
 */
import { useFilePaneContext, useFilePaneHandlers } from '../../../context'
import { usePDMStore } from '@/stores/pdmStore'
import { validateTabInput, getTabPlaceholder, getTabValidationOptions } from '@/lib/tabValidation'
import { resolveTabNumber, resolvedText } from '@/lib/metadata/overlay'
import { MetadataWriteStateMarker } from '@/components/MetadataWriteStateMarker'
import { isFileWriteInFlight } from '@/lib/metadata/writeInFlight'
import type { CellRendererBaseProps } from './types'

export function TabNumberCell({ file }: CellRendererBaseProps): React.ReactNode {
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
    canHaveConfigs,
  } = useFilePaneHandlers()

  // Store selectors for updating pending metadata and getting settings
  const updatePendingMetadata = usePDMStore((s) => s.updatePendingMetadata)
  const expandedConfigFiles = usePDMStore((s) => s.expandedConfigFiles)
  const serializationSettings = usePDMStore((s) => s.organization?.serialization_settings)
  const tabValidationOptions = getTabValidationOptions(serializationSettings)

  if (file.isDirectory) return ''

  // Only show for SolidWorks files that can have configs
  if (!canHaveConfigs(file)) return ''

  // SW parts/assemblies: tab numbers are config-only, never file-level
  const isSWPartOrAsm = ['.sldprt', '.sldasm'].includes(file.extension?.toLowerCase() || '')
  if (isSWPartOrAsm) return ''

  // If configs are expanded, don't show file-level tab (per-config tabs are shown instead)
  if (expandedConfigFiles.has(file.path)) return ''

  const canEditTab = isFileEditable(file)
  const isEditingTab = editingCell?.path === file.path && editingCell?.column === 'tabNumber'

  const displayValue = resolvedText(resolveTabNumber(file))

  if (isEditingTab && canEditTab) {
    return (
      <div className="relative w-full">
        <input
          ref={inlineEditInputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(validateTabInput(e.target.value, tabValidationOptions))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Update pending metadata with validated value
              const validated = validateTabInput(editValue, tabValidationOptions)
              const edit = updatePendingMetadata(file.path, { tab_number: validated || null })
              handleSaveCellEdit()
              // Auto-save to SW file
              const ext = file.extension?.toLowerCase() || ''
              if (['.sldprt', '.sldasm', '.slddrw'].includes(ext)) {
                const updatedFile = {
                  ...file,
                  pendingMetadata: { ...file.pendingMetadata, tab_number: validated || null },
                }
                saveConfigsToSWFile(updatedFile, edit)
              }
            } else if (e.key === 'Escape') {
              handleCancelCellEdit()
            }
            e.stopPropagation()
          }}
          onBlur={() => {
            // Update pending metadata on blur with validated value
            const validated = validateTabInput(editValue, tabValidationOptions)
            const edit = updatePendingMetadata(file.path, { tab_number: validated || null })
            handleSaveCellEdit()
            // Auto-save to SW file
            const ext = file.extension?.toLowerCase() || ''
            if (['.sldprt', '.sldasm', '.slddrw'].includes(ext)) {
              const updatedFile = {
                ...file,
                pendingMetadata: { ...file.pendingMetadata, tab_number: validated || null },
              }
              saveConfigsToSWFile(updatedFile, edit)
            }
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onDragStart={(e) => e.preventDefault()}
          draggable={false}
          placeholder={getTabPlaceholder(tabValidationOptions)}
          className="w-full bg-plm-bg border border-plm-accent rounded px-1 py-0 text-sm text-plm-fg focus:outline-none focus:ring-1 focus:ring-plm-accent"
        />
      </div>
    )
  }

  return (
    <div
      className={`group/cell relative flex items-center w-full h-full px-1 rounded ${canEditTab ? 'cursor-text hover:bg-plm-bg-light' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        if (canEditTab) {
          handleStartCellEdit(file, 'tabNumber')
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
      title={
        canEditTab
          ? 'Click to edit tab number'
          : file.pdmData?.id
            ? 'Check out file to edit'
            : 'Sign in to edit'
      }
    >
      <span
        className={`flex-1 flex items-center gap-1 ${!displayValue || !canEditTab ? 'text-plm-fg-muted' : ''}`}
      >
        {displayValue || '-'}
        <MetadataWriteStateMarker
          file={file}
          field="tab_number"
          isWriting={isFileWriteInFlight(savingConfigsToSW, file.path)}
          onRetry={saveConfigsToSWFile}
        />
      </span>
    </div>
  )
}
