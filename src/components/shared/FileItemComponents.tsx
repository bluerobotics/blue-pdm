/**
 * Shared file/folder item components and utilities
 * Extracted from ExplorerView.tsx to provide consistent rendering across views
 * 
 * ExplorerView is the reference implementation - any changes should be made there first
 * and then reflected here.
 */

import { useState, useEffect, memo } from 'react'
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
  Loader2
} from 'lucide-react'
import { LocalFile } from '../../stores/pdmStore'
import { getFileIconType, getInitials } from '../../types/pdm'

// ============================================================================
// FILE ICON - Loads OS thumbnail with fallback to type-based icons
// This is the canonical icon component - matches ExplorerView exactly
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
 * - Matches ExplorerView styling exactly
 */
export const FileIcon = memo(function FileIcon({ file, size = 16, className = '' }: FileIconProps) {
  const [icon, setIcon] = useState<string | null>(null)
  
  useEffect(() => {
    if (file.isDirectory || !file.path) {
      setIcon(null)
      return
    }
    
    let cancelled = false
    
    const loadIcon = async () => {
      try {
        const result = await window.electronAPI?.extractSolidWorksThumbnail(file.path)
        if (!cancelled && result?.success && result.data) {
          setIcon(result.data)
        }
      } catch {
        // Silently fail - will show default icon
      }
    }
    
    loadIcon()
    
    return () => { cancelled = true }
  }, [file.path, file.isDirectory])
  
  // Show OS icon if available
  if (icon) {
    return (
      <img 
        src={icon} 
        alt=""
        className={`flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
        onError={() => setIcon(null)}
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

/**
 * Get folder checkout status based on files inside
 * @returns 'mine' | 'others' | 'both' | null
 */
export function getFolderCheckoutStatus(
  folderPath: string, 
  allFiles: LocalFile[], 
  userId?: string
): FolderCheckoutStatus {
  const folderFiles = allFiles.filter(f => 
    !f.isDirectory && 
    f.relativePath.startsWith(folderPath + '/')
  )
  const checkedOutByMe = folderFiles.some(f => f.pdmData?.checked_out_by === userId)
  const checkedOutByOthers = folderFiles.some(f => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== userId)
  
  if (checkedOutByMe && checkedOutByOthers) return 'both'
  if (checkedOutByMe) return 'mine'
  if (checkedOutByOthers) return 'others'
  return null
}

/**
 * Check if all files in a folder are truly synced (not just content-matched)
 */
export function isFolderSynced(folderPath: string, allFiles: LocalFile[]): boolean {
  const folderFiles = allFiles.filter(f => 
    !f.isDirectory && 
    f.relativePath.startsWith(folderPath + '/')
  )
  if (folderFiles.length === 0) return false
  // Only consider synced if ALL files have pdmData AND none are marked as 'added'
  return folderFiles.every(f => !!f.pdmData && f.diffStatus !== 'added')
}

/**
 * Get the Tailwind color class for a folder icon
 * Based on checkout status and sync status
 */
export function getFolderIconColor(
  file: LocalFile,
  allFiles: LocalFile[],
  userId?: string
): string {
  if (!file.isDirectory) return ''
  
  // Cloud-only folders (exist on server but not locally) - grey and faded
  if (file.diffStatus === 'cloud') return 'text-plm-fg-muted opacity-50'
  
  const checkoutStatus = getFolderCheckoutStatus(file.relativePath, allFiles, userId)
  
  // Red for folders with files checked out by others
  if (checkoutStatus === 'others' || checkoutStatus === 'both') {
    return 'text-plm-error'
  }
  
  // Vibrant orange for folders with only my checkouts (matches lock icon)
  if (checkoutStatus === 'mine') {
    return 'text-orange-400'
  }
  
  // Check if folder is fully synced
  const synced = isFolderSynced(file.relativePath, allFiles)
  return synced ? 'text-plm-success' : 'text-plm-fg-muted'
}

// ============================================================================
// CHECKOUT USER INFO - For avatars and check-in buttons
// ============================================================================

export interface CheckoutUser {
  id: string
  name: string
  avatar_url?: string
  isMe: boolean
  isDifferentMachine?: boolean
  machineName?: string
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
  userAvatarUrl?: string
): CheckoutUser[] {
  const folderFiles = allFiles.filter(f => 
    !f.isDirectory && 
    f.pdmData?.checked_out_by &&
    f.relativePath.startsWith(folderPath + '/')
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
          avatar_url: userAvatarUrl,
          isMe: true
        })
      } else {
        const checkedOutUser = (f.pdmData as any).checked_out_user
        usersMap.set(checkoutUserId, {
          id: checkoutUserId,
          name: checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'Someone',
          avatar_url: checkedOutUser?.avatar_url,
          isMe: false
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
  currentMachineId?: string | null
): CheckoutUser | null {
  if (!file.pdmData?.checked_out_by) return null
  
  const isMe = file.pdmData.checked_out_by === userId
  const checkoutMachineId = file.pdmData.checked_out_by_machine_id
  const checkoutMachineName = file.pdmData.checked_out_by_machine_name
  const isDifferentMachine = isMe && checkoutMachineId && currentMachineId && checkoutMachineId !== currentMachineId
  
  if (isMe) {
    return {
      id: file.pdmData.checked_out_by,
      name: userFullName || userEmail || 'You',
      avatar_url: userAvatarUrl,
      isMe: true,
      isDifferentMachine: isDifferentMachine || false,
      machineName: checkoutMachineName ?? undefined
    }
  } else {
    const checkedOutUser = (file.pdmData as any).checked_out_user
    return {
      id: file.pdmData.checked_out_by,
      name: checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'Someone',
      avatar_url: checkedOutUser?.avatar_url,
      isMe: false
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
  className = ''
}: CheckoutAvatarsProps) {
  if (users.length === 0) return null
  
  const displayedUsers = users.slice(0, maxAvatars)
  const hasOverflow = users.length > maxAvatars
  const fontSize = Math.max(8, size * 0.45)
  
  return (
    <div 
      className={`flex -space-x-1 ${className}`}
      title={users.map(u => u.name).join(', ')}
    >
      {displayedUsers.map((u) => (
        <div 
          key={u.id} 
          className="relative rounded-full overflow-hidden flex-shrink-0"
          style={{ width: size, height: size }}
          title={u.isDifferentMachine && u.machineName 
            ? `Checked out on ${u.machineName} (different computer)` 
            : u.name}
        >
          {u.avatar_url ? (
            <img
              src={u.avatar_url}
              alt={u.name}
              className="w-full h-full object-cover"
              onError={(e) => {
                const target = e.target as HTMLImageElement
                target.style.display = 'none'
                target.nextElementSibling?.classList.remove('hidden')
              }}
            />
          ) : null}
          <div 
            className={`w-full h-full flex items-center justify-center font-medium ${
              u.isMe 
                ? (u.isDifferentMachine ? 'bg-plm-warning/30 text-plm-warning' : 'bg-plm-accent/30 text-plm-accent') 
                : 'bg-plm-accent/30 text-plm-accent'
            } ${u.avatar_url ? 'hidden' : ''}`}
            style={{ fontSize }}
          >
            {getInitials(u.name)}
          </div>
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
  isProcessing = false 
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
    const checkedOutUser = (file.pdmData as any).checked_out_user
    const avatarUrl = checkedOutUser?.avatar_url
    const displayName = checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'Someone'
    
    const avatarSize = Math.max(16, size * 1.5)
    const fontSize = Math.max(8, avatarSize * 0.45)
    
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
            onError={(e) => {
              const target = e.target as HTMLImageElement
              target.style.display = 'none'
              target.nextElementSibling?.classList.remove('hidden')
            }}
          />
        ) : null}
        <div 
          className={`w-full h-full rounded-full bg-plm-accent/30 text-plm-accent flex items-center justify-center font-medium absolute inset-0 ${avatarUrl ? 'hidden' : ''}`}
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
 * Get count of cloud-only files in a folder (both 'cloud' and 'cloud_new')
 */
export function getCloudFilesCount(folderPath: string, allFiles: LocalFile[]): number {
  return allFiles.filter(f => 
    !f.isDirectory && 
    (f.diffStatus === 'cloud' || f.diffStatus === 'cloud_new') && 
    f.relativePath.startsWith(folderPath + '/')
  ).length
}

/**
 * Get count of new cloud files in a folder (cloud_new - recently added by others)
 */
export function getCloudNewFilesCount(folderPath: string, allFiles: LocalFile[]): number {
  return allFiles.filter(f => 
    !f.isDirectory && 
    f.diffStatus === 'cloud_new' && 
    f.relativePath.startsWith(folderPath + '/')
  ).length
}

/**
 * Get count of local-only (unsynced) files in a folder
 */
export function getLocalOnlyFilesCount(folderPath: string, allFiles: LocalFile[]): number {
  return allFiles.filter(f => 
    !f.isDirectory && 
    (!f.pdmData || f.diffStatus === 'added') && 
    f.diffStatus !== 'cloud' && 
    f.diffStatus !== 'cloud_new' && 
    f.diffStatus !== 'ignored' &&
    f.relativePath.startsWith(folderPath + '/')
  ).length
}

/**
 * Get count of synced files that can be checked out in a folder
 */
export function getSyncedCheckoutableCount(folderPath: string, allFiles: LocalFile[]): number {
  return allFiles.filter(f => 
    !f.isDirectory && 
    f.pdmData && !f.pdmData.checked_out_by &&
    f.diffStatus !== 'cloud' &&
    f.relativePath.startsWith(folderPath + '/')
  ).length
}

/**
 * Get count of files checked out by a specific user in a folder
 */
export function getMyCheckedOutCount(folderPath: string, allFiles: LocalFile[], userId?: string): number {
  return allFiles.filter(f => 
    !f.isDirectory && 
    f.pdmData?.checked_out_by === userId &&
    f.relativePath.startsWith(folderPath + '/')
  ).length
}

/**
 * Get total count of checked out files in a folder
 */
export function getTotalCheckoutCount(folderPath: string, allFiles: LocalFile[]): number {
  return allFiles.filter(f => 
    !f.isDirectory && 
    f.pdmData?.checked_out_by &&
    f.relativePath.startsWith(folderPath + '/')
  ).length
}

