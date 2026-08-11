import { useMemo } from 'react'
import type { LocalFile } from '@/stores/pdmStore'
import { usePDMStore } from '@/stores/pdmStore'
import type { OperationType } from '@/stores/types'
import { computeFolderVisualState } from '@/components/shared/FileItem'
import {
  getCheckoutDisplayUser,
  type CheckoutDisplayUser,
} from '@/lib/checkout/checkoutDisplay'

export interface CheckoutUser extends CheckoutDisplayUser {
  isDifferentMachine?: boolean
  machineName?: string
  /** For folders: list of file IDs this user has checked out */
  fileIds?: string[]
}

export interface UseFileCardStatusParams {
  file: LocalFile
  allFiles: LocalFile[]
  userId: string | undefined
  userFullName: string | undefined
  userEmail: string | undefined
  userAvatarUrl: string | undefined
  currentMachineId: string | null
  processingPaths: Map<string, OperationType>
}

export interface FileCardStatus {
  isProcessing: boolean
  operationType: OperationType | null
  cloudFilesCount: number
  localOnlyFilesCount: number
  checkoutUsers: CheckoutUser[]
  diffClass: string
  folderIconColor: string
  folderCheckoutInfo: FolderCheckoutInfo | null
}

export interface FolderCheckoutInfo {
  checkedOutByMe: number
  checkedOutByOthers: number
  syncedNotCheckedOut: number
  localOnly: number
}

/**
 * Get the operation type for a file path if it's being processed
 * Spinners propagate DOWN to children, not UP to parents
 */
function getProcessingOperation(
  processingPaths: Map<string, OperationType>,
  filePath: string,
  _isDirectory: boolean = false,
): OperationType | null {
  const normalizedPath = filePath.replace(/\\/g, '/')

  if (processingPaths.has(filePath)) return processingPaths.get(filePath)!
  if (processingPaths.has(normalizedPath)) return processingPaths.get(normalizedPath)!

  // Check if THIS path is INSIDE any processing folder (downward propagation)
  for (const [processingPath, opType] of processingPaths) {
    const normalizedProcessingPath = processingPath.replace(/\\/g, '/')
    if (normalizedPath.startsWith(normalizedProcessingPath + '/')) return opType
  }
  return null
}

/**
 * Get diff class color for the card border/background
 */
function getDiffClass(diffStatus: string | undefined): string {
  if (diffStatus === 'modified') return 'ring-1 ring-yellow-500/50 bg-yellow-500/5'
  if (diffStatus === 'moved') return 'ring-1 ring-blue-500/50 bg-blue-500/5'
  if (diffStatus === 'deleted') return 'ring-1 ring-red-500/50 bg-red-500/5'
  if (diffStatus === 'outdated') return 'ring-1 ring-purple-500/50 bg-purple-500/5'
  if (diffStatus === 'cloud') return 'ring-1 ring-plm-fg-muted/30 bg-plm-fg-muted/5'
  return ''
}

/**
 * Get cloud files count for folders
 */
function getCloudFilesCount(file: LocalFile, allFiles: LocalFile[]): number {
  if (!file.isDirectory) return 0
  const folderPrefix = file.relativePath + '/'
  return allFiles.filter(
    (f) => !f.isDirectory && f.diffStatus === 'cloud' && f.relativePath.startsWith(folderPrefix),
  ).length
}

/**
 * Get local-only files count for folders
 */
function getLocalOnlyFilesCount(file: LocalFile, allFiles: LocalFile[]): number {
  if (!file.isDirectory) return 0
  const folderPrefix = file.relativePath + '/'
  return allFiles.filter(
    (f) =>
      !f.isDirectory &&
      (!f.pdmData || f.diffStatus === 'added') &&
      f.diffStatus !== 'cloud' &&
      f.diffStatus !== 'ignored' &&
      f.relativePath.startsWith(folderPrefix),
  ).length
}

/**
 * Get checkout users for file/folder
 */
