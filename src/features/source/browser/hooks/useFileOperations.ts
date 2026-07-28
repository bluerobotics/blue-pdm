/**
 * useFileOperations - Core file operations hook
 *
 * Provides handlers for PDM file operations including download, upload, checkout,
 * checkin, discard, force release, sync, and move. Also computes selection lists
 * for files that can perform each operation.
 *
 * Key exports:
 * - handleDownload, handleCheckout, handleCheckin, handleUpload
 * - handleDiscard, handleForceRelease, handleSync, handleMoveFiles
 * - selectedDownloadableFiles, selectedCheckoutableFiles, selectedCheckinableFiles, selectedUploadableFiles
 *
 * @example
 * const {
 *   handleCheckout,
 *   handleCheckin,
 *   selectedCheckoutableFiles
 * } = useFileOperations({
 *   files, selectedFiles, userId, vaultPath, onRefresh, addToast, ...
 * })
 */
import { useCallback, useMemo } from 'react'
import { log } from '@/lib/logger'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'
import type { OperationType } from '@/stores/types'
import { executeCommand } from '@/lib/commands'
import { logFileAction } from '@/lib/userActionLogger'
import { getSyncedFilesFromSelection } from '@/lib/commands/types'
import { isMachineOnline } from '@/lib/supabase'
import { moveFileOnServer, updateFolderPath, updateFolderServerPath } from '@/lib/supabase/files'
import { getFilesInFolder } from '@/lib/commands/types'
import { buildFullPath } from '@/lib/utils/path'
import { beginWatcherSuppression } from '@/lib/fileWatcherSuppression'
import type { CustomConfirmState } from './useDialogState'

export interface UseFileOperationsOptions {
  files: LocalFile[]
  selectedFiles: string[]
  userId: string | undefined
  currentMachineId: string | null
  vaultPath: string | null
  onRefresh: (silent?: boolean) => void
  addToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
  addProgressToast: (id: string, message: string, total: number) => void
  updateProgressToast: (id: string, current: number, percent: number) => void
  removeToast: (id: string) => void
  setCustomConfirm: (state: CustomConfirmState | null) => void
  addProcessingFolder: (path: string, operationType: OperationType) => void
  removeProcessingFolder: (path: string) => void
  renameFileInStore: (
    oldPath: string,
    newPath: string,
    newRelativePath: string,
    moved?: boolean,
  ) => void
  resetHoverStates?: () => void
  /** Set of file paths currently saving metadata to SolidWorks file */
  savingConfigsToSW?: Set<string>
}

export interface UseFileOperationsReturn {
  handleDownload: (e: React.MouseEvent, file: LocalFile) => void
  handleCheckout: (e: React.MouseEvent, file: LocalFile) => void
  handleCheckin: (e: React.MouseEvent, file: LocalFile) => Promise<void>
  handleUpload: (e: React.MouseEvent, file: LocalFile) => void
  handleDiscard: (files: LocalFile[]) => void
  handleForceRelease: (files: LocalFile[]) => void
  handleSync: (files: LocalFile[]) => void
  handleMoveFiles: (filesToMove: LocalFile[], targetFolderPath: string) => Promise<void>
  selectedDownloadableFiles: LocalFile[]
  selectedCheckoutableFiles: LocalFile[]
  selectedCheckinableFiles: LocalFile[]
  selectedUploadableFiles: LocalFile[]
}

/**
 * Hook to manage file operations (checkout, checkin, download, upload, etc.)
 */
