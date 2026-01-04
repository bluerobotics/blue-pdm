import { useEffect, useState, useCallback, useRef } from 'react'
import { usePDMStore } from '@/stores/pdmStore'
import { executeCommand } from '@/lib/commands'
import type { StagedCheckin } from '@/stores/pdmStore'

interface StagedConflict {
  staged: StagedCheckin
  serverVersion: number
  localPath: string
}

/**
 * Hook to manage staged check-ins for offline mode
 * Handles:
 * - Processing staged check-ins when going back online
 * - Conflict detection when server version changed
 * - Managing conflict dialog state
 */
export function useStagedCheckins(loadFiles: (silent?: boolean) => void) {
  const {
    user,
    organization,
    vaultPath,
    isOfflineMode,
    stagedCheckins,
    unstageCheckin,
    addToast,
  } = usePDMStore()

  // Track previous offline mode to detect transition
  const prevOfflineModeRef = useRef(isOfflineMode)

  // Staged check-in conflict dialog state
  const [stagedConflicts, setStagedConflicts] = useState<StagedConflict[]>([])

  // Clear staged conflicts
  const clearStagedConflicts = useCallback(() => {
    setStagedConflicts([])
  }, [])

  // Process staged check-ins when going back online
  const processStagedCheckins = useCallback(async () => {
    if (stagedCheckins.length === 0 || !organization || !user || !vaultPath) {
      return
    }
    
    console.log('[StagedCheckins] Processing', stagedCheckins.length, 'staged check-ins')
    
    // Get current files to find the staged ones
    const { files } = usePDMStore.getState()
    
    // Collect conflicts for dialog
    const conflicts: StagedConflict[] = []
    
    let successCount = 0
    
    for (const staged of stagedCheckins) {
      const file = files.find(f => f.relativePath === staged.relativePath)
      if (!file) {
        console.warn('[StagedCheckins] File not found:', staged.relativePath)
        unstageCheckin(staged.relativePath)
        continue
      }
      
      // Check for conflict: server version changed since we staged
      const serverVersionChanged = staged.serverVersion !== undefined && 
        file.pdmData?.version !== undefined && 
        file.pdmData.version > staged.serverVersion
      
      if (serverVersionChanged) {
        // Conflict detected - add to conflicts list for dialog
        console.log('[StagedCheckins] Conflict detected for:', staged.fileName, {
          stagedVersion: staged.serverVersion,
          currentVersion: file.pdmData?.version
        })
        conflicts.push({
          staged,
          serverVersion: file.pdmData?.version || 0,
          localPath: file.path
        })
        continue
      }
      
      try {
        // For new files, use sync (first check-in)
        // For existing files, use checkout + checkin
        if (!file.pdmData) {
          // New file - first check-in
          await executeCommand('sync', { files: [file] }, { silent: true })
        } else {
          // Existing file - checkout then checkin
          await executeCommand('checkout', { files: [file] }, { silent: true })
          await executeCommand('checkin', { files: [file], comment: staged.comment || 'Offline changes' }, { silent: true })
        }
        
        // Remove from staged
        unstageCheckin(staged.relativePath)
        successCount++
        console.log('[StagedCheckins] Successfully processed:', staged.fileName)
      } catch (err) {
        console.error('[StagedCheckins] Failed to process:', staged.fileName, err)
        addToast('error', `Failed to check in "${staged.fileName}": ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }
    
    // Show success message for processed files
    if (successCount > 0) {
      addToast('success', `Successfully checked in ${successCount} staged file${successCount > 1 ? 's' : ''}`)
    }
    
    // Show conflict dialog if there are conflicts
    if (conflicts.length > 0) {
      setStagedConflicts(conflicts)
    }
    
    // Refresh files after processing
    loadFiles(true)
  }, [stagedCheckins, organization, user, vaultPath, addToast, unstageCheckin, loadFiles])
  
  // Handle staged check-ins when going back online
  useEffect(() => {
    const wasOffline = prevOfflineModeRef.current
    const isNowOnline = !isOfflineMode
    
    // Update ref for next render
    prevOfflineModeRef.current = isOfflineMode
    
    // Only process when transitioning from offline to online
    if (wasOffline && isNowOnline && stagedCheckins.length > 0) {
      console.log('[StagedCheckins] Going online with', stagedCheckins.length, 'staged check-ins')
      
      // Show notification about staged check-ins
      addToast(
        'info',
        `Processing ${stagedCheckins.length} staged file${stagedCheckins.length > 1 ? 's' : ''} for check-in...`,
        8000
      )
      
      // Process staged check-ins in the background
      processStagedCheckins()
    }
  }, [isOfflineMode, stagedCheckins.length, addToast, processStagedCheckins])

  return {
    stagedConflicts,
    clearStagedConflicts,
  }
}
