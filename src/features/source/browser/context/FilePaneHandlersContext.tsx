/**
 * FilePaneHandlersContext - Provides action handlers and computed values
 *
 * Separated from FilePaneContext to:
 * 1. Reduce prop drilling through CellRenderer
 * 2. Allow cells to access handlers directly via context
 * 3. Keep UI state separate from action handlers
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { LocalFile } from '@/stores/pdmStore'
import type { OperationType, PendingMetadataRollback } from '@/stores/types'

/**
 * Context value type for file pane handlers
 */
export interface FilePaneHandlersContextValue {
  // Inline action handlers
  handleInlineDownload: (e: React.MouseEvent, file: LocalFile) => void
  handleInlineUpload: (e: React.MouseEvent, file: LocalFile) => void
  handleInlineCheckout: (e: React.MouseEvent, file: LocalFile) => void
  handleInlineCheckin: (e: React.MouseEvent, file: LocalFile) => void

  // Computed selection arrays (for multi-select operations)
  selectedDownloadableFiles: LocalFile[]
  selectedUploadableFiles: LocalFile[]
  selectedCheckoutableFiles: LocalFile[]
  selectedCheckinableFiles: LocalFile[]
  selectedUpdatableFiles: LocalFile[]

  // Status functions
  isBeingProcessed: (path: string) => boolean
  getProcessingOperation: (path: string, isDirectory?: boolean) => OperationType | null
  getFolderCheckoutStatus: (path: string) => 'mine' | 'others' | 'both' | null
  isFolderSynced: (path: string) => boolean
  isFileEditable: (file: LocalFile) => boolean

  // Config handlers (SolidWorks configurations)
  canHaveConfigs: (file: LocalFile) => boolean
  toggleFileConfigExpansion: (file: LocalFile) => void
  hasPendingMetadataChanges: (file: LocalFile) => boolean
  savingConfigsToSW: Set<string>
  /** `rollback` undoes the pending edit when nothing reaches the file - see useConfigHandlers. */
  saveConfigsToSWFile: (file: LocalFile, rollback: PendingMetadataRollback) => void

  // Drawing reference handlers
  canHaveDrawingRefs: (file: LocalFile) => boolean
  toggleDrawingRefExpansion: (file: LocalFile) => void

  // Edit handlers
  handleRename: () => void
  handleSaveCellEdit: () => void
  handleCancelCellEdit: () => void
  handleStartCellEdit: (file: LocalFile, column: string) => void
}

const FilePaneHandlersContext = createContext<FilePaneHandlersContextValue | null>(null)

export interface FilePaneHandlersProviderProps {
  children: ReactNode
  handlers: FilePaneHandlersContextValue
}

/**
 * Provider for file pane handlers context
 * Receives handlers from FilePane.tsx and provides them to cell components
 */
export function FilePaneHandlersProvider({ children, handlers }: FilePaneHandlersProviderProps) {
  // Memoize to prevent unnecessary re-renders
  const value = useMemo(() => handlers, [handlers])

  return (
    <FilePaneHandlersContext.Provider value={value}>{children}</FilePaneHandlersContext.Provider>
  )
}

/**
 * Hook to access file pane handlers context
 * Must be used within FilePaneHandlersProvider
 */
export function useFilePaneHandlers() {
  const context = useContext(FilePaneHandlersContext)
  if (!context) {
    throw new Error('useFilePaneHandlers must be used within FilePaneHandlersProvider')
  }
  return context
}
