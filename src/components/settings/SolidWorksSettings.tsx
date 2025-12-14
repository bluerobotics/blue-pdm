import { useState, useEffect, useCallback } from 'react'
import { Image, ExternalLink, FolderOpen, Info, Key, Download, Play, Square, Loader2, Check } from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase } from '../../lib/supabase'

// Hook to manage SolidWorks service connection (minimal version for settings)
function useSolidWorksServiceStatus() {
  const [status, setStatus] = useState<{ running: boolean; version?: string; directAccessEnabled?: boolean; error?: string }>({ running: false })
  const [isStarting, setIsStarting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const { addToast, organization, autoStartSolidworksService } = usePDMStore()
  
  // Get DM license key from organization settings
  const dmLicenseKey = organization?.settings?.solidworks_dm_license_key

  const checkStatus = useCallback(async () => {
    try {
      const result = await window.electronAPI?.solidworks?.getServiceStatus()
      if (result?.success && result.data) {
        setStatus({ ...result.data, error: undefined })
      } else if (result?.error) {
        setStatus(prev => ({ ...prev, running: false, error: result.error }))
      }
    } catch (err) {
      setStatus({ running: false, error: String(err) })
    }
  }, [])

  const startService = useCallback(async () => {
    setIsStarting(true)
    try {
      const result = await window.electronAPI?.solidworks?.startService(dmLicenseKey || undefined)
      if (result?.success) {
        const directAccessEnabled = (result.data as any)?.fastModeEnabled
        setStatus({ 
          running: true, 
          version: (result.data as any)?.version,
          directAccessEnabled,
          error: undefined
        })
        addToast('success', 'SolidWorks service started')
      } else {
        setStatus({ running: false, error: result?.error || 'Failed to start' })
        addToast('error', result?.error || 'Failed to start SolidWorks service')
      }
    } catch (err) {
      setStatus({ running: false, error: String(err) })
      addToast('error', `Failed to start service: ${err}`)
    } finally {
      setIsStarting(false)
    }
  }, [addToast, dmLicenseKey])

  const stopService = useCallback(async () => {
    setIsStopping(true)
    try {
      const result = await window.electronAPI?.solidworks?.stopService()
      if (result?.success) {
        setStatus({ running: false, error: undefined })
        addToast('info', 'SolidWorks service stopped')
      } else {
        addToast('error', 'Failed to stop SolidWorks service')
      }
    } catch (err) {
      addToast('error', `Failed to stop service: ${err}`)
    } finally {
      setIsStopping(false)
    }
  }, [addToast])

  useEffect(() => {
    checkStatus()
    // Poll status every 5 seconds
    const interval = setInterval(checkStatus, 5000)
    return () => clearInterval(interval)
  }, [checkStatus])

  // Determine if we should show error state (auto-start enabled but not running with error)
  const hasError = autoStartSolidworksService && !status.running && !!status.error

  return { status, isStarting, isStopping, startService, stopService, checkStatus, hasError }
}

export function SolidWorksSettings() {
  const { 
    organization,
    setOrganization,
    user,
    addToast,
    cadPreviewMode, 
    setCadPreviewMode,
    solidworksPath,
    setSolidworksPath,
    autoStartSolidworksService,
    setAutoStartSolidworksService
  } = usePDMStore()
  
  const { status, isStarting, isStopping, startService, stopService, hasError } = useSolidWorksServiceStatus()
  const isAdmin = user?.role === 'admin'

  return (
    <div className="space-y-6">
      {/* Service Control */}
      <div className="space-y-3">
        <label className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
          SolidWorks Service
        </label>
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border space-y-4">
          {/* Status indicator */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${
                status.running 
                  ? 'bg-green-500' 
                  : hasError 
                    ? 'bg-red-500' 
                    : 'bg-plm-fg-dim'
              }`} />
              <div>
                <div className={`text-base font-medium ${hasError ? 'text-red-400' : 'text-plm-fg'}`}>
                  {status.running ? 'Running' : hasError ? 'Error' : 'Stopped'}
                </div>
                {status.running && (
                  <div className="text-sm text-plm-fg-muted">
                    {status.directAccessEnabled ? 'Fast mode (Document Manager)' : 'Using SolidWorks API'}
                  </div>
                )}
                {hasError && status.error && (
                  <div className="text-xs text-red-400/80 max-w-xs truncate" title={status.error}>
                    {status.error}
                  </div>
                )}
              </div>
            </div>
            
            {/* Start/Stop button */}
            {status.running ? (
              <button
                onClick={stopService}
                disabled={isStopping}
                className="flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/50 rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50"
              >
                {isStopping ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Square size={16} />
                )}
                {isStopping ? 'Stopping...' : 'Stop Service'}
              </button>
            ) : (
              <button
                onClick={startService}
                disabled={isStarting}
                className="flex items-center gap-2 px-4 py-2 bg-green-500/20 text-green-400 border border-green-500/50 rounded-lg hover:bg-green-500/30 transition-colors disabled:opacity-50"
              >
                {isStarting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Play size={16} />
                )}
                {isStarting ? 'Starting...' : 'Start Service'}
              </button>
            )}
          </div>
          
          {/* Auto-start toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-plm-border">
            <div>
              <div className="text-sm text-plm-fg">Auto-start on app launch</div>
              <div className="text-xs text-plm-fg-muted">
                Automatically start the service when BluePLM opens
              </div>
            </div>
            <button
              onClick={() => setAutoStartSolidworksService(!autoStartSolidworksService)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                autoStartSolidworksService ? 'bg-plm-accent' : 'bg-plm-bg-secondary'
              }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  autoStartSolidworksService ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          
          {/* Help text */}
          <div className="flex items-start gap-2 text-sm text-plm-fg-muted pt-2">
            <Info size={16} className="mt-0.5 flex-shrink-0" />
            <span>
              The SolidWorks service enables BOM extraction, property reading, and file export features.
              It requires SolidWorks to be installed on this computer.
            </span>
          </div>
        </div>
      </div>
      
      {/* Preview Mode */}
      <div className="space-y-3">
        <label className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
          Preview Mode
        </label>
        <div className="space-y-2">
          <button
            onClick={() => setCadPreviewMode('thumbnail')}
            className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-colors ${
              cadPreviewMode === 'thumbnail'
                ? 'bg-plm-accent/10 border-plm-accent text-plm-fg'
                : 'bg-plm-bg border-plm-border text-plm-fg-muted hover:border-plm-fg-muted'
            }`}
          >
            <Image size={24} className={cadPreviewMode === 'thumbnail' ? 'text-plm-accent' : ''} />
            <div className="text-left">
              <div className="text-base font-medium">Embedded Thumbnail</div>
              <div className="text-sm opacity-70">
                Extract and show preview image from SolidWorks file
              </div>
            </div>
          </button>

          <button
            onClick={() => setCadPreviewMode('edrawings')}
            className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-colors ${
              cadPreviewMode === 'edrawings'
                ? 'bg-plm-accent/10 border-plm-accent text-plm-fg'
                : 'bg-plm-bg border-plm-border text-plm-fg-muted hover:border-plm-fg-muted'
            }`}
          >
            <ExternalLink size={24} className={cadPreviewMode === 'edrawings' ? 'text-plm-accent' : ''} />
            <div className="text-left">
              <div className="text-base font-medium">eDrawings (External)</div>
              <div className="text-sm opacity-70">
                Open files in external eDrawings application
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Installation Path */}
      <div className="space-y-3">
        <label className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
          SolidWorks Installation Path
        </label>
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border space-y-3">
          <div className="flex items-start gap-3">
            <FolderOpen size={20} className="text-plm-fg-muted mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0 flex gap-2">
              <input
                type="text"
                value={solidworksPath || ''}
                onChange={(e) => setSolidworksPath(e.target.value || null)}
                placeholder="C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS"
                className="flex-1 bg-plm-bg-secondary border border-plm-border rounded-lg px-3 py-2 text-base font-mono text-plm-fg placeholder:text-plm-fg-dim focus:border-plm-accent focus:outline-none"
              />
              <button
                onClick={async () => {
                  const result = await window.electronAPI?.selectFolder()
                  if (result?.success && result.path) {
                    setSolidworksPath(result.path)
                  }
                }}
                className="px-3 py-2 bg-plm-bg-secondary border border-plm-border rounded-lg text-sm text-plm-fg hover:border-plm-accent transition-colors flex-shrink-0"
              >
                Browse
              </button>
            </div>
          </div>
          <div className="flex items-start gap-2 text-sm text-plm-fg-muted">
            <Info size={16} className="mt-0.5 flex-shrink-0" />
            <span>Only needed if SolidWorks is installed in a non-default location.</span>
          </div>
        </div>
      </div>

      {/* Document Manager License */}
      <div className="space-y-3">
        <label className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
          Document Manager License (Organization-wide)
        </label>
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border space-y-3">
          {isAdmin ? (
            <>
              <p className="text-sm text-plm-fg-muted">
                Enter your organization's Document Manager API license key to enable direct file reading.
              </p>
              <div className="space-y-2">
                <label className="text-sm text-plm-fg-dim">License Key</label>
                <input
                  type="password"
                  value={organization?.settings?.solidworks_dm_license_key || ''}
                  onChange={async (e) => {
                    const newKey = e.target.value || null
                    if (!organization) return
                    try {
                      const { error } = await supabase
                        .from('organizations')
                        .update({ 
                          settings: { 
                            ...organization.settings, 
                            solidworks_dm_license_key: newKey 
                          } 
                        })
                        .eq('id', organization.id)
                      if (error) throw error
                      setOrganization({
                        ...organization,
                        settings: { ...organization.settings, solidworks_dm_license_key: newKey || undefined }
                      })
                      addToast('success', 'SolidWorks license key updated')
                    } catch (err) {
                      addToast('error', 'Failed to save license key')
                    }
                  }}
                  placeholder="Enter your organization's DM API license key"
                  className="w-full px-3 py-2 bg-plm-bg-secondary border border-plm-border rounded-lg text-base text-plm-fg placeholder-plm-fg-dim focus:outline-none focus:border-plm-accent font-mono"
                />
                <p className="text-sm text-plm-fg-dim">
                  Free with SolidWorks subscription.{' '}
                  <a 
                    href="https://customerportal.solidworks.com/" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-plm-accent hover:underline"
                    onClick={(e) => {
                      e.preventDefault()
                      window.electronAPI?.openFile('https://customerportal.solidworks.com/')
                    }}
                  >
                    Request key →
                  </a>
                </p>
                {organization?.settings?.solidworks_dm_license_key && (
                  <div className="flex items-center gap-2 text-sm text-green-400">
                    <Check size={14} />
                    Direct file access enabled for all org users
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <Key 
                  size={22} 
                  className={organization?.settings?.solidworks_dm_license_key ? 'text-green-400' : 'text-plm-fg-muted'} 
                />
                <span className="text-base text-plm-fg">
                  {organization?.settings?.solidworks_dm_license_key ? (
                    <span className="text-green-400 font-medium">Configured</span>
                  ) : (
                    <span className="text-plm-fg-muted">Not configured</span>
                  )}
                </span>
              </div>
              <div className="text-sm text-plm-fg-muted space-y-2">
                {organization?.settings?.solidworks_dm_license_key ? (
                  <p>Using fast Document Manager API for file reading.</p>
                ) : (
                  <p>Using SolidWorks API (slower, launches SW in background).</p>
                )}
                <p className="pt-1 text-plm-fg-dim">
                  Ask an organization admin to configure the license key.
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* eDrawings download link */}
      <div className="pt-2">
        <a
          href="https://www.solidworks.com/support/free-downloads"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-base text-plm-accent hover:underline"
          onClick={(e) => {
            e.preventDefault()
            window.electronAPI?.openFile('https://www.solidworks.com/support/free-downloads')
          }}
        >
          <Download size={18} />
          Download eDrawings Viewer (Free)
        </a>
      </div>
    </div>
  )
}

