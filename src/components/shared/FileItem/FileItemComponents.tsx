/**
 * Shared file/folder item components and utilities
 * Extracted from FileTree.tsx to provide consistent rendering across views
 *
 * FileTree is the reference implementation - any changes should be made there first
 * and then reflected here.
 */

import { useMemo, memo } from 'react'
import {
  FolderOpen,
  File,
  FileBox,
  FileText,
  Layers,
  FileImage,
  FileSpreadsheet,
  FileArchive,
  FileCode,
  Cpu,
  FileType,
  FilePen,
  Loader2,
} from 'lucide-react'
import { LocalFile } from '@/stores/pdmStore'
import { getFileIconType, getInitials, getAvatarColor } from '@/lib/utils'
import { buildThumbnailUrl } from '@/lib/thumbnailUrl'
import { useRetryableImage } from '@/hooks/useRetryableImage'

// ============================================================================
// FILE ICON - Loads OS thumbnail with fallback to type-based icons
// This is the canonical icon component - matches FileTree exactly
// ============================================================================

export interface FileIconProps {
  file: LocalFile
  size?: number
  className?: string
}

/**
 * File icon component with thumbnail support
 * - Loads SolidWorks thumbnails for supported files
 * - Falls back to extension-based icons
 * - Matches FileTree styling exactly
 *
 * Thumbnails render at every row size. There is deliberately no size gate here:
 * this component backs the virtualized list and tree, where the browser fetches
 * lazily for visible rows only and each file version is fetched at most once,
 * so a small row costs nothing to show a preview in. The extension check inside
 * buildThumbnailUrl is what keeps non-CAD files from ever making a request.
 */