function getCheckoutUsers(
  file: LocalFile,
  allFiles: LocalFile[],
  userId: string | undefined,
  userFullName: string | undefined,
  userEmail: string | undefined,
  userAvatarUrl: string | undefined,
  currentMachineId: string | null,
  checkoutHydration: ReturnType<typeof usePDMStore.getState>['checkoutHydration'],
): CheckoutUser[] {
  const currentUser = userId
    ? {
        id: userId,
        full_name: userFullName,
        email: userEmail,
        avatar_url: userAvatarUrl,
      }
    : null

  if (file.isDirectory) {
    const folderPrefix = file.relativePath + '/'
    const folderFiles = allFiles.filter(
      (f) =>
        !f.isDirectory &&
        f.pdmData?.checked_out_by &&
        f.pdmData?.id &&
        f.relativePath.startsWith(folderPrefix),
    )

    const usersMap = new Map<string, CheckoutUser>()
    const userFileIds = new Map<string, string[]>()

    for (const f of folderFiles) {
      const checkoutUserId = f.pdmData!.checked_out_by!
      const fileId = f.pdmData!.id

      // Track file IDs per user
      if (!userFileIds.has(checkoutUserId)) {
        userFileIds.set(checkoutUserId, [])
      }
      userFileIds.get(checkoutUserId)!.push(fileId)

      if (!usersMap.has(checkoutUserId)) {
        const displayUser = getCheckoutDisplayUser(
          f,
          currentUser,
          f.pdmData?.id ? checkoutHydration[f.pdmData.id]?.state : undefined,
        )
        if (
          !displayUser ||
          (displayUser.displayState !== 'mine' && displayUser.displayState !== 'resolved')
        ) {
          continue
        }

        const isMe = displayUser.isMe
        const checkoutMachineId = f.pdmData?.checked_out_by_machine_id
        const checkoutMachineName = f.pdmData?.checked_out_by_machine_name
        const isDifferentMachine =
          isMe && checkoutMachineId && currentMachineId && checkoutMachineId !== currentMachineId

        usersMap.set(checkoutUserId, {
          ...displayUser,
          isDifferentMachine: Boolean(isDifferentMachine),
          machineName: checkoutMachineName ?? undefined,
          fileIds: [], // Will be filled below
        })
      }
    }

    // Attach file IDs to each user
    const users = Array.from(usersMap.values())
    for (const user of users) {
      user.fileIds = userFileIds.get(user.id) || []
    }

    return users
  } else if (file.pdmData?.checked_out_by) {
    const displayUser = getCheckoutDisplayUser(
      file,
      currentUser,
      file.pdmData.id ? checkoutHydration[file.pdmData.id]?.state : undefined,
    )
    if (!displayUser) return []

    const isMe = displayUser.isMe
    const checkoutMachineId = file.pdmData.checked_out_by_machine_id
    const checkoutMachineName = file.pdmData.checked_out_by_machine_name
    const isDifferentMachine =
      isMe && checkoutMachineId && currentMachineId && checkoutMachineId !== currentMachineId

    return [
      {
        ...displayUser,
        isDifferentMachine: Boolean(isDifferentMachine),
        machineName: checkoutMachineName ?? undefined,
      },
    ]
  }
  return []
}

/**
 * Get folder icon color using priority-based logic.
 *
 * Priority order (highest to lowest):
 * 1. Local-only files -> grey
 * 2. Server-only (cloud) files -> grey
 * 3. Synced files -> green (wins over checkouts)
 * 4. My checkouts -> orange
 * 5. Others' checkouts -> red
 */
