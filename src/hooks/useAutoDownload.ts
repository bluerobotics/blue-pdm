import { useEffect, useRef } from 'react'
import { usePDMStore } from '@/stores/pdmStore'
import { executeCommand } from '@/lib/commands'

/**
 * Hook to trigger auto-download when settings are toggled ON
 * Handles:
 * - Detecting when autoDownloadCloudFiles is enabled
 * - Detecting when autoDownloadUpdates is enabled
 * - Running the download logic immediately when settings change
 */
export function useAutoDownload() {
  const {
    organization,
    isOfflineMode,
    activeVaultId,
    connectedVaults,
  } = usePDMStore()

  // Get current vault ID (from activeVaultId or first connected vault)
  const currentVaultId = activeVaultId || connectedVaults[0]?.id

  // Track previous values to detect toggle ON
  const autoDownloadCloudFiles = usePDMStore(s => s.autoDownloadCloudFiles)
  const autoDownloadUpdates = usePDMStore(s => s.autoDownloadUpdates)
  const prevAutoDownloadCloudFiles = useRef(autoDownloadCloudFiles)
  const prevAutoDownloadUpdates = useRef(autoDownloadUpdates)
  
  useEffect(() => {
    const cloudFilesJustEnabled = autoDownloadCloudFiles && !prevAutoDownloadCloudFiles.current
    const updatesJustEnabled = autoDownloadUpdates && !prevAutoDownloadUpdates.current
    
    // Update refs for next comparison
    prevAutoDownloadCloudFiles.current = autoDownloadCloudFiles
    prevAutoDownloadUpdates.current = autoDownloadUpdates
    
    // Only proceed if a setting was just toggled ON
    if (!cloudFilesJustEnabled && !updatesJustEnabled) return
    
    // Need organization, vault, and not offline to download
    if (!organization || isOfflineMode || !currentVaultId) return
    
    const runAutoDownload = async () => {
      const { files, autoDownloadExcludedFiles, addToast, activeVaultId } = usePDMStore.getState()
      
      // Get exclusion list for current vault
      const excludedPaths = activeVaultId ? (autoDownloadExcludedFiles[activeVaultId] || []) : []
      const excludedPathsSet = new Set(excludedPaths)
      
      // Auto-download cloud-only files (if just enabled)
      if (cloudFilesJustEnabled) {
        const cloudOnlyFiles = files.filter(f => 
          !f.isDirectory && 
          f.diffStatus === 'cloud' && 
          f.pdmData?.content_hash &&
          !excludedPathsSet.has(f.relativePath)
        )
        
        if (cloudOnlyFiles.length > 0) {
          window.electronAPI?.log('info', '[AutoDownload] Setting toggled ON - downloading cloud files', { count: cloudOnlyFiles.length })
          try {
            const result = await executeCommand('download', { files: cloudOnlyFiles })
            if (result.succeeded > 0) {
              addToast('success', `Auto-downloaded ${result.succeeded} cloud file${result.succeeded > 1 ? 's' : ''}`)
            }
            if (result.failed > 0) {
              window.electronAPI?.log('warn', '[AutoDownload] Some downloads failed', { failed: result.failed, errors: result.errors })
            }
          } catch (err) {
            window.electronAPI?.log('error', '[AutoDownload] Failed to download cloud files', { error: String(err) })
          }
        } else {
          window.electronAPI?.log('info', '[AutoDownload] Setting toggled ON - no cloud files to download')
        }
      }
      
      // Auto-download updates for outdated files (if just enabled)
      if (updatesJustEnabled) {
        const outdatedFiles = files.filter(f => 
          !f.isDirectory && f.diffStatus === 'outdated' && f.pdmData?.content_hash
        )
        
        if (outdatedFiles.length > 0) {
          window.electronAPI?.log('info', '[AutoDownload] Setting toggled ON - updating outdated files', { count: outdatedFiles.length })
          try {
            const result = await executeCommand('get-latest', { files: outdatedFiles })
            if (result.succeeded > 0) {
              addToast('success', `Auto-updated ${result.succeeded} file${result.succeeded > 1 ? 's' : ''}`)
            }
            if (result.failed > 0) {
              window.electronAPI?.log('warn', '[AutoDownload] Some updates failed', { failed: result.failed, errors: result.errors })
            }
          } catch (err) {
            window.electronAPI?.log('error', '[AutoDownload] Failed to update outdated files', { error: String(err) })
          }
        } else {
          window.electronAPI?.log('info', '[AutoDownload] Setting toggled ON - no outdated files to update')
        }
      }
    }
    
    runAutoDownload()
  }, [autoDownloadCloudFiles, autoDownloadUpdates, organization, isOfflineMode, currentVaultId])
}
