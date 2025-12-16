import { useState } from 'react'
import { Download, Loader2, X, Sparkles, ArrowUpCircle, ArrowDownCircle } from 'lucide-react'
import { usePDMStore } from '../stores/pdmStore'

export function UpdateModal() {
  const { 
    updateAvailable, 
    updateDownloading, 
    updateDownloaded, 
    updateProgress,
    setUpdateDownloading,
    setUpdateDownloaded,
    showUpdateModal,
    setShowUpdateModal,
    setInstallerPath,
    addToast
  } = usePDMStore()
  
  const [isExiting, setIsExiting] = useState(false)
  const [isRunningInstaller, setIsRunningInstaller] = useState(false)

  if (!showUpdateModal || !updateAvailable) return null
  
  const isManualVersion = updateAvailable.isManualVersion
  const isRollback = updateAvailable.downloadUrl?.includes('rollback') || 
    (updateAvailable.releaseNotes === 'rollback')

  const handleUpdateNow = async () => {
    if (updateDownloading || updateDownloaded) return
    
    // Clear any existing reminder when user clicks update
    window.electronAPI.clearUpdateReminder()
    
    setUpdateDownloading(true)
    
    try {
      if (isManualVersion && updateAvailable.downloadUrl) {
        // Manual version download from GitHub
        const result = await window.electronAPI.downloadVersionInstaller(
          updateAvailable.version,
          updateAvailable.downloadUrl
        )
        
        if (!result.success) {
          console.error('Download failed:', result.error)
          addToast('error', `Download failed: ${result.error}`)
          setUpdateDownloading(false)
          return
        }
        
        // Store the installer path and mark as downloaded
        setInstallerPath(result.filePath || null)
        setUpdateDownloading(false)
        setUpdateDownloaded(true)
        
        // Auto-run the installer
        if (result.filePath) {
          setIsRunningInstaller(true)
          const runResult = await window.electronAPI.runInstaller(result.filePath)
          if (!runResult.success) {
            console.error('Failed to run installer:', runResult.error)
            addToast('error', `Failed to run installer: ${runResult.error}`)
            setIsRunningInstaller(false)
          }
          // App will quit after running installer
        }
      } else {
        // Standard auto-update flow
        const result = await window.electronAPI.downloadUpdate()
        if (!result.success) {
          console.error('Download failed:', result.error)
          addToast('error', `Download failed: ${result.error}`)
          setUpdateDownloading(false)
        }
        // After download completes, auto-install will be triggered by onUpdateDownloaded
      }
    } catch (err) {
      console.error('Download error:', err)
      addToast('error', `Download error: ${err instanceof Error ? err.message : String(err)}`)
      setUpdateDownloading(false)
    }
  }

  const handleLater = async () => {
    // Save the reminder for this version (only for auto-updates)
    if (!isManualVersion) {
      const version = updateAvailable.version
      if (version) {
        await window.electronAPI.postponeUpdate(version)
        console.log(`[Update] Postponed update for version ${version}, will remind on next startup or in 24 hours`)
      }
    }
    
    // Reset state
    setInstallerPath(null)
    setUpdateDownloaded(false)
    setIsExiting(true)
    setTimeout(() => setShowUpdateModal(false), 200)
  }

  // Format bytes to human readable
  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatSpeed = (bytesPerSecond: number) => {
    return `${formatBytes(bytesPerSecond)}/s`
  }
  
  // Determine the action label
  const getActionLabel = () => {
    if (isRollback) return 'Rollback Now'
    if (isManualVersion) return 'Install Now'
    return 'Update Now'
  }
  
  // Determine the header label
  const getHeaderLabel = () => {
    if (isRollback) return 'Rollback to Version'
    if (isManualVersion) return 'Install Version'
    return 'Latest Version'
  }
  
  // Determine the description
  const getDescription = () => {
    if (isRollback) {
      return 'You are about to rollback to a previous version. Your settings and data will be preserved.'
    }
    if (isManualVersion) {
      return 'You are about to install a different version of BluePLM. Your settings and data will be preserved.'
    }
    return 'A new version of BluePLM is available. Update now to get the latest features and improvements.'
  }

  return (
    <div 
      className={`fixed inset-0 z-[100] flex items-center justify-center transition-opacity duration-200 ${
        isExiting ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Dark blur backdrop - blocks entire app */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />
      
      {/* Modal content */}
      <div 
        className={`relative bg-plm-bg-light border border-plm-border rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden transition-transform duration-200 ${
          isExiting ? 'scale-95' : 'scale-100'
        }`}
      >
        {/* Header with gradient */}
        <div className={`relative p-6 pb-4 ${
          isRollback 
            ? 'bg-gradient-to-br from-yellow-500/20 via-orange-500/10 to-transparent'
            : 'bg-gradient-to-br from-plm-accent/20 via-cyan-500/10 to-transparent'
        }`}>
          {/* Close button - only show if not downloading */}
          {!updateDownloading && !updateDownloaded && (
            <button
              onClick={handleLater}
              className="absolute top-4 right-4 p-1 rounded-lg text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg/50 transition-colors"
            >
              <X size={18} />
            </button>
          )}
          
          {/* Icon */}
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${
            isRollback 
              ? 'bg-yellow-500/20' 
              : 'bg-plm-accent/20'
          }`}>
            {isRollback ? (
              <ArrowDownCircle size={32} className="text-yellow-400" />
            ) : isManualVersion ? (
              <ArrowUpCircle size={32} className="text-green-400" />
            ) : (
              <Sparkles size={32} className="text-plm-accent" />
            )}
          </div>
          
          {/* Title */}
          <div className={`text-xs font-bold uppercase tracking-wider mb-1 ${
            isRollback ? 'text-yellow-400' : 'text-plm-accent'
          }`}>
            {getHeaderLabel()}
          </div>
          <h2 className="text-2xl font-bold text-plm-fg">
            v{updateAvailable.version}
          </h2>
        </div>
        
        {/* Body */}
        <div className="p-6 pt-4">
          <p className="text-sm text-plm-fg-muted mb-6">
            {getDescription()}
          </p>
          
          {/* Progress bar - show during download */}
          {updateDownloading && updateProgress && (
            <div className="mb-6">
              <div className="flex items-center justify-between text-xs text-plm-fg-muted mb-2">
                <span>Downloading...</span>
                <span>{formatSpeed(updateProgress.bytesPerSecond)}</span>
              </div>
              <div className="h-2 bg-plm-bg rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-200 ease-out ${
                    isRollback ? 'bg-yellow-500' : 'bg-plm-accent'
                  }`}
                  style={{ width: `${updateProgress.percent}%` }}
                />
              </div>
              <div className="text-right text-xs text-plm-fg-muted mt-1">
                {updateProgress.percent.toFixed(0)}%
              </div>
            </div>
          )}
          
          {/* Installing message */}
          {(updateDownloaded || isRunningInstaller) && (
            <div className="mb-6 flex items-center gap-2 text-sm text-plm-fg-muted">
              <Loader2 size={16} className={`animate-spin ${isRollback ? 'text-yellow-400' : 'text-plm-accent'}`} />
              <span>{isRunningInstaller ? 'Running installer...' : 'Installing update and restarting...'}</span>
            </div>
          )}
          
          {/* Action buttons */}
          <div className="flex gap-3">
            {!updateDownloading && !updateDownloaded && (
              <>
                <button
                  onClick={handleUpdateNow}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold transition-colors ${
                    isRollback
                      ? 'bg-yellow-600 text-white hover:bg-yellow-500'
                      : 'bg-plm-accent text-white hover:bg-plm-accent/90'
                  }`}
                >
                  <Download size={18} />
                  {getActionLabel()}
                </button>
                <button
                  onClick={handleLater}
                  className="px-4 py-3 rounded-xl text-sm font-medium text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg transition-colors"
                >
                  Cancel
                </button>
              </>
            )}
            
            {updateDownloading && !updateDownloaded && (
              <div className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-plm-bg text-plm-fg-muted">
                <Loader2 size={16} className="animate-spin" />
                Downloading...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