function getFolderIconColor(
  file: LocalFile,
  allFiles: LocalFile[],
  userId: string | undefined,
): string {
  if (!file.isDirectory) return ''

  if (file.diffStatus === 'cloud') return 'text-plm-fg-muted opacity-50'

  const folderPath = file.relativePath.replace(/\\/g, '/')
  const folderPrefix = folderPath + '/'

  // Compute file counts for priority logic
  let hasLocalOnly = false
  let hasServerOnly = false
  let hasSynced = false
  let hasMineCheckouts = false
  let hasOthersCheckouts = false

  for (const f of allFiles) {
    if (f.isDirectory) continue
    const filePath = f.relativePath.replace(/\\/g, '/')
    if (!filePath.startsWith(folderPrefix)) continue

    // Server-only files (cloud)
    if (f.diffStatus === 'cloud') {
      hasServerOnly = true
      continue
    }

    // Skip deleted files (server-only status)
    if (f.diffStatus === 'deleted') continue

    // Local-only files (no pdmData or added status)
    if (!f.pdmData || f.diffStatus === 'added') {
      if (f.diffStatus !== 'ignored') {
        hasLocalOnly = true
      }
      continue
    }

    // Files with pdmData - check checkout status
    if (f.pdmData.checked_out_by === userId) {
      hasMineCheckouts = true
    } else if (f.pdmData.checked_out_by) {
      hasOthersCheckouts = true
    } else {
      // Has pdmData, not checked out = synced
      hasSynced = true
    }
  }

  const visualState = computeFolderVisualState(
    hasLocalOnly,
    hasServerOnly,
    hasSynced,
    hasMineCheckouts,
    hasOthersCheckouts,
  )

  return visualState.iconColor
}

/**
 * Get folder checkout info
 */
function getFolderCheckoutInfo(
  file: LocalFile,
  allFiles: LocalFile[],
  userId: string | undefined,
): FolderCheckoutInfo | null {
  if (!file.isDirectory) return null

  const folderPath = file.relativePath.replace(/\\/g, '/')
  const folderPrefix = folderPath + '/'
  const folderFiles = allFiles.filter((f) => {
    if (f.isDirectory) return false
    const filePath = f.relativePath.replace(/\\/g, '/')
    return filePath.startsWith(folderPrefix)
  })

  const serverOnlyStatuses = ['cloud', 'deleted']
  const localFiles = folderFiles.filter((f) => !serverOnlyStatuses.includes(f.diffStatus || ''))
  const checkedOutByMe = localFiles.filter((f) => f.pdmData?.checked_out_by === userId).length
  const checkedOutByOthers = localFiles.filter(
    (f) => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== userId,
  ).length
  const syncedNotCheckedOut = localFiles.filter(
    (f) => f.pdmData && !f.pdmData.checked_out_by,
  ).length
  const localOnly = localFiles.filter((f) => !f.pdmData).length

  return { checkedOutByMe, checkedOutByOthers, syncedNotCheckedOut, localOnly }
}

/**
 * Hook to compute all file card status information
 */
export function useFileCardStatus({
  file,
  allFiles,
  userId,
  userFullName,
  userEmail,
  userAvatarUrl,
  currentMachineId,
  processingPaths,
}: UseFileCardStatusParams): FileCardStatus {
  const checkoutHydration = usePDMStore((state) => state.checkoutHydration)

  return useMemo(() => {
    const operationType = getProcessingOperation(
      processingPaths,
      file.relativePath,
      file.isDirectory,
    )
    const isProcessing = operationType !== null
    const diffClass = getDiffClass(file.diffStatus)
    const cloudFilesCount = getCloudFilesCount(file, allFiles)
    const localOnlyFilesCount = getLocalOnlyFilesCount(file, allFiles)
    const checkoutUsers = getCheckoutUsers(
      file,
      allFiles,
      userId,
      userFullName,
      userEmail,
      userAvatarUrl,
      currentMachineId,
      checkoutHydration,
    )
    const folderIconColor = getFolderIconColor(file, allFiles, userId)
    const folderCheckoutInfo = getFolderCheckoutInfo(file, allFiles, userId)

    return {
      isProcessing,
      operationType,
      cloudFilesCount,
      localOnlyFilesCount,
      checkoutUsers,
      diffClass,
      folderIconColor,
      folderCheckoutInfo,
    }
  }, [
    file,
    allFiles,
    userId,
    userFullName,
    userEmail,
    userAvatarUrl,
    currentMachineId,
    processingPaths,
    checkoutHydration,
  ])
}
