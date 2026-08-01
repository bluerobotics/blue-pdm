/**
 * Composite hook that groups all file operation handlers
 * Reduces the number of hook calls in FilePane.tsx
 */
import { useState, useCallback } from 'react'
import type { LocalFile } from '@/stores/pdmStore'
import { usePDMStore } from '@/stores/pdmStore'
import { updateFileMetadata } from '@/lib/supabase'
import { executeCommand } from '@/lib/commands'

import { useFileOperations } from './useFileOperations'
import { useDragState } from './useDragState'
import { useAddFiles } from './useAddFiles'

interface UseFilePaneOperationsOptions {
  onRefresh: (silent?: boolean) => void
  vaultPath: string | null
  currentFolder: string
  userId?: string
  currentMachineId: string | null
}

export function useFilePaneOperations({
  onRefresh,
  vaultPath,
  currentFolder,
  userId,
  currentMachineId,
}: UseFilePaneOperationsOptions) {
  const {
    files,
    selectedFiles,
    user,
    addToast,
    addProgressToast,
    updateProgressToast,
    removeToast,
    addProcessingFolder,
    removeProcessingFolder,
    renameFileInStore,
    updateFileInStore,
    setStatusMessage,
  } = usePDMStore()

  // Dialog state setters - these will be passed from the parent
  const [customConfirm, setCustomConfirm] = useState<{
    title: string
    message: string
    warning?: string
    confirmText: string
    confirmDanger?: boolean
    onConfirm: () => void
  } | null>(null)

  const [conflictDialog, setConflictDialog] = useState<{
    conflicts: { sourcePath: string; destPath: string; fileName: string; relativePath: string }[]
    nonConflicts: { sourcePath: string; destPath: string; relativePath: string }[]
    targetFolder: string
    folderName?: string
    onResolve: (resolution: 'overwrite' | 'rename' | 'skip', applyToAll: boolean) => void
  } | null>(null)

  const [undoStack, setUndoStack] = useState<
    Array<{ type: 'delete'; file: LocalFile; originalPath: string }>
  >([])

  // Clipboard is now managed by Zustand store (see usePDMStore.clipboard)
  // Clipboard operations (handleCopy, handleCut, handlePaste) should use useClipboard hook directly

  // Reset hover states helper
  const resetHoverStates = useCallback(() => {
    // This is handled by context now
  }, [])

  // File operations (checkout, checkin, download, upload)
  const fileOps = useFileOperations({
    files,
    selectedFiles,
    userId,
    currentMachineId,
    vaultPath,
    onRefresh,
    addToast,
    addProgressToast,
    updateProgressToast,
    removeToast,
    setCustomConfirm,
    addProcessingFolder,
    removeProcessingFolder,
    renameFileInStore,
    resetHoverStates,
  })

  // Drag and drop
  const dragOps = useDragState({
    files,
    selectedFiles,
    userId,
    vaultPath,
    currentFolder,
    onRefresh,
    addToast,
    addProgressToast,
    updateProgressToast,
    removeToast,
    setStatusMessage,
    setConflictDialog,
  })

  // Delete handler - state managed externally, just expose setters
  const [deleteConfirm, setDeleteConfirm] = useState<LocalFile | null>(null)
  const [deleteEverywhere, setDeleteEverywhere] = useState(false)

  // Add files/folders
  const addOps = useAddFiles({
    vaultPath,
    currentFolder,
    files,
    selectedFiles,
    onRefresh,
    addToast,
    addProgressToast,
    updateProgressToast,
    removeToast,
    setStatusMessage,
    setConflictDialog,
  })

  // Bulk state change handler
  const handleBulkStateChange = useCallback(
    async (filesToChange: LocalFile[], newState: string) => {
      if (!user) return

      const syncedFiles = filesToChange.filter((f) => f.pdmData?.id && !f.isDirectory)
      if (syncedFiles.length === 0) {
        addToast('info', 'No synced files to update')
        return
      }

      let succeeded = 0
      let failed = 0
      let awaitingReview = 0

      setStatusMessage(`Changing state to ${newState}...`)

      const results = await Promise.all(
        syncedFiles.map(async (file) => {
          try {
            const result = await updateFileMetadata(file.pdmData!.id, user.id, {
              state: newState as 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete',
            })

            // A gated transition opens reviews instead of moving the file.
            if (result.requiresReview) return 'review' as const

            if (result.success && result.file) {
              updateFileInStore(file.path, {
                pdmData: { ...file.pdmData!, ...result.file },
              })
              return 'ok' as const
            }
            return 'failed' as const
          } catch {
            return 'failed' as const
          }
        }),
      )

      for (const result of results) {
        if (result === 'ok') succeeded++
        else if (result === 'review') awaitingReview++
        else failed++
      }

      setStatusMessage('')

      if (awaitingReview > 0) {
        addToast('info', `${awaitingReview} file(s) are waiting on workflow approval`)
      }

      if (failed > 0) {
        addToast('warning', `Updated state for ${succeeded}/${syncedFiles.length} files`)
      } else if (succeeded > 0) {
        addToast('success', `Changed ${succeeded} file${succeeded > 1 ? 's' : ''} to ${newState}`)
      }
    },
    [user, addToast, setStatusMessage, updateFileInStore],
  )

  // Checkout/checkin folder handlers
  const handleCheckoutFolder = useCallback(
    (folder: LocalFile) => {
      executeCommand('checkout', { files: [folder] }, { onRefresh })
    },
    [onRefresh],
  )

  const handleCheckinFolder = useCallback(
    (folder: LocalFile) => {
      executeCommand('checkin', { files: [folder] }, { onRefresh })
    },
    [onRefresh],
  )

  // NOTE: Clipboard operations (handleCopy, handleCut, handlePaste) have been moved to useClipboard hook
  // which uses Zustand store for unified clipboard state across FilePane and FileTree

  // Undo handler
  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0) {
      addToast('info', 'Nothing to undo')
      return
    }

    const lastAction = undoStack[undoStack.length - 1]

    if (lastAction.type === 'delete') {
      addToast(
        'info',
        `"${lastAction.file.name}" was moved to Recycle Bin. Restore it from there.`,
        6000,
      )
    }

    setUndoStack((prev) => prev.slice(0, -1))
  }, [undoStack, addToast])

  return {
    // File operations
    handleInlineDownload: fileOps.handleDownload,
    handleInlineCheckout: fileOps.handleCheckout,
    handleInlineCheckin: fileOps.handleCheckin,
    handleInlineUpload: fileOps.handleUpload,
    handleMoveFiles: fileOps.handleMoveFiles,
    selectedDownloadableFiles: fileOps.selectedDownloadableFiles,
    selectedCheckoutableFiles: fileOps.selectedCheckoutableFiles,
    selectedCheckinableFiles: fileOps.selectedCheckinableFiles,
    selectedUploadableFiles: fileOps.selectedUploadableFiles,

    // Drag state
    isDraggingOver: dragOps.isDraggingOver,
    isExternalDrag: dragOps.isExternalDrag,
    dragOverFolder: dragOps.dragOverFolder,
    draggingColumn: dragOps.draggingColumn,
    setDraggingColumn: dragOps.setDraggingColumn,
    dragOverColumn: dragOps.dragOverColumn,
    setDragOverColumn: dragOps.setDragOverColumn,
    selectionBox: dragOps.selectionBox,
    setSelectionBox: dragOps.setSelectionBox,
    resizingColumn: dragOps.resizingColumn,
    setResizingColumn: dragOps.setResizingColumn,
    handleDragStart: dragOps.handleDragStart,
    handleDragEnd: dragOps.handleDragEnd,
    handleDragOver: dragOps.handleDragOver,
    handleDragLeave: dragOps.handleDragLeave,
    handleDrop: dragOps.handleDrop,
    handleFolderDragOver: dragOps.handleFolderDragOver,
    handleFolderDragLeave: dragOps.handleFolderDragLeave,
    handleDropOnFolder: dragOps.handleDropOnFolder,

    // Delete state (DEPRECATED: no longer used - delete operations now use command system)
    // TODO: Remove these unused state variables in future cleanup
    deleteConfirm,
    setDeleteConfirm,
    deleteEverywhere,
    setDeleteEverywhere,

    // Dialog state
    customConfirm,
    setCustomConfirm,
    conflictDialog,
    setConflictDialog,

    // Add files operations
    handleAddFiles: addOps.handleAddFiles,
    handleAddFolder: addOps.handleAddFolder,

    // Bulk operations
    handleBulkStateChange,
    handleCheckoutFolder,
    handleCheckinFolder,

    // NOTE: Clipboard operations (clipboard, setClipboard, handleCopy, handleCut, handlePaste)
    // are now provided by useClipboard hook which uses Zustand store

    // Undo
    undoStack,
    setUndoStack,
    handleUndo,
  }
}
