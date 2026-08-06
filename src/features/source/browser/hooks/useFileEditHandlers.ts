import { useCallback, useRef } from 'react'
import type { LocalFile } from '@/stores/pdmStore'
import { usePDMStore } from '@/stores/pdmStore'
import { executeCommand } from '@/lib/commands'
import { resolveFileMetadata, resolveTabNumber, resolvedText } from '@/lib/metadata/overlay'
import { reportMetadataWrite } from '@/lib/metadata/reportMetadataWrite'
import { listWriteAddresses } from '@/lib/metadata/writeState'
import type { PendingMetadataEdit } from '@/stores/types'
import { log } from '@/lib/logger'

// SolidWorks file extensions that support custom properties
const SW_EXTENSIONS = ['.sldprt', '.sldasm', '.slddrw']

export interface FileEditHandlersDeps {
  // State
  files: LocalFile[]
  vaultPath: string | null
  currentPath: string
  user: { id: string } | null

  // Rename state
  renamingFile: LocalFile | null
  setRenamingFile: (file: LocalFile | null) => void
  renameValue: string
  setRenameValue: (value: string) => void
  renameInputRef: React.RefObject<HTMLInputElement | null>

  // New folder state
  isCreatingFolder: boolean
  setIsCreatingFolder: (creating: boolean) => void
  newFolderName: string
  setNewFolderName: (name: string) => void
  newFolderInputRef: React.RefObject<HTMLInputElement | null>

  // Inline edit state
  editingCell: { path: string; column: string } | null
  setEditingCell: (cell: { path: string; column: string } | null) => void
  editValue: string
  setEditValue: (value: string) => void
  inlineEditInputRef: React.RefObject<HTMLInputElement | null>

  // Context menu state
  setContextMenu: (state: { x: number; y: number; file: LocalFile } | null) => void
  setEmptyContextMenu: (state: { x: number; y: number } | null) => void

  // Toast and store actions
  addToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void
  updatePendingMetadata: (
    path: string,
    updates: { part_number?: string | null; description?: string | null; revision?: string },
  ) => PendingMetadataEdit
  onRefresh: (silent?: boolean) => void

  // Auto-save to SolidWorks file
  saveConfigsToSWFile: (file: LocalFile, edit: PendingMetadataEdit) => Promise<void>
}

export interface UseFileEditHandlersReturn {
  handleCreateFolder: () => Promise<void>
  startCreatingFolder: () => void
  handleRename: () => Promise<void>
  startRenaming: (file: LocalFile) => void
  handleStartCellEdit: (file: LocalFile, column: string) => void
  handleSaveCellEdit: () => Promise<void>
  handleCancelCellEdit: () => void
  isFileEditable: (file: LocalFile) => boolean
}

/**
 * Hook for managing file editing operations: create folder, rename, inline cell editing.
 */
