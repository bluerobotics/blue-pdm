import { useEffect } from 'react'
import { usePDMStore } from '@/stores/pdmStore'

/**
 * Auto-updater event listeners
 * Handles:
 * - Update available notifications
 * - Download progress
 * - Auto-install after download
 * - Error handling
 */
export function useAutoUpdater() {
  useEffect(() => {
    if (!window.electronAPI) return
    
    const { 
      setShowUpdateModal, 
      setUpdateAvailable, 
      setUpdateDownloading, 
      setUpdateDownloaded, 
      setUpdateProgress,
      addToast 
    } = usePDMStore.getState()
    
    const cleanups: (() => void)[] = []
    
    // Update available - show modal (always update to latest version)
    cleanups.push(
      window.electronAPI.onUpdateAvailable((info) => {
        console.log('[Update] Update available:', info.version)
        // Reset download state when switching to a new update version
        setUpdateDownloading(false)
        setUpdateDownloaded(false)
        setUpdateProgress(null)
        setUpdateAvailable(info)
        setShowUpdateModal(true)
      })
    )
    
    // Update not available
    cleanups.push(
      window.electronAPI.onUpdateNotAvailable(() => {
        console.log('[Update] No update available')
        setUpdateAvailable(null)
      })
    )
    
    // Download progress
    cleanups.push(
      window.electronAPI.onUpdateDownloadProgress((progress) => {
        setUpdateProgress(progress)
      })
    )
    
    // Download completed - auto-install
    cleanups.push(
      window.electronAPI.onUpdateDownloaded(async (info) => {
        console.log('[Update] Update downloaded:', info.version)
        setUpdateDownloading(false)
        setUpdateDownloaded(true)
        setUpdateProgress(null)
        // Auto-install after download completes
        try {
          await window.electronAPI.installUpdate()
        } catch (err) {
          console.error('[Update] Auto-install error:', err)
        }
      })
    )
    
    // Error
    cleanups.push(
      window.electronAPI.onUpdateError((error) => {
        console.error('[Update] Error:', error.message)
        setUpdateDownloading(false)
        setUpdateProgress(null)
        setShowUpdateModal(false)
        addToast('error', `Update error: ${error.message}`)
        // Request focus restoration after modal closes (fixes macOS UI freeze issue)
        window.electronAPI?.requestFocus?.()
      })
    )
    
    // Check if an update was already detected before listeners were set up
    // This handles the race condition where the update check completes before
    // the React app mounts and registers its event listeners
    window.electronAPI.getUpdateStatus().then((status) => {
      if (status.updateAvailable) {
        console.log('[Update] Found pending update on mount:', status.updateAvailable.version)
        setUpdateAvailable(status.updateAvailable)
        setShowUpdateModal(true)
      }
      if (status.updateDownloaded) {
        setUpdateDownloaded(true)
      }
    }).catch((err) => {
      console.error('[Update] Failed to get initial status:', err)
    })
    
    return () => {
      cleanups.forEach(cleanup => cleanup())
    }
  }, [])
}
