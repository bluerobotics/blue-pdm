import { useMemo } from 'react'
import type { LocalFile } from '../../../stores/pdmStore'
import type { FolderMetrics, FolderMetricsMap } from '../types'

export interface UseFolderMetricsOptions {
  files: LocalFile[]
  userId: string | undefined
  userFullName: string | undefined
  userEmail: string | undefined
  userAvatarUrl: string | undefined
  hideSolidworksTempFiles: boolean
}

/**
 * Hook to compute folder metrics in a single pass for O(n) instead of O(n²) complexity.
 * This avoids repeated iterations in renderCellContent for each folder.
 */
export function useFolderMetrics({
  files,
  userId,
  userFullName,
  userEmail,
  userAvatarUrl,
  hideSolidworksTempFiles
}: UseFolderMetricsOptions): FolderMetricsMap {
  return useMemo(() => {
    const metrics = new Map<string, FolderMetrics>()
    
    // Get all non-directory files (optionally excluding SolidWorks temp files)
    const allNonDirFiles = files.filter(f => {
      if (f.isDirectory) return false
      // Exclude temp files from metrics when hide setting is enabled
      if (hideSolidworksTempFiles && f.name.startsWith('~$')) return false
      return true
    })
    
    // Group files by their folder paths
    for (const file of allNonDirFiles) {
      // Get all parent folder paths for this file
      const parts = file.relativePath.split('/')
      let currentPath = ''
      
      for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]
        
        if (!metrics.has(currentPath)) {
          metrics.set(currentPath, {
            cloudFilesCount: 0,
            cloudNewFilesCount: 0,
            localOnlyFilesCount: 0,
            checkoutableFilesCount: 0,
            outdatedFilesCount: 0,
            hasCheckoutableFiles: false,
            hasMyCheckedOutFiles: false,
            hasOthersCheckedOutFiles: false,
            hasUnsyncedFiles: false,
            myCheckedOutFilesCount: 0,
            totalCheckedOutFilesCount: 0,
            checkoutUsers: [],
            isSynced: true
          })
        }
        
        const m = metrics.get(currentPath)!
        
        // Cloud files
        if (file.diffStatus === 'cloud' || file.diffStatus === 'cloud_new') {
          m.cloudFilesCount++
          if (file.diffStatus === 'cloud_new') m.cloudNewFilesCount++
        }
        
        // Local-only (unsynced) files
        if ((!file.pdmData || file.diffStatus === 'added' || file.diffStatus === 'deleted_remote') && 
            file.diffStatus !== 'cloud' && file.diffStatus !== 'cloud_new' && file.diffStatus !== 'ignored') {
          m.localOnlyFilesCount++
          m.hasUnsyncedFiles = true
        }
        
        // Checkoutable files (synced, not checked out, exists locally)
        if (file.pdmData && !file.pdmData.checked_out_by && 
            file.diffStatus !== 'cloud' && file.diffStatus !== 'cloud_new' && file.diffStatus !== 'deleted') {
          m.checkoutableFilesCount++
          m.hasCheckoutableFiles = true
        }
        
        // Outdated files
        if (file.diffStatus === 'outdated') {
          m.outdatedFilesCount++
        }
        
        // Checked out by me
        if (file.pdmData?.checked_out_by === userId && file.diffStatus !== 'deleted') {
          m.hasMyCheckedOutFiles = true
          m.myCheckedOutFilesCount++
          m.totalCheckedOutFilesCount++
        }
        
        // Checked out by others
        if (file.pdmData?.checked_out_by && file.pdmData.checked_out_by !== userId && file.diffStatus !== 'deleted') {
          m.hasOthersCheckedOutFiles = true
          m.totalCheckedOutFilesCount++
        }
        
        // Synced status
        if (!file.pdmData || file.diffStatus === 'added') {
          m.isSynced = false
        }
      }
    }
    
    // Build checkout users for each folder (second pass to dedupe)
    for (const file of allNonDirFiles) {
      if (!file.pdmData?.checked_out_by) continue
      if (file.diffStatus === 'deleted') continue
      
      const parts = file.relativePath.split('/')
      let currentPath = ''
      
      for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]
        const m = metrics.get(currentPath)
        if (!m) continue
        
        const checkoutUserId = file.pdmData.checked_out_by
        if (!m.checkoutUsers.some(u => u.id === checkoutUserId)) {
          const isMe = checkoutUserId === userId
          if (isMe) {
            m.checkoutUsers.push({
              id: checkoutUserId,
              name: userFullName || userEmail || 'You',
              avatar_url: userAvatarUrl,
              isMe: true
            })
          } else {
            const checkedOutUser = (file.pdmData as any).checked_out_user
            m.checkoutUsers.push({
              id: checkoutUserId,
              name: checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'Someone',
              avatar_url: checkedOutUser?.avatar_url,
              isMe: false
            })
          }
        }
      }
    }
    
    // Sort checkout users (me first)
    for (const [, m] of metrics) {
      m.checkoutUsers.sort((a, b) => {
        if (a.isMe && !b.isMe) return -1
        if (!a.isMe && b.isMe) return 1
        return 0
      })
    }
    
    return metrics
  }, [files, userId, userFullName, userEmail, userAvatarUrl, hideSolidworksTempFiles])
}