export function useFileEditHandlers(deps: FileEditHandlersDeps): UseFileEditHandlersReturn {
  const {
    files,
    vaultPath,
    currentPath,
    user,
    renamingFile,
    setRenamingFile,
    renameValue,
    setRenameValue,
    // renameInputRef is intentionally not destructured here -- focus is
    // handled by a useEffect in NameCell.tsx, not by this hook.
    setIsCreatingFolder,
    newFolderName,
    setNewFolderName,
    newFolderInputRef,
    editingCell,
    setEditingCell,
    editValue,
    setEditValue,
    inlineEditInputRef,
    setContextMenu,
    setEmptyContextMenu,
    addToast,
    updatePendingMetadata,
    onRefresh,
    saveConfigsToSWFile,
  } = deps

  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim() || !vaultPath) {
      setIsCreatingFolder(false)
      setNewFolderName('')
      return
    }

    const folderName = newFolderName.trim()

    setIsCreatingFolder(false)
    setNewFolderName('')

    // Use command system which has optimistic updates + expectedFileChanges
    // This avoids triggering a full loadFiles() scan
    await executeCommand('new-folder', { parentPath: currentPath, folderName })
  }, [newFolderName, vaultPath, currentPath, setIsCreatingFolder, setNewFolderName])

  const startCreatingFolder = useCallback(() => {
    setEmptyContextMenu(null)
    setIsCreatingFolder(true)

    // Generate a unique folder name (New Folder, New Folder (2), etc.)
    // Only check folders in the current directory
    const existingFolderNames = new Set(
      files
        .filter((f) => f.isDirectory)
        .filter((f) => {
          // Only consider folders in the current directory
          const parentPath = f.relativePath.includes('/')
            ? f.relativePath.substring(0, f.relativePath.lastIndexOf('/'))
            : ''
          return parentPath === currentPath
        })
        .map((f) => f.name.toLowerCase()),
    )

    let folderName = 'New Folder'
    let counter = 2
    while (existingFolderNames.has(folderName.toLowerCase()) && counter < 1000) {
      folderName = `New Folder (${counter})`
      counter++
    }

    setNewFolderName(folderName)
    // Focus input after render
    setTimeout(() => {
      newFolderInputRef.current?.focus()
      newFolderInputRef.current?.select()
    }, 10)
  }, [
    files,
    currentPath,
    setEmptyContextMenu,
    setIsCreatingFolder,
    setNewFolderName,
    newFolderInputRef,
  ])

  const startRenaming = useCallback(
    (file: LocalFile) => {
      setContextMenu(null)
      setRenamingFile(file)
      setRenameValue(file.name)
      // Focus is handled by useEffect in NameCell -- no setTimeout needed
    },
    [setContextMenu, setRenamingFile, setRenameValue],
  )

  // Guard against double invocation (Enter keydown fires handleRename, then
  // setRenamingFile(null) unmounts the input which fires onBlur -> second call)
  const isRenamingRef = useRef(false)

  const handleRename = useCallback(async () => {
    if (isRenamingRef.current) {
      log.info('[FileEdit]', 'handleRename: skipping duplicate call (already renaming)')
      return
    }

    if (!renamingFile || !renameValue.trim() || !vaultPath) {
      setRenamingFile(null)
      setRenameValue('')
      return
    }

    const newName = renameValue.trim()
    if (newName === renamingFile.name) {
      setRenamingFile(null)
      setRenameValue('')
      return
    }

    isRenamingRef.current = true
    try {
      await executeCommand('rename', { file: renamingFile, newName }, { onRefresh })
    } finally {
      setRenamingFile(null)
      setRenameValue('')
      isRenamingRef.current = false
    }
  }, [renamingFile, renameValue, vaultPath, setRenamingFile, setRenameValue, onRefresh])

  // Check if file metadata is editable
  // - Unsynced files (no pdmData.id): always editable (local-only files)
  // - Synced files (has pdmData.id): must be checked out by current user
  const isFileEditable = useCallback(
    (file: LocalFile): boolean => {
      // Unsynced local files are always editable (allows setting BR number before first sync)
      if (!file.pdmData?.id) {
        return true
      }
      // Synced files must be checked out by current user
      return file.pdmData?.checked_out_by === user?.id
    },
    [user?.id],
  )

  // Handle inline cell editing for metadata fields (itemNumber, description, revision, state)
  const handleStartCellEdit = useCallback(
    (file: LocalFile, column: string) => {
      // Check if user is logged in
      if (!user?.id) {
        addToast('info', 'Sign in to edit metadata')
        return
      }

      // Check drawing field lockouts (these fields are typically inherited from the model)
      const isDrawing = file.extension?.toLowerCase() === '.slddrw'
      if (isDrawing) {
        const { lockDrawingRevision, lockDrawingItemNumber, lockDrawingDescription } =
          usePDMStore.getState()

        if (column === 'revision' && lockDrawingRevision) {
          addToast('info', 'Drawing revision is driven by the drawing file')
          return
        }
        if (column === 'itemNumber' && lockDrawingItemNumber) {
          addToast('info', 'Drawing item number is inherited from the referenced model')
          return
        }
        if (column === 'description' && lockDrawingDescription) {
          addToast('info', 'Drawing description is inherited from the referenced model')
          return
        }
      }

      // For synced files, check checkout status
      if (file.pdmData?.id) {
        if (!file.pdmData.checked_out_by) {
          addToast('info', 'Check out file to edit metadata')
          return
        }

        if (file.pdmData.checked_out_by !== user.id) {
          const checkedOutUser = (file.pdmData as any).checked_out_user // TODO: type this
          const checkedOutName =
            checkedOutUser?.full_name || checkedOutUser?.email || 'another user'
          addToast('info', `File is checked out by ${checkedOutName}`)
          return
        }
      }
      // Unsynced files (no pdmData.id) are always editable - allows setting metadata before first sync

      const ext = file.extension?.toLowerCase() || ''
      if (SW_EXTENSIONS.includes(ext)) {
        const swStatus = usePDMStore.getState().integrations.solidworks.status
        if (swStatus !== 'online' && swStatus !== 'partial') {
          addToast('error', 'Start the SolidWorks service to edit metadata on SolidWorks files')
          return
        }
      }

      const resolved = resolveFileMetadata(file)
      let currentValue = ''
      switch (column) {
        case 'itemNumber':
          currentValue = resolvedText(resolved.partNumber)
          break
        case 'description':
          currentValue = resolvedText(resolved.description)
          break
        case 'revision':
          currentValue = resolvedText(resolved.revision)
          break
        case 'tabNumber':
          currentValue = resolvedText(resolveTabNumber(file))
          break
      }

      setEditingCell({ path: file.path, column })
      setEditValue(currentValue)

      setTimeout(() => {
        inlineEditInputRef.current?.focus()
        inlineEditInputRef.current?.select()
      }, 0)
    },
    [user?.id, addToast, setEditingCell, setEditValue, inlineEditInputRef],
  )

  // Guard against double invocation (Enter keydown fires handleSaveCellEdit, then
  // setEditingCell(null) unmounts the input which fires onBlur → second call)
  const isSavingCellEdit = useRef(false)

  const handleSaveCellEdit = useCallback(async () => {
    // Prevent concurrent calls (Enter + blur double-fire)
    if (isSavingCellEdit.current) {
      log.info('[FileEdit]', 'handleSaveCellEdit: skipping duplicate call (already saving)')
      return
    }

    if (!editingCell || !user) {
      log.warn('[FileEdit]', 'handleSaveCellEdit: no editingCell or user', {
        editingCell: !!editingCell,
        user: !!user,
      })
      setEditingCell(null)
      setEditValue('')
      return
    }

    isSavingCellEdit.current = true

    try {
      const file = files.find((f) => f.path === editingCell.path)
      if (!file) {
        log.warn('[FileEdit]', 'handleSaveCellEdit: file not found in files array', {
          path: editingCell.path,
          filesCount: files.length,
        })
        setEditingCell(null)
        setEditValue('')
        return
      }
      // Allow saving for both synced and unsynced files
      // Unsynced files store metadata in pendingMetadata which gets synced on first upload

      const trimmedValue = editValue.trim()

      // Check if value actually changed (consider pending metadata too)
      const current = resolveFileMetadata(file)
      let currentValue = ''
      switch (editingCell.column) {
        case 'itemNumber':
          currentValue = resolvedText(current.partNumber)
          break
        case 'description':
          currentValue = resolvedText(current.description)
          break
        case 'revision':
          currentValue = resolvedText(current.revision)
          break
      }

      if (trimmedValue === currentValue) {
        log.info('[FileEdit]', 'handleSaveCellEdit: value unchanged, skipping SW write', {
          column: editingCell.column,
          value: trimmedValue,
        })
        setEditingCell(null)
        setEditValue('')
        return
      }

      // Guard: block revision edits on parts/assemblies when org policy disables file-level revision
      if (editingCell.column === 'revision') {
        const ext = file.extension?.toLowerCase()
        const isModel = ext === '.sldprt' || ext === '.sldasm'
        if (isModel) {
          const orgSettings = usePDMStore.getState().organization?.settings
          if (!orgSettings?.allow_file_level_revision_for_models) {
            addToast('error', 'File-level revision is disabled for parts/assemblies (org policy)')
            setEditingCell(null)
            setEditValue('')
            return
          }
        }
      }

      // For item number, description, revision - save locally only (syncs on check-in)
      const pendingUpdates: {
        part_number?: string | null
        description?: string | null
        revision?: string
      } = {}
      switch (editingCell.column) {
        case 'itemNumber':
          pendingUpdates.part_number = trimmedValue || null
          break
        case 'description':
          pendingUpdates.description = trimmedValue || null
          break
        case 'revision':
          if (!trimmedValue) {
            addToast('error', 'Revision cannot be empty')
            return
          }
          pendingUpdates.revision = trimmedValue.toUpperCase()
          break
      }

      // Update pending metadata in store
      const edit = updatePendingMetadata(file.path, pendingUpdates)

      // Clear edit state first so UI is responsive
      setEditingCell(null)
      setEditValue('')

      // Auto-save to SolidWorks file if applicable
      const ext = file.extension?.toLowerCase() || ''
      if (SW_EXTENSIONS.includes(ext)) {
        try {
          log.info('[FileEdit]', 'Saving inline edit to SW file', {
            path: file.path,
            ext,
            column: editingCell.column,
            updates: Object.keys(pendingUpdates),
          })
          // Need to get updated file with new pending metadata
          const updatedFile = {
            ...file,
            pendingMetadata: { ...file.pendingMetadata, ...pendingUpdates },
          }
          await saveConfigsToSWFile(updatedFile, edit)
        } catch (error) {
          // saveConfigsToSWFile reports what it caught; anything reaching here escaped it, so the
          // edit's fields are still unmarked and would otherwise look confirmed.
          log.error('[FileEdit]', 'Failed to save inline edit to SW file', {
            error: error,
            path: file.path,
          })
          reportMetadataWrite(edit, {
            outcome: 'failed',
            addresses: listWriteAddresses(edit.pending).map((address) => ({
              address,
              state: 'failed' as const,
              reason: error instanceof Error ? error.message : String(error),
            })),
          })
        }
      } else {
        log.info('[FileEdit]', 'Skipping SW save - not a SolidWorks file', { ext, path: file.path })
      }
    } finally {
      isSavingCellEdit.current = false
    }
  }, [
    editingCell,
    user,
    files,
    editValue,
    setEditingCell,
    setEditValue,
    addToast,
    updatePendingMetadata,
    saveConfigsToSWFile,
  ])

  const handleCancelCellEdit = useCallback(() => {
    setEditingCell(null)
    setEditValue('')
  }, [setEditingCell, setEditValue])

  return {
    handleCreateFolder,
    startCreatingFolder,
    handleRename,
    startRenaming,
    handleStartCellEdit,
    handleSaveCellEdit,
    handleCancelCellEdit,
    isFileEditable,
  }
}
