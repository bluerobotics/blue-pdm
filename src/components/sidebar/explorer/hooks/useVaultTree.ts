import { useMemo, useCallback } from 'react'
import { usePDMStore, LocalFile } from '../../../../stores/pdmStore'
import { 
  getFolderCheckoutStatus, 
  isFolderSynced, 
  getFolderCheckoutUsers,
  type CheckoutUser
} from '../../../shared/FileItemComponents'
import type { TreeMap, FolderDiffCounts } from '../types'

/**
 * Hook for building and managing the vault file tree
 * Handles tree construction, filtering, and folder statistics
 */
export function useVaultTree() {
  const {
    files,
    hideSolidworksTempFiles,
    user,
    getFolderDiffCounts: getFolderDiffCountsFromStore,
    processingFolders
  } = usePDMStore()
  
  // Build folder tree structure
  const tree = useMemo<TreeMap>(() => {
    const treeMap: TreeMap = { '': [] }
    
    // Filter out any undefined or invalid files and optionally hide SolidWorks temp files
    const validFiles = files.filter(f => {
      if (!f || !f.relativePath || !f.name) return false
      // Hide SolidWorks temp lock files (~$filename.sldxxx) when setting is enabled
      if (hideSolidworksTempFiles && f.name.startsWith('~$')) return false
      return true
    })
    
    validFiles.forEach(file => {
      const parts = file.relativePath.split('/')
      if (parts.length === 1) {
        treeMap[''].push(file)
      } else {
        const parentPath = parts.slice(0, -1).join('/')
        if (!treeMap[parentPath]) {
          treeMap[parentPath] = []
        }
        treeMap[parentPath].push(file)
      }
    })
    
    return treeMap
  }, [files, hideSolidworksTempFiles])
  
  // Check if a file/folder is affected by any processing operation
  const isBeingProcessed = useCallback((relativePath: string): boolean => {
    const normalizedPath = relativePath.replace(/\\/g, '/')
    
    // Check if this exact path is being processed
    if (processingFolders.has(relativePath)) return true
    if (processingFolders.has(normalizedPath)) return true
    
    // Check if any parent folder is being processed
    for (const processingPath of processingFolders) {
      const normalizedProcessingPath = processingPath.replace(/\\/g, '/')
      if (normalizedPath.startsWith(normalizedProcessingPath + '/')) return true
    }
    return false
  }, [processingFolders])
  
  // Wrapper for isFolderSynced using local files
  const checkFolderSynced = useCallback((folderPath: string): boolean => {
    const filteredFiles = hideSolidworksTempFiles 
      ? files.filter(f => !f.name.startsWith('~$'))
      : files
    return isFolderSynced(folderPath, filteredFiles)
  }, [files, hideSolidworksTempFiles])
  
  // Wrapper for getFolderCheckoutStatus
  const checkFolderCheckoutStatus = useCallback((folderPath: string) => {
    return getFolderCheckoutStatus(folderPath, files, user?.id)
  }, [files, user?.id])
  
  // Wrapper for getFolderCheckoutUsers
  const getCheckoutUsersForFolder = useCallback((folderPath: string): CheckoutUser[] => {
    return getFolderCheckoutUsers(
      folderPath, 
      files, 
      user?.id, 
      user?.full_name || undefined, 
      user?.email || undefined, 
      user?.avatar_url || undefined
    )
  }, [files, user?.id, user?.full_name, user?.email, user?.avatar_url])
  
  // Get diff counts for a folder
  const getDiffCounts = useCallback((folderPath: string): FolderDiffCounts => {
    return getFolderDiffCountsFromStore(folderPath)
  }, [getFolderDiffCountsFromStore])
  
  // Calculate local-only files count for a folder
  const getLocalOnlyCount = useCallback((folderPath: string): number => {
    return files.filter(f => 
      !f.isDirectory && 
      (!f.pdmData || f.diffStatus === 'added' || f.diffStatus === 'deleted_remote') && 
      f.diffStatus !== 'cloud' && 
      f.diffStatus !== 'ignored' &&
      f.relativePath.startsWith(folderPath + '/') &&
      !(hideSolidworksTempFiles && f.name.startsWith('~$'))
    ).length
  }, [files, hideSolidworksTempFiles])
  
  // Get folder checkout statistics
  const getFolderCheckoutStats = useCallback((folderPath: string) => {
    const checkoutUsers = getCheckoutUsersForFolder(folderPath)
    const checkedOutByMeCount = files.filter(f => 
      !f.isDirectory && 
      f.pdmData?.checked_out_by === user?.id &&
      f.relativePath.startsWith(folderPath + '/')
    ).length
    const totalCheckouts = files.filter(f => 
      !f.isDirectory && 
      f.pdmData?.checked_out_by &&
      f.relativePath.startsWith(folderPath + '/')
    ).length
    const syncedCount = files.filter(f => 
      !f.isDirectory && 
      f.pdmData && !f.pdmData.checked_out_by &&
      f.diffStatus !== 'cloud' &&
      f.relativePath.startsWith(folderPath + '/')
    ).length
    
    return {
      checkoutUsers,
      checkedOutByMeCount,
      totalCheckouts,
      syncedCount
    }
  }, [files, user?.id, getCheckoutUsersForFolder])
  
  // Sort children for display
  const sortChildren = useCallback((children: LocalFile[]): LocalFile[] => {
    return children
      .filter(child => child && child.name)
      .sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        return a.name.localeCompare(b.name)
      })
  }, [])
  
  return {
    tree,
    isBeingProcessed,
    checkFolderSynced,
    checkFolderCheckoutStatus,
    getCheckoutUsersForFolder,
    getDiffCounts,
    getLocalOnlyCount,
    getFolderCheckoutStats,
    sortChildren
  }
}