export function useFileOperations({
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
  savingConfigsToSW,
}: UseFileOperationsOptions): UseFileOperationsReturn {
  // Helper to check if any files are currently saving metadata
  const isAnySaving = useCallback(
    (filesToCheck: LocalFile[]): boolean => {
      if (!savingConfigsToSW || savingConfigsToSW.size === 0) return false
      return filesToCheck.some((f) => savingConfigsToSW.has(f.path))
    },
    [savingConfigsToSW],
  )

  // Calculate selected files that can be checked in (for multi-select check-in feature)
  // Exclude 'deleted' files - can't check in files that don't exist locally
  const selectedCheckinableFiles = useMemo(() => {
    if (selectedFiles.length <= 1) return []
    return files.filter(
      (f) =>
        selectedFiles.includes(f.path) &&
        !f.isDirectory &&
        f.pdmData?.checked_out_by === userId &&
        f.diffStatus !== 'deleted',
    )
  }, [files, selectedFiles, userId])

  // Calculate selected files that can be downloaded (for multi-select download feature)
  // Includes cloud files (to download) and outdated files (to update/sync)
  const selectedDownloadableFiles = useMemo(() => {
    if (selectedFiles.length <= 1) return []
    return files.filter(
      (f) =>
        selectedFiles.includes(f.path) &&
        !f.isDirectory &&
        (f.diffStatus === 'cloud' || f.diffStatus === 'outdated'),
    )
  }, [files, selectedFiles])

  // Calculate selected files that can be uploaded (for multi-select upload feature)
  const selectedUploadableFiles = useMemo(() => {
    if (selectedFiles.length <= 1) return []
    return files.filter(
      (f) =>
        selectedFiles.includes(f.path) &&
        !f.isDirectory &&
        !f.pdmData &&
        f.diffStatus !== 'cloud' &&
        f.diffStatus !== 'ignored',
    )
  }, [files, selectedFiles])

  // Calculate selected files that can be checked out (for multi-select checkout feature)
  // Exclude 'deleted' - files that were deleted locally while checked out
  const selectedCheckoutableFiles = useMemo(() => {
    if (selectedFiles.length <= 1) return []
    return files.filter(
      (f) =>
        selectedFiles.includes(f.path) &&
        !f.isDirectory &&
        f.pdmData &&
        !f.pdmData.checked_out_by &&
        f.diffStatus !== 'cloud' &&
        f.diffStatus !== 'deleted',
    )
  }, [files, selectedFiles])

  // Download files (cloud or outdated)
  const handleDownload = useCallback(
    (e: React.MouseEvent, file: LocalFile) => {
      e.stopPropagation()

      // Check if this is a multi-select download
      const isMultiSelect =
        selectedFiles.includes(file.path) && selectedDownloadableFiles.length > 1

      logFileAction(
        'Download file',
        isMultiSelect ? `${selectedDownloadableFiles.length} selected files` : file.relativePath,
      )

      if (isMultiSelect) {
        // Multi-select: properly separate outdated and cloud files
        const outdatedFiles = selectedDownloadableFiles.filter((f) => f.diffStatus === 'outdated')
        const cloudFiles = selectedDownloadableFiles.filter((f) => f.diffStatus === 'cloud')

        if (outdatedFiles.length > 0) {
          executeCommand('get-latest', { files: outdatedFiles }, { onRefresh })
        }
        if (cloudFiles.length > 0) {
          executeCommand('download', { files: cloudFiles }, { onRefresh })
        }
        resetHoverStates?.()
        return
      }

      // Single file/folder handling
      // For folders, check if they contain outdated files and use appropriate command
      if (file.isDirectory) {
        const filesInFolder = files.filter((f) =>
          f.relativePath.startsWith(file.relativePath + '/'),
        )
        const hasOutdated = filesInFolder.some((f) => f.diffStatus === 'outdated')
        const hasCloud = filesInFolder.some((f) => f.diffStatus === 'cloud')

        if (hasOutdated) {
          executeCommand('get-latest', { files: [file] }, { onRefresh })
        }
        if (hasCloud || file.diffStatus === 'cloud') {
          executeCommand('download', { files: [file] }, { onRefresh })
        }
      } else if (file.diffStatus === 'outdated') {
        // Use get-latest for outdated files
        executeCommand('get-latest', { files: [file] }, { onRefresh })
      } else {
        executeCommand('download', { files: [file] }, { onRefresh })
      }
      resetHoverStates?.()
    },
    [files, selectedFiles, selectedDownloadableFiles, onRefresh, resetHoverStates],
  )

  // Checkout files
  const handleCheckout = useCallback(
    (e: React.MouseEvent, file: LocalFile) => {
      e.stopPropagation()

      // Check if this is a multi-select checkout
      const isMultiSelect =
        selectedFiles.includes(file.path) && selectedCheckoutableFiles.length > 1
      const targetFiles = isMultiSelect ? selectedCheckoutableFiles : [file]

      logFileAction(
        'Checkout file',
        isMultiSelect ? `${targetFiles.length} selected files` : file.relativePath,
      )
      executeCommand('checkout', { files: targetFiles }, { onRefresh })
      resetHoverStates?.()
    },
    [selectedFiles, selectedCheckoutableFiles, onRefresh, resetHoverStates],
  )

  // Check in files
  const handleCheckin = useCallback(
    async (e: React.MouseEvent, file: LocalFile) => {
      e.stopPropagation()

      // Check if this is a multi-select check-in (clicking any selected file's check-in icon checks in all selected)
      const isMultiSelect = selectedFiles.includes(file.path) && selectedCheckinableFiles.length > 1
      const targetFiles = isMultiSelect ? selectedCheckinableFiles : [file]

      // Block if any files are currently saving metadata
      if (isAnySaving(targetFiles)) {
        addToast('warning', 'Please wait - file metadata is being saved')
        return
      }

      logFileAction(
        'Checkin file',
        isMultiSelect ? `${targetFiles.length} selected files` : file.relativePath,
      )

      // Get all files that would be checked in
      const filesToCheckin = getSyncedFilesFromSelection(files, targetFiles).filter(
        (f) => f.pdmData?.checked_out_by === userId,
      )

      // Check if any files are checked out on a different machine
      const filesOnDifferentMachine = filesToCheckin.filter((f) => {
        const checkoutMachineId = f.pdmData?.checked_out_by_machine_id
        return checkoutMachineId && currentMachineId && checkoutMachineId !== currentMachineId
      })

      if (filesOnDifferentMachine.length > 0 && userId) {
        // Get unique machine IDs from files on different machines
        const machineIds = [
          ...new Set(
            filesOnDifferentMachine
              .map((f) => f.pdmData?.checked_out_by_machine_id)
              .filter(Boolean),
          ),
        ] as string[]
        const machineNames = [
          ...new Set(
            filesOnDifferentMachine.map(
              (f) => f.pdmData?.checked_out_by_machine_name || 'another computer',
            ),
          ),
        ]
        const machineList = machineNames.join(', ')

        // Check if any of the other machines are online
        const onlineStatuses = await Promise.all(
          machineIds.map((mid) => isMachineOnline(userId, mid)),
        )
        const anyMachineOnline = onlineStatuses.some((isOnline) => isOnline)

        if (!anyMachineOnline) {
          // Other machine(s) are offline - block the operation
          setCustomConfirm({
            title: 'Cannot Check In - Machine Offline',
            message: `${filesOnDifferentMachine.length === 1 ? 'This file is' : `${filesOnDifferentMachine.length} files are`} checked out on ${machineList}, which is currently offline.`,
            warning:
              'You can only check in files from another machine when that machine is online. This ensures no unsaved work is lost. Please check in from the original computer, or wait for it to come online.',
            confirmText: 'OK',
            confirmDanger: false,
            onConfirm: () => setCustomConfirm(null),
          })
          return
        }

        // Other machine is online - show confirmation
        setCustomConfirm({
          title: 'Check In From Different Computer',
          message: `${filesOnDifferentMachine.length === 1 ? 'This file is' : `${filesOnDifferentMachine.length} files are`} checked out on ${machineList}. Are you sure you want to check in from here?`,
          warning: `The other computer${machineNames.length === 1 ? '' : 's'} will be notified and any unsaved changes there will be lost.`,
          confirmText: 'Force Check In',
          confirmDanger: true,
          onConfirm: () => {
            setCustomConfirm(null)
            executeCommand('checkin', { files: targetFiles }, { onRefresh })
          },
        })
        return
      }

      executeCommand('checkin', { files: targetFiles }, { onRefresh })

      // Reset hover state after check-in
      resetHoverStates?.()
    },
    [
      files,
      selectedFiles,
      selectedCheckinableFiles,
      userId,
      currentMachineId,
      onRefresh,
      addToast,
      setCustomConfirm,
      resetHoverStates,
      isAnySaving,
    ],
  )

  // Upload files (first check-in for local files)
  const handleUpload = useCallback(
    (e: React.MouseEvent, file: LocalFile) => {
      e.stopPropagation()

      // Check if this is a multi-select upload
      const isMultiSelect = selectedFiles.includes(file.path) && selectedUploadableFiles.length > 1
      const targetFiles = isMultiSelect ? selectedUploadableFiles : [file]

      logFileAction(
        'Upload/sync file',
        isMultiSelect ? `${targetFiles.length} selected files` : file.relativePath,
      )
      executeCommand('sync', { files: targetFiles }, { onRefresh })
      resetHoverStates?.()
    },
    [selectedFiles, selectedUploadableFiles, onRefresh, resetHoverStates],
  )

  // Discard local changes
  const handleDiscard = useCallback(
    (filesToDiscard: LocalFile[]) => {
      // Block if any files are currently saving metadata
      if (isAnySaving(filesToDiscard)) {
        addToast('warning', 'Please wait - file metadata is being saved')
        return
      }
      executeCommand('discard', { files: filesToDiscard }, { onRefresh })
    },
    [onRefresh, isAnySaving, addToast],
  )

  // Force release checkout (admin)
  const handleForceRelease = useCallback(
    (filesToRelease: LocalFile[]) => {
      executeCommand('force-release', { files: filesToRelease }, { onRefresh })
    },
    [onRefresh],
  )

  // Sync files
  const handleSync = useCallback(
    (filesToSync: LocalFile[]) => {
      executeCommand('sync', { files: filesToSync }, { onRefresh })
    },
    [onRefresh],
  )

  // Move files to a target folder
  const handleMoveFiles = useCallback(
    async (filesToMove: LocalFile[], targetFolderPath: string) => {
      if (!window.electronAPI || !vaultPath) return

      // Validate the drop - don't drop into itself
      const isDroppingIntoSelf = filesToMove.some(
        (f) =>
          f.isDirectory &&
          (targetFolderPath === f.relativePath ||
            targetFolderPath.startsWith(f.relativePath + '/')),
      )
      if (isDroppingIntoSelf) {
        addToast('error', 'Cannot move a folder into itself')
        return
      }

      // Don't move if already in target folder
      const wouldStayInPlace = filesToMove.every((f) => {
        const parentPath = f.relativePath.includes('/')
          ? f.relativePath.substring(0, f.relativePath.lastIndexOf('/'))
          : ''
        return parentPath === targetFolderPath
      })
      if (wouldStayInPlace) return

      // Register expected file changes to suppress file watcher during operation
      const expectedPaths: string[] = []
      for (const file of filesToMove) {
        expectedPaths.push(file.relativePath) // old path
        const newRelPath = targetFolderPath ? `${targetFolderPath}/${file.name}` : file.name
        expectedPaths.push(newRelPath) // new path
      }
      const releaseWatcher = beginWatcherSuppression(expectedPaths)

      try {
      // Perform the move
      const total = filesToMove.length
      const toastId = `move-${Date.now()}`
      addProgressToast(toastId, `Moving ${total} item${total > 1 ? 's' : ''}...`, total)

      let succeeded = 0
      let failed = 0

      for (let i = 0; i < filesToMove.length; i++) {
        const file = filesToMove[i]
        const newRelPath = targetFolderPath ? `${targetFolderPath}/${file.name}` : file.name
        const newFullPath = buildFullPath(vaultPath, newRelPath)

        addProcessingFolder(file.relativePath, 'sync')

        try {
          // For synced items, update server first
          if (userId) {
            if (file.isDirectory) {
              const folderResult = await updateFolderPath(
                file.relativePath,
                newRelPath,
                usePDMStore.getState().activeVaultId || undefined,
              )
              if (!folderResult.success) {
                failed++
                log.error('[FileOps]', 'Server folder move failed', { error: folderResult.error })
                addToast('error', folderResult.error || 'Failed to move folder on server')
                removeProcessingFolder(file.relativePath)
                updateProgressToast(toastId, i + 1, Math.round(((i + 1) / total) * 100))
                continue
              }
              if (file.pdmData?.id) {
                try {
                  await updateFolderServerPath(file.pdmData.id, newRelPath)
                  log.info('[FileOps]', 'Updated folder path on server', {
                    oldPath: file.relativePath,
                    newPath: newRelPath,
                  })
                } catch (error) {
                  log.warn('[FileOps]', 'Failed to update folder path on server', {
                    error: error instanceof Error ? error.message : String(error),
                  })
                }
              }
            } else if (file.pdmData?.id) {
              const serverResult = await moveFileOnServer(
                file.pdmData.id,
                userId,
                newRelPath,
                file.name,
              )
              if (!serverResult.success) {
                failed++
                log.error('[FileOps]', 'Server move failed', { error: serverResult.error })
                addToast('error', serverResult.error || 'Failed to move file on server')
                removeProcessingFolder(file.relativePath)
                updateProgressToast(toastId, i + 1, Math.round(((i + 1) / total) * 100))
                continue
              }
            }
          }

          // Collect nested synced files BEFORE renameFileInStore changes paths
          let nestedSyncedFiles: Array<{
            oldRelPath: string
            newRelPath: string
            pdmData: LocalFile['pdmData']
          }> = []
          if (file.isDirectory) {
            const nestedFiles = getFilesInFolder(files, file.relativePath)
            nestedSyncedFiles = nestedFiles
              .filter((f) => f.pdmData?.file_path)
              .map((f) => ({
                oldRelPath: f.relativePath,
                newRelPath: newRelPath + f.relativePath.substring(file.relativePath.length),
                pdmData: f.pdmData,
              }))
          }

          // Now perform local move
          const result = await window.electronAPI.moveFile(file.path, newFullPath)
          if (result.success) {
            succeeded++
            // Pass isMove=true so renameFileInStore treats newRelPath as a full relative path
            renameFileInStore(file.path, newFullPath, newRelPath, true)

            // Update nested files' pdmData.file_path to prevent ghost files
            if (file.isDirectory && nestedSyncedFiles.length > 0) {
              const { updateFilesInStore } = usePDMStore.getState()
              const sep = vaultPath.includes('\\') ? '\\' : '/'
              const pdmDataUpdates = nestedSyncedFiles.map((nested) => ({
                path: `${vaultPath}${sep}${nested.newRelPath.replace(/\//g, sep)}`,
                updates: {
                  pdmData: {
                    ...nested.pdmData,
                    file_path: nested.newRelPath,
                  },
                },
              }))
              updateFilesInStore(
                pdmDataUpdates as Array<{ path: string; updates: Partial<LocalFile> }>,
              )
              log.debug(
                '[FileOps]',
                'Updated nested files pdmData.file_path after drag-drop move',
                {
                  folderPath: file.relativePath,
                  updatedCount: pdmDataUpdates.length,
                },
              )
            }
          } else {
            failed++
            log.error('[FileOps]', 'Local move failed', { error: result.error })
          }
        } catch (error) {
          failed++
          log.error('[FileOps]', 'Move error', { error: error })
        }

        removeProcessingFolder(file.relativePath)
        updateProgressToast(toastId, i + 1, Math.round(((i + 1) / total) * 100))
      }

      removeToast(toastId)

      if (failed === 0) {
        addToast('success', `Moved ${succeeded} item${succeeded > 1 ? 's' : ''}`)
      } else if (succeeded === 0) {
        addToast('error', `Failed to move items`)
      } else {
        addToast('warning', `Moved ${succeeded}, failed ${failed}`)
      }

      // No need for full refresh - store is already updated
      } finally {
        // Re-stamps the suppression window and schedules the expected-changes clear.
        releaseWatcher()
      }
    },
    [
      vaultPath,
      files,
      userId,
      addToast,
      addProgressToast,
      updateProgressToast,
      removeToast,
      addProcessingFolder,
      removeProcessingFolder,
      renameFileInStore,
    ],
  )

  return {
    handleDownload,
    handleCheckout,
    handleCheckin,
    handleUpload,
    handleDiscard,
    handleForceRelease,
    handleSync,
    handleMoveFiles,
    selectedDownloadableFiles,
    selectedCheckoutableFiles,
    selectedCheckinableFiles,
    selectedUploadableFiles,
  }
}
