import { useState, useEffect } from 'react'
import { 
  RefreshCw, 
  Download, 
  CheckCircle, 
  Loader2,
  Plus,
  X,
  FileText,
  ToggleLeft,
  ToggleRight
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'

export function PreferencesSettings() {
  const { 
    activeVaultId,
    lowercaseExtensions, 
    setLowercaseExtensions,
    ignorePatterns,
    addIgnorePattern,
    removeIgnorePattern
  } = usePDMStore()
  
  const [appVersion, setAppVersion] = useState<string>('')
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [updateCheckResult, setUpdateCheckResult] = useState<'none' | 'available' | 'error' | null>(null)
  const [newIgnorePattern, setNewIgnorePattern] = useState('')
  
  // Get app version on mount
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getVersion().then(setAppVersion)
    }
  }, [])
  
  // Handle manual update check
  const handleCheckForUpdates = async () => {
    if (!window.electronAPI || isCheckingUpdate) return
    
    setIsCheckingUpdate(true)
    setUpdateCheckResult(null)
    
    try {
      const result = await window.electronAPI.checkForUpdates()
      if (result.success && result.updateInfo) {
        setUpdateCheckResult('available')
      } else if (result.success) {
        setUpdateCheckResult('none')
      } else {
        setUpdateCheckResult('error')
      }
    } catch (err) {
      console.error('Update check error:', err)
      setUpdateCheckResult('error')
    } finally {
      setIsCheckingUpdate(false)
      setTimeout(() => setUpdateCheckResult(null), 5000)
    }
  }
  
  const handleAddIgnorePattern = () => {
    if (!newIgnorePattern.trim() || !activeVaultId) return
    addIgnorePattern(activeVaultId, newIgnorePattern.trim())
    setNewIgnorePattern('')
  }
  
  // Get ignore patterns for current vault
  const currentVaultPatterns = activeVaultId ? (ignorePatterns[activeVaultId] || []) : []

  return (
    <div className="space-y-6">
      {/* Application Updates */}
      <div className="space-y-3">
        <label className="text-xs text-pdm-fg-muted uppercase tracking-wide font-medium">
          Application Updates
        </label>
        <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-border">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-pdm-fg">
                BluePDM {appVersion || '...'}
              </div>
              <div className="text-xs text-pdm-fg-muted mt-0.5">
                {updateCheckResult === 'none' && 'You have the latest version'}
                {updateCheckResult === 'available' && 'Update available! Check the notification.'}
                {updateCheckResult === 'error' && 'Could not check for updates'}
                {updateCheckResult === null && !isCheckingUpdate && 'Check for new versions'}
              </div>
            </div>
            <button
              onClick={handleCheckForUpdates}
              disabled={isCheckingUpdate}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                updateCheckResult === 'none'
                  ? 'bg-green-600/20 text-green-400 border border-green-600/30'
                  : updateCheckResult === 'available'
                  ? 'bg-pdm-accent/20 text-pdm-accent border border-pdm-accent/30'
                  : 'bg-pdm-highlight text-pdm-fg-muted hover:text-pdm-fg hover:bg-pdm-highlight/80'
              }`}
            >
              {isCheckingUpdate ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Checking...
                </>
              ) : updateCheckResult === 'none' ? (
                <>
                  <CheckCircle size={14} />
                  Up to date
                </>
              ) : updateCheckResult === 'available' ? (
                <>
                  <Download size={14} />
                  Available
                </>
              ) : (
                <>
                  <RefreshCw size={14} />
                  Check for Updates
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* File Extensions */}
      <div className="space-y-3">
        <label className="text-xs text-pdm-fg-muted uppercase tracking-wide font-medium">
          File Extensions
        </label>
        <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-border">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-pdm-fg">Lowercase Extensions on Upload</div>
              <div className="text-xs text-pdm-fg-muted mt-0.5">
                Convert .SLDPRT to .sldprt when checking in files
              </div>
            </div>
            <button
              onClick={() => setLowercaseExtensions(!lowercaseExtensions)}
              className="text-pdm-accent"
            >
              {lowercaseExtensions ? (
                <ToggleRight size={28} />
              ) : (
                <ToggleLeft size={28} className="text-pdm-fg-muted" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Ignore Patterns */}
      <div className="space-y-3">
        <label className="text-xs text-pdm-fg-muted uppercase tracking-wide font-medium">
          Ignore Patterns (Keep Local Only)
        </label>
        <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-border space-y-3">
          <p className="text-xs text-pdm-fg-muted">
            Files matching these patterns will stay local and not sync to cloud.
          </p>
          
          {/* Add new pattern */}
          <div className="flex gap-2">
            <input
              type="text"
              value={newIgnorePattern}
              onChange={(e) => setNewIgnorePattern(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddIgnorePattern()
              }}
              placeholder="e.g., *.tmp, .git/*, thumbs.db"
              className="flex-1 bg-pdm-bg-secondary border border-pdm-border rounded-lg px-3 py-2 text-sm focus:border-pdm-accent focus:outline-none font-mono"
              disabled={!activeVaultId}
            />
            <button
              onClick={handleAddIgnorePattern}
              disabled={!newIgnorePattern.trim() || !activeVaultId}
              className="btn btn-primary btn-sm flex items-center gap-1"
            >
              <Plus size={14} />
              Add
            </button>
          </div>
          
          {!activeVaultId && (
            <p className="text-xs text-pdm-warning">
              Connect to a vault to manage ignore patterns.
            </p>
          )}
          
          {/* Pattern list */}
          {currentVaultPatterns.length > 0 ? (
            <div className="space-y-1">
              {currentVaultPatterns.map((pattern, index) => (
                <div 
                  key={index}
                  className="flex items-center gap-2 px-3 py-2 bg-pdm-bg-secondary rounded-lg group"
                >
                  <FileText size={14} className="text-pdm-fg-muted flex-shrink-0" />
                  <code className="flex-1 text-sm font-mono text-pdm-fg">{pattern}</code>
                  <button
                    onClick={() => activeVaultId && removeIgnorePattern(activeVaultId, pattern)}
                    className="p-1 text-pdm-fg-muted hover:text-pdm-error rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : activeVaultId ? (
            <p className="text-xs text-pdm-fg-dim text-center py-2">
              No ignore patterns configured
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

