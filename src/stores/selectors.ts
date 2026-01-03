// Memoized selectors for the PDM store
import { useMemo } from 'react'
import { usePDMStore } from './pdmStore'

/**
 * Get files that are checked out by the current user
 */
export function useCheckedOutFiles() {
  const files = usePDMStore(s => s.files)
  const userId = usePDMStore(s => s.user?.id)
  
  return useMemo(
    () => files.filter(f => f.pdmData?.checked_out_by === userId),
    [files, userId]
  )
}

/**
 * Get files with pending metadata changes
 */
export function usePendingFiles() {
  const files = usePDMStore(s => s.files)
  
  return useMemo(
    () => files.filter(f => f.pendingMetadata && Object.keys(f.pendingMetadata).length > 0),
    [files]
  )
}

/**
 * Get files that need to be synced (added, modified, or deleted)
 */
export function useFilesNeedingSync() {
  const files = usePDMStore(s => s.files)
  
  return useMemo(
    () => files.filter(f => 
      f.diffStatus === 'added' || 
      f.diffStatus === 'modified' || 
      f.diffStatus === 'deleted' ||
      f.diffStatus === 'moved'
    ),
    [files]
  )
}

/**
 * Get files that need to be updated from server
 */
export function useOutdatedFiles() {
  const files = usePDMStore(s => s.files)
  
  return useMemo(
    () => files.filter(f => f.diffStatus === 'outdated'),
    [files]
  )
}

/**
 * Get cloud-only files (not downloaded locally)
 */
export function useCloudOnlyFiles() {
  const files = usePDMStore(s => s.files)
  
  return useMemo(
    () => files.filter(f => f.diffStatus === 'cloud' || f.diffStatus === 'cloud_new'),
    [files]
  )
}

/**
 * Get files in a specific folder (direct children only)
 */
export function useFilesInFolder(folderPath: string) {
  const files = usePDMStore(s => s.files)
  
  return useMemo(() => {
    if (!folderPath) {
      // Root level - files with no slash in relativePath
      return files.filter(f => !f.relativePath.includes('/'))
    }
    
    const prefix = folderPath + '/'
    return files.filter(f => {
      if (!f.relativePath.startsWith(prefix)) return false
      // Check it's a direct child (no more slashes after the prefix)
      const remainder = f.relativePath.slice(prefix.length)
      return !remainder.includes('/')
    })
  }, [files, folderPath])
}

/**
 * Get count of files by diff status
 */
export function useDiffStatusCounts() {
  const files = usePDMStore(s => s.files)
  
  return useMemo(() => {
    let added = 0
    let modified = 0
    let deleted = 0
    let outdated = 0
    let cloud = 0
    let cloudNew = 0
    let moved = 0
    
    for (const file of files) {
      if (file.isDirectory) continue
      switch (file.diffStatus) {
        case 'added': added++; break
        case 'modified': modified++; break
        case 'deleted': deleted++; break
        case 'outdated': outdated++; break
        case 'cloud': cloud++; break
        case 'cloud_new': cloudNew++; break
        case 'moved': moved++; break
      }
    }
    
    return { added, modified, deleted, outdated, cloud, cloudNew, moved }
  }, [files])
}

/**
 * Get the active vault
 */
export function useActiveVault() {
  const connectedVaults = usePDMStore(s => s.connectedVaults)
  const activeVaultId = usePDMStore(s => s.activeVaultId)
  
  return useMemo(
    () => connectedVaults.find(v => v.id === activeVaultId),
    [connectedVaults, activeVaultId]
  )
}

/**
 * Get all folder paths from files
 */
export function useFolderPaths() {
  const files = usePDMStore(s => s.files)
  
  return useMemo(() => {
    const folders = new Set<string>()
    for (const file of files) {
      if (file.isDirectory) {
        folders.add(file.relativePath)
      }
    }
    return folders
  }, [files])
}

/**
 * Get unique file extensions
 */
export function useFileExtensions() {
  const files = usePDMStore(s => s.files)
  
  return useMemo(() => {
    const extensions = new Set<string>()
    for (const file of files) {
      if (!file.isDirectory && file.extension) {
        extensions.add(file.extension.toLowerCase())
      }
    }
    return Array.from(extensions).sort()
  }, [files])
}

/**
 * Check if any operations are in progress
 */
export function useIsOperationInProgress() {
  const isLoading = usePDMStore(s => s.isLoading)
  const isRefreshing = usePDMStore(s => s.isRefreshing)
  const syncProgress = usePDMStore(s => s.syncProgress)
  const operationQueue = usePDMStore(s => s.operationQueue)
  const processingFolders = usePDMStore(s => s.processingFolders)
  
  return isLoading || isRefreshing || syncProgress.isActive || 
         operationQueue.length > 0 || processingFolders.size > 0
}

/**
 * Get the effective user (considering impersonation)
 */
export function useEffectiveUser() {
  const user = usePDMStore(s => s.user)
  const impersonatedUser = usePDMStore(s => s.impersonatedUser)
  
  return useMemo(() => {
    if (impersonatedUser) {
      return {
        id: impersonatedUser.id,
        email: impersonatedUser.email,
        full_name: impersonatedUser.full_name,
        avatar_url: impersonatedUser.avatar_url,
        role: impersonatedUser.role,
        isImpersonating: true
      }
    }
    return user ? { ...user, isImpersonating: false } : null
  }, [user, impersonatedUser])
}

// Re-export convenience hooks from pdmStore for backward compatibility
export { useSelectedFiles, useVisibleFiles } from './pdmStore'
