import { useState } from 'react'
import type { LocalFile } from '@/stores/pdmStore'

export interface CustomConfirmState {
  title: string
  message: string
  warning?: string
  confirmText: string
  confirmDanger?: boolean
  onConfirm: () => void
}

export interface DeleteLocalCheckoutConfirmState {
  checkedOutFiles: LocalFile[]
  allFilesToProcess: LocalFile[]
  contextFiles: LocalFile[]
}

export interface ConflictDialogState {
  conflicts: Array<{
    sourcePath: string
    destPath: string
    fileName: string
    relativePath: string
  }>
  nonConflicts: Array<{
    sourcePath: string
    destPath: string
    relativePath: string
  }>
  targetFolder: string
  folderName?: string
  onResolve: (resolution: 'overwrite' | 'rename' | 'skip', applyToAll: boolean) => void
  /** Callers that await the resolution need to be told when the user backs out. */
  onCancel?: () => void
}

export interface FolderConflictDialogState {
  sourceFolder: LocalFile
  targetPath: string
  existingFolderPath: string
  /** Total number of folders with conflicts (for multi-folder moves) */
  totalConflicts: number
  /** Current conflict index (1-based, for "1 of 3" display) */
  currentIndex: number
  onResolve: (resolution: 'merge' | 'rename' | 'skip' | 'cancel', applyToAll: boolean) => void
}

export interface UseDialogStateReturn {
  // Delete confirmation
  deleteConfirm: LocalFile | null
  setDeleteConfirm: (file: LocalFile | null) => void
  deleteEverywhere: boolean
  setDeleteEverywhere: (everywhere: boolean) => void

  // Custom confirmation dialog
  customConfirm: CustomConfirmState | null
  setCustomConfirm: (state: CustomConfirmState | null) => void

  // Delete local checkout confirmation
  deleteLocalCheckoutConfirm: DeleteLocalCheckoutConfirmState | null
  setDeleteLocalCheckoutConfirm: (state: DeleteLocalCheckoutConfirmState | null) => void

  // Conflict resolution dialog (for file conflicts)
  conflictDialog: ConflictDialogState | null
  setConflictDialog: (state: ConflictDialogState | null) => void

  // Folder conflict resolution dialog (for folder name conflicts during moves)
  folderConflictDialog: FolderConflictDialogState | null
  setFolderConflictDialog: (state: FolderConflictDialogState | null) => void

  // Close all dialogs
  closeAllDialogs: () => void
}

export function useDialogState(): UseDialogStateReturn {
  const [deleteConfirm, setDeleteConfirm] = useState<LocalFile | null>(null)
  const [deleteEverywhere, setDeleteEverywhere] = useState(false)
  const [customConfirm, setCustomConfirm] = useState<CustomConfirmState | null>(null)
  const [deleteLocalCheckoutConfirm, setDeleteLocalCheckoutConfirm] =
    useState<DeleteLocalCheckoutConfirmState | null>(null)
  const [conflictDialog, setConflictDialog] = useState<ConflictDialogState | null>(null)
  const [folderConflictDialog, setFolderConflictDialog] =
    useState<FolderConflictDialogState | null>(null)

  const closeAllDialogs = () => {
    setDeleteConfirm(null)
    setDeleteEverywhere(false)
    setCustomConfirm(null)
    setDeleteLocalCheckoutConfirm(null)
    setConflictDialog(null)
    setFolderConflictDialog(null)
  }

  return {
    deleteConfirm,
    setDeleteConfirm,
    deleteEverywhere,
    setDeleteEverywhere,
    customConfirm,
    setCustomConfirm,
    deleteLocalCheckoutConfirm,
    setDeleteLocalCheckoutConfirm,
    conflictDialog,
    setConflictDialog,
    folderConflictDialog,
    setFolderConflictDialog,
    closeAllDialogs,
  }
}