export const FileIcon = memo(function FileIcon({ file, size = 16, className = '' }: FileIconProps) {
  const thumbnailUrl = useMemo(() => buildThumbnailUrl(file, 'grid'), [file])

  const { src, onError } = useRetryableImage(thumbnailUrl)

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={`flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
        loading="lazy"
        decoding="async"
        onError={onError}
      />
    )
  }

  // Fallback to React icons based on file type
  return <FileTypeIcon extension={file.extension} size={size} className={className} />
})

// ============================================================================
// FILE TYPE ICON - Extension-based icon without thumbnail loading
// Use this when you don't need thumbnails (e.g., list views at small sizes)
// ============================================================================

export interface FileTypeIconProps {
  extension: string
  size?: number
  className?: string
}

/**
 * Simple extension-based icon without thumbnail loading
 * Useful for performance when thumbnails aren't needed
 */
export function FileTypeIcon({ extension, size = 16, className = '' }: FileTypeIconProps) {
  const iconType = getFileIconType(extension)
  const baseClass = `flex-shrink-0 ${className}`

  switch (iconType) {
    case 'part':
      return <FileBox size={size} className={`text-plm-accent ${baseClass}`} />
    case 'assembly':
      return <Layers size={size} className={`text-amber-400 ${baseClass}`} />
    case 'drawing':
      return <FilePen size={size} className={`text-sky-300 ${baseClass}`} />
    case 'step':
      return <FileBox size={size} className={`text-orange-400 ${baseClass}`} />
    case 'pdf':
      return <FileType size={size} className={`text-red-400 ${baseClass}`} />
    case 'image':
      return <FileImage size={size} className={`text-purple-400 ${baseClass}`} />
    case 'spreadsheet':
      return <FileSpreadsheet size={size} className={`text-green-400 ${baseClass}`} />
    case 'archive':
      return <FileArchive size={size} className={`text-yellow-500 ${baseClass}`} />
    case 'schematic':
      return <Cpu size={size} className={`text-red-400 ${baseClass}`} />
    case 'library':
      return <Cpu size={size} className={`text-violet-400 ${baseClass}`} />
    case 'pcb':
      return <Cpu size={size} className={`text-emerald-400 ${baseClass}`} />
    case 'code':
      return <FileCode size={size} className={`text-sky-400 ${baseClass}`} />
    case 'text':
      return <FileText size={size} className={`text-plm-fg-muted ${baseClass}`} />
    default:
      return <File size={size} className={`text-plm-fg-muted ${baseClass}`} />
  }
}

// ============================================================================
// FOLDER UTILITIES - Checkout status, sync status, icon colors
// ============================================================================

export type FolderCheckoutStatus = 'mine' | 'others' | 'both' | null

// ============================================================================
// FOLDER VISUAL STATE - Priority-based folder icon color and text styling
// ============================================================================

/**
 * Folder visual state computed from priority-based file status
 */
export interface FolderVisualState {
  /** Tailwind color class for the folder icon */
  iconColor: string
  /** Whether folder text should be normal (true) or italic/muted (false) */
  isSynced: boolean
}

/**
 * Compute folder visual state based on file status priority.
 *
 * Priority order (highest to lowest):
 * 1. Local-only files -> Grey icon + italic text
 * 2. Server-only (cloud) files -> Grey icon + italic text
 * 3. Synced files -> Green icon + normal text
 * 4. My checkouts -> Orange icon + normal text
 * 5. Others' checkouts -> Red icon + normal text
 *
 * Higher priority states always win when present. For example:
 * - If any local-only files exist, folder shows grey regardless of other states
 * - If any synced files exist (and no local-only/server-only), folder shows green
 *   even if other files are checked out
 *
 * @param hasLocalOnly - Whether folder has any local-only (unsynced) files
 * @param hasServerOnly - Whether folder has any server-only (cloud) files
 * @param hasSynced - Whether folder has any synced files (not checked out)
 * @param hasMineCheckouts - Whether folder has any files checked out by current user
 * @param hasOthersCheckouts - Whether folder has any files checked out by others
 * @returns FolderVisualState with iconColor and isSynced
 */
export function computeFolderVisualState(
  hasLocalOnly: boolean,
  hasServerOnly: boolean,
  hasSynced: boolean,
  hasMineCheckouts: boolean,
  hasOthersCheckouts: boolean,
): FolderVisualState {
  // Priority 1: Local-only files -> grey, not synced
  if (hasLocalOnly) {
    return { iconColor: 'text-plm-fg-muted', isSynced: false }
  }

  // Priority 2: Server-only (cloud) files -> grey, not synced
  if (hasServerOnly) {
    return { iconColor: 'text-plm-fg-muted', isSynced: false }
  }

  // Priority 3: Synced files -> green, synced (wins over checkouts)
  if (hasSynced) {
    return { iconColor: 'text-plm-success', isSynced: true }
  }

  // Priority 4: My checkouts -> orange, synced
  if (hasMineCheckouts) {
    return { iconColor: 'text-orange-400', isSynced: true }
  }

  // Priority 5: Others' checkouts -> red, synced
  if (hasOthersCheckouts) {
    return { iconColor: 'text-plm-error', isSynced: true }
  }

  // Empty folder or only has ignored files -> grey, not synced
  return { iconColor: 'text-plm-fg-muted', isSynced: false }
}

/**
 * Get folder checkout status based on files inside
 * @returns 'mine' | 'others' | 'both' | null
 */
export function getFolderCheckoutStatus(
  folderPath: string,
  allFiles: LocalFile[],
  userId?: string,
): FolderCheckoutStatus {
  // Exclude 'deleted' files - they don't exist locally (were deleted while checked out)
  // These should be treated like cloud files, not synced/local files
  const serverOnlyStatuses = ['cloud', 'deleted']
  const folderFiles = allFiles.filter(
    (f) =>
      !f.isDirectory &&
      f.relativePath.startsWith(folderPath + '/') &&
      !serverOnlyStatuses.includes(f.diffStatus || ''),
  )
  const checkedOutByMe = folderFiles.some((f) => f.pdmData?.checked_out_by === userId)
  const checkedOutByOthers = folderFiles.some(
    (f) => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== userId,
  )

  if (checkedOutByMe && checkedOutByOthers) return 'both'
  if (checkedOutByMe) return 'mine'
  if (checkedOutByOthers) return 'others'
  return null
}

/**
 * Check if all files in a folder are truly synced (not just content-matched)
 * Excludes 'deleted' files as they don't exist locally
 */
export function isFolderSynced(folderPath: string, allFiles: LocalFile[]): boolean {
  // Exclude files that only exist on server (not locally)
  const serverOnlyStatuses = ['cloud', 'deleted']
  const folderFiles = allFiles.filter(
    (f) =>
      !f.isDirectory &&
      f.relativePath.startsWith(folderPath + '/') &&
      !serverOnlyStatuses.includes(f.diffStatus || ''),
  )
  if (folderFiles.length === 0) return false
  // Only consider synced if ALL local files have pdmData AND none are marked as 'added'
  return folderFiles.every((f) => !!f.pdmData && f.diffStatus !== 'added')
}

/**
 * Get the Tailwind color class for a folder icon
 * Uses priority-based logic where higher priority states win.
 *
 * Priority order (highest to lowest):
 * 1. Local-only files -> grey
 * 2. Server-only (cloud) files -> grey
 * 3. Synced files -> green (wins over checkouts)
 * 4. My checkouts -> orange
 * 5. Others' checkouts -> red
 *
 * Note: Folder color is derived from computed metrics, not from the folder entry's
 * own diffStatus. This ensures the icon updates immediately when files change.
 */
export function getFolderIconColor(
  file: LocalFile,
  allFiles: LocalFile[],
  userId?: string,
): string {
  if (!file.isDirectory) return ''

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

// ============================================================================
// CHECKOUT USER INFO - For avatars and check-in buttons
// ============================================================================

export interface CheckoutUser {
  id: string
  name: string
  email?: string
  avatar_url?: string
  isMe: boolean
  isDifferentMachine?: boolean
  machineName?: string
  /** For folders: list of file IDs this user has checked out (for notifications) */
  fileIds?: string[]
}

/**
 * Get unique users with checkouts in a folder
 */
export function getFolderCheckoutUsers(
  folderPath: string,
  allFiles: LocalFile[],
  userId?: string,
  userFullName?: string,
  userEmail?: string,
  userAvatarUrl?: string,
): CheckoutUser[] {
  const folderFiles = allFiles.filter(
    (f) =>
      !f.isDirectory && f.pdmData?.checked_out_by && f.relativePath.startsWith(folderPath + '/'),
  )

  // Collect unique users
  const usersMap = new Map<string, CheckoutUser>()

  for (const f of folderFiles) {
    const checkoutUserId = f.pdmData!.checked_out_by!
    if (!usersMap.has(checkoutUserId)) {
      const isMe = checkoutUserId === userId
      if (isMe) {
        usersMap.set(checkoutUserId, {
          id: checkoutUserId,
          name: userFullName || userEmail || 'You',
          email: userEmail,
          avatar_url: userAvatarUrl,
          isMe: true,
        })
      } else {
        const checkedOutUser = (f.pdmData as any).checked_out_user // TODO: type this
        usersMap.set(checkoutUserId, {
          id: checkoutUserId,
          name: checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'Someone',
          email: checkedOutUser?.email,
          avatar_url: checkedOutUser?.avatar_url,
          isMe: false,
        })
      }
    }
  }

  // Sort so "me" comes first
  return Array.from(usersMap.values()).sort((a, b) => {
    if (a.isMe && !b.isMe) return -1
    if (!a.isMe && b.isMe) return 1
    return 0
  })
}

/**
 * Get checkout user(s) for a single file
 */
export function getFileCheckoutUser(
  file: LocalFile,
  userId?: string,
  userFullName?: string,
  userEmail?: string,
  userAvatarUrl?: string,
  currentMachineId?: string | null,
): CheckoutUser | null {
  if (!file.pdmData?.checked_out_by) return null

  const isMe = file.pdmData.checked_out_by === userId
  const checkoutMachineId = file.pdmData.checked_out_by_machine_id
  const checkoutMachineName = file.pdmData.checked_out_by_machine_name
  const isDifferentMachine =
    isMe && checkoutMachineId && currentMachineId && checkoutMachineId !== currentMachineId

  if (isMe) {
    return {
      id: file.pdmData.checked_out_by,
      name: userFullName || userEmail || 'You',
      avatar_url: userAvatarUrl,
      isMe: true,
      isDifferentMachine: isDifferentMachine || false,
      machineName: checkoutMachineName ?? undefined,
    }
  } else {
    const checkedOutUser = (file.pdmData as any).checked_out_user // TODO: type this
    return {
      id: file.pdmData.checked_out_by,
      name: checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'Someone',
      avatar_url: checkedOutUser?.avatar_url,
      isMe: false,
    }
  }
}

// ============================================================================
// CHECKOUT AVATARS - Avatar display component
// ============================================================================

export interface CheckoutAvatarsProps {
  users: CheckoutUser[]
  size?: number
  maxAvatars?: number
  className?: string
}

/**
 * Stacked avatar display for checkout users
 * Shows up to maxAvatars with overflow indicator
 */
export function CheckoutAvatars({
  users,
  size = 20,
  maxAvatars = 3,
  className = '',
}: CheckoutAvatarsProps) {
  if (users.length === 0) return null

  const displayedUsers = users.slice(0, maxAvatars)
  const hasOverflow = users.length > maxAvatars
  const fontSize = Math.max(8, size * 0.45)

  return (
    <div className={`flex -space-x-1 ${className}`} title={users.map((u) => u.name).join(', ')}>
      {displayedUsers.map((u) => (
        <div
          key={u.id}
          className="relative rounded-full overflow-hidden flex-shrink-0"
          style={{ width: size, height: size }}
          title={
            u.isDifferentMachine && u.machineName
              ? `Checked out on ${u.machineName} (different computer)`
              : u.name
          }
        >
          {u.avatar_url ? (
            <img
              src={u.avatar_url}
              alt={u.name}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
              onError={(e) => {
                const target = e.target as HTMLImageElement
                target.style.display = 'none'
                target.nextElementSibling?.classList.remove('hidden')
              }}
            />
          ) : null}
          {(() => {
            const avatarColors = getAvatarColor(u.email || u.name)
            return (
              <div
                className={`w-full h-full flex items-center justify-center font-medium ${
                  u.isMe && u.isDifferentMachine
                    ? 'bg-plm-warning/50 text-plm-warning'
                    : `${avatarColors.bg} ${avatarColors.text}`
                } ${u.avatar_url ? 'hidden' : ''}`}
                style={{ fontSize }}
              >
                {getInitials(u.name)}
              </div>
            )
          })()}
        </div>
      ))}
      {hasOverflow && (
        <div
          className="rounded-full bg-plm-bg-light flex items-center justify-center text-plm-fg-muted flex-shrink-0"
          style={{ width: size, height: size, fontSize: fontSize * 0.8 }}
        >
          +{users.length - maxAvatars}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// FILE ITEM ICON - Complete icon rendering for file/folder items
// Includes folder colors, processing states, and cloud status
// ============================================================================

export interface FileItemIconProps {
  file: LocalFile
  allFiles: LocalFile[]
  size?: number
  userId?: string
  isProcessing?: boolean
}

/**
 * Complete file/folder icon with all status indicators
 * Handles folders with checkout/sync colors, cloud-only items, and processing states
 */
export function FileItemIcon({
  file,
  allFiles,
  size = 16,
  userId,
  isProcessing = false,
}: FileItemIconProps) {
  // Processing state
  if (isProcessing) {
    return <Loader2 size={size} className="text-sky-400 animate-spin" />
  }

  // Folder icon
  if (file.isDirectory) {
    // Cloud-only folders (exist on server but not locally)
    if (file.diffStatus === 'cloud') {
      return <FolderOpen size={size} className="text-plm-fg-muted opacity-50" />
    }
    const folderColor = getFolderIconColor(file, allFiles, userId)
    return <FolderOpen size={size} className={folderColor || 'text-plm-fg-muted'} />
  }

  // File icon with thumbnail support
  return <FileIcon file={file} size={size} />
}

// ============================================================================
// STATUS ICON - Lock/avatar/cloud for checked out files
// ============================================================================

export interface StatusIconProps {
  file: LocalFile
  userId?: string
  size?: number
}

/**
 * Status icon for files (avatar for checked out by others)
 * Returns null for files checked out by me (shown in check-in button instead)
 */
export function StatusIcon({ file, userId, size = 12 }: StatusIconProps) {
  // For folders - status is shown via folder icon color
  if (file.isDirectory) return null

  // Checked out by me - don't show avatar here, it's shown in the check-in button
  if (file.pdmData?.checked_out_by === userId) return null

  // Checked out by someone else - show their avatar
  if (file.pdmData?.checked_out_by) {
    const checkedOutUser = (file.pdmData as any).checked_out_user // TODO: type this
    const avatarUrl = checkedOutUser?.avatar_url
    const displayName =
      checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'Someone'

    const avatarSize = Math.max(16, size * 1.5)
    const fontSize = Math.max(8, avatarSize * 0.45)

    const avatarColors = getAvatarColor(checkedOutUser?.email || displayName)

    return (
      <div
        className="relative flex-shrink-0"
        style={{ width: avatarSize, height: avatarSize }}
        title={`Checked out by ${displayName}`}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={displayName}
            className="w-full h-full rounded-full object-cover"
            referrerPolicy="no-referrer"
            onError={(e) => {
              const target = e.target as HTMLImageElement
              target.style.display = 'none'
              target.nextElementSibling?.classList.remove('hidden')
            }}
          />
        ) : null}
        <div
          className={`w-full h-full rounded-full ${avatarColors.bg} ${avatarColors.text} flex items-center justify-center font-medium absolute inset-0 ${avatarUrl ? 'hidden' : ''}`}
          style={{ fontSize }}
        >
          {getInitials(displayName)}
        </div>
      </div>
    )
  }

  return null
}

// ============================================================================
// FOLDER COUNT UTILITIES - Cloud files, local-only files, etc.
// ============================================================================

/**
 * Get count of cloud-only files in a folder
 */
export function getCloudFilesCount(folderPath: string, allFiles: LocalFile[]): number {
  return allFiles.filter(
    (f) =>
      !f.isDirectory && f.diffStatus === 'cloud' && f.relativePath.startsWith(folderPath + '/'),
  ).length
}

/**
 * Get count of new cloud files in a folder (deprecated - cloud_new no longer used)
 * @deprecated Use getCloudFilesCount instead
 */
export function getCloudNewFilesCount(_folderPath: string, _allFiles: LocalFile[]): number {
  return 0 // cloud_new status no longer exists
}

/**
 * Get count of local-only (unsynced) files in a folder
 */
export function getLocalOnlyFilesCount(folderPath: string, allFiles: LocalFile[]): number {
  return allFiles.filter(
    (f) =>
      !f.isDirectory &&
      (!f.pdmData || f.diffStatus === 'added') &&
      f.diffStatus !== 'cloud' &&
      f.diffStatus !== 'ignored' &&
      f.relativePath.startsWith(folderPath + '/'),
  ).length
}

/**
 * Get count of synced files that can be checked out in a folder
 */
export function getSyncedCheckoutableCount(folderPath: string, allFiles: LocalFile[]): number {
  return allFiles.filter(
    (f) =>
      !f.isDirectory &&
      f.pdmData &&
      !f.pdmData.checked_out_by &&
      f.diffStatus !== 'cloud' &&
      f.relativePath.startsWith(folderPath + '/'),
  ).length
}

/**
 * Get count of files checked out by a specific user in a folder
 */
export function getMyCheckedOutCount(
  folderPath: string,
  allFiles: LocalFile[],
  userId?: string,
): number {
  return allFiles.filter(
    (f) =>
      !f.isDirectory &&
      f.pdmData?.checked_out_by === userId &&
      f.relativePath.startsWith(folderPath + '/'),
  ).length
}

/**
 * Get total count of checked out files in a folder
 */
export function getTotalCheckoutCount(folderPath: string, allFiles: LocalFile[]): number {
  return allFiles.filter(
    (f) =>
      !f.isDirectory && f.pdmData?.checked_out_by && f.relativePath.startsWith(folderPath + '/'),
  ).length
}
