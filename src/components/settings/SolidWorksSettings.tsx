import { useState, useEffect, useCallback } from 'react'
import { Image, ExternalLink, FolderOpen, Info, Key, Play, Square, Loader2, Check, EyeOff, Eye, FileX, X, RefreshCw, Database } from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase } from '../../lib/supabase'
import { executeCommand } from '../../lib/commands'

// Cast supabase client to bypass known v2 type inference issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

// Extended status type that includes both SW API and DM API status
interface ServiceStatus {
  running: boolean
  version?: string
  swInstalled?: boolean
  dmApiAvailable?: boolean
  dmApiError?: string | null
  error?: string
}

// Hook to manage SolidWorks service connection (minimal version for settings)
function useSolidWorksServiceStatus() {
  const [status, setStatus] = useState<ServiceStatus>({ running: false })
  const [isStarting, setIsStarting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const { addToast, organization, autoStartSolidworksService } = usePDMStore()
  
  // Get DM license key from organization settings
  const dmLicenseKey = organization?.settings?.solidworks_dm_license_key

  const checkStatus = useCallback(async () => {
    try {
      const result = await window.electronAPI?.solidworks?.getServiceStatus()
      if (result?.success && result.data) {
        const data = result.data as any
        setStatus({ 
          running: data.running,
          version: data.version,
          swInstalled: data.installed ?? data.swInstalled,
          dmApiAvailable: data.documentManagerAvailable ?? data.fastModeEnabled,
          dmApiError: data.documentManagerError,
          error: undefined
        })
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
        const data = result.data as any
        setStatus({ 
          running: true, 
          version: data?.version,
          swInstalled: data?.swInstalled,
          dmApiAvailable: data?.documentManagerAvailable ?? data?.fastModeEnabled,
          dmApiError: data?.documentManagerError,
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
    addToast,
    cadPreviewMode, 
    setCadPreviewMode,
    solidworksIntegrationEnabled,
    setSolidworksIntegrationEnabled,
    solidworksPath,
    setSolidworksPath,
    autoStartSolidworksService,
    setAutoStartSolidworksService,
    hideSolidworksTempFiles,
    setHideSolidworksTempFiles,
    ignoreSolidworksTempFiles,
    setIgnoreSolidworksTempFiles,
    getEffectiveRole
  } = usePDMStore()
  
  const { status, isStarting, isStopping, startService, stopService, checkStatus, hasError } = useSolidWorksServiceStatus()
  const isAdmin = getEffectiveRole() === 'admin'
  
  // Local state for DM license key input
  const [dmLicenseKeyInput, setDmLicenseKeyInput] = useState(organization?.settings?.solidworks_dm_license_key || '')
  const [isSavingLicenseKey, setIsSavingLicenseKey] = useState(false)
  const [showLicenseKey, setShowLicenseKey] = useState(false)
  
  // Vault metadata sync state
  const [isSyncingMetadata, setIsSyncingMetadata] = useState(false)
  const [lastMetadataSyncResult, setLastMetadataSyncResult] = useState<{ updated: number; unchanged: number; failed: number } | null>(null)
  
  // Update local state when organization changes
  useEffect(() => {
    setDmLicenseKeyInput(organization?.settings?.solidworks_dm_license_key || '')
  }, [organization?.settings?.solidworks_dm_license_key])
  
  const hasUnsavedLicenseKey = dmLicenseKeyInput !== (organization?.settings?.solidworks_dm_license_key || '')
  
  const handleSaveLicenseKey = async () => {
    const log = (msg: string) => window.electronAPI?.log?.('info', `[SWSettings] ${msg}`)
    const logError = (msg: string) => window.electronAPI?.log?.('error', `[SWSettings] ${msg}`)
    
    log('handleSaveLicenseKey called')
    log(`organization: ${organization?.id}`)
    log(`dmLicenseKeyInput length: ${dmLicenseKeyInput?.length}`)
    log(`status.running: ${status.running}`)
    
    if (!organization) {
      log('No organization, aborting')
      return
    }
    setIsSavingLicenseKey(true)
    try {
      const newKey = dmLicenseKeyInput || null
      log(`newKey: ${newKey ? `${newKey.length} chars` : 'null'}`)
      
      // Fetch current settings from database first to avoid overwriting other fields
      log('Fetching current org settings...')
      const { data: currentOrg, error: fetchError } = await db
        .from('organizations')
        .select('settings')
        .eq('id', organization.id)
        .single()
      
      if (fetchError) {
        logError(`Failed to fetch current settings: ${JSON.stringify(fetchError)}`)
      }
      log(`Current settings keys: ${Object.keys(currentOrg?.settings || {}).join(', ')}`)
      
      const currentSettings = currentOrg?.settings || organization.settings || {}
      const newSettings = { ...currentSettings, solidworks_dm_license_key: newKey }
      log(`New settings keys: ${Object.keys(newSettings).join(', ')}`)
      log(`solidworks_dm_license_key in new settings: ${newSettings.solidworks_dm_license_key ? 'present' : 'null'}`)
      
      log('Updating organization settings in DB...')
      const { data: updateResult, error } = await db
        .from('organizations')
        .update({ settings: newSettings })
        .eq('id', organization.id)
        .select('settings')
        .single()
      
      if (error) {
        logError(`DB update error: ${JSON.stringify(error)}`)
        throw error
      }
      
      // Verify the update actually worked (RLS can silently block updates)
      if (!updateResult) {
        logError('Update returned no data - likely blocked by RLS. Are you an admin?')
        throw new Error('Update failed - you may not have permission to modify organization settings')
      }
      
      // Verify the key was actually saved
      if (newKey && updateResult.settings?.solidworks_dm_license_key !== newKey) {
        logError(`Key mismatch after save! Expected: ${newKey?.length} chars, got: ${updateResult.settings?.solidworks_dm_license_key?.length || 0} chars`)
        throw new Error('License key was not saved correctly')
      }
      
      log('DB update successful - verified key in response')
      
      setOrganization({
        ...organization,
        settings: newSettings
      })
      log('Local organization state updated')
      
      // If service is running and we have a new key, send it to the service
      log(`Checking if should send to service: newKey=${!!newKey}, status.running=${status.running}`)
      if (newKey && status.running) {
        log('Sending license key to running service...')
        log(`Key prefix: ${newKey.substring(0, 30)}...`)
        const result = await window.electronAPI?.solidworks?.startService(newKey)
        log(`setDmLicense result: ${JSON.stringify(result)}`)
        if (result?.success) {
          addToast('success', 'Document Manager license key saved and applied')
          // Refresh status to pick up the change
          checkStatus()
        } else {
          addToast('warning', `License key saved but failed to apply: ${result?.error || 'Unknown error'}`)
        }
      } else {
        log(`Not sending to service - newKey: ${!!newKey}, running: ${status.running}`)
        addToast('success', 'Document Manager license key saved')
      }
    } catch (err) {
      logError(`Save failed: ${err}`)
      addToast('error', 'Failed to save license key')
    } finally {
      setIsSavingLicenseKey(false)
    }
  }
  
  const handleClearLicenseKey = async () => {
    if (!organization) return
    setIsSavingLicenseKey(true)
    try {
      // Fetch current settings from database first to avoid overwriting other fields
      const { data: currentOrg } = await db
        .from('organizations')
        .select('settings')
        .eq('id', organization.id)
        .single()
      
      const currentSettings = currentOrg?.settings || organization.settings || {}
      const newSettings = { ...currentSettings, solidworks_dm_license_key: null }
      
      const { data: updateResult, error } = await db
        .from('organizations')
        .update({ settings: newSettings })
        .eq('id', organization.id)
        .select('settings')
        .single()
      
      if (error) throw error
      
      // Verify the update actually worked (RLS can silently block updates)
      if (!updateResult) {
        throw new Error('Update failed - you may not have permission to modify organization settings')
      }
      
      setOrganization({
        ...organization,
        settings: newSettings
      })
      setDmLicenseKeyInput('')
      addToast('success', 'Document Manager license key cleared')
    } catch (err) {
      console.error('[SWSettings] Clear license key failed:', err)
      addToast('error', err instanceof Error ? err.message : 'Failed to clear license key')
    } finally {
      setIsSavingLicenseKey(false)
    }
  }
  
  // Get all synced SolidWorks files from the current store
  const { files } = usePDMStore()
  const swExtensions = ['.sldprt', '.sldasm', '.slddrw']
  const syncedSwFiles = files.filter(f => 
    !f.isDirectory && 
    f.pdmData?.id && 
    swExtensions.includes(f.extension.toLowerCase())
  )
  
  const handleSyncAllVaultMetadata = async () => {
    if (!status.running) {
      addToast('error', 'SolidWorks service must be running to sync metadata')
      return
    }
    
    if (syncedSwFiles.length === 0) {
      addToast('info', 'No SolidWorks files found in vault to sync')
      return
    }
    
    setIsSyncingMetadata(true)
    setLastMetadataSyncResult(null)
    
    try {
      const result = await executeCommand('sync-sw-metadata', { files: syncedSwFiles })
      
      // Parse result to show stats
      // Result message is like "Synced 10 files: 5 updated, 5 unchanged"
      const updated = result.details?.filter(d => d.includes('updated')).length || 
        (result.message?.match(/(\d+) updated/)?.[1] ? parseInt(result.message.match(/(\d+) updated/)![1]) : 0)
      const unchanged = result.message?.match(/(\d+) unchanged/)?.[1] 
        ? parseInt(result.message.match(/(\d+) unchanged/)![1]) 
        : result.succeeded - updated
      
      setLastMetadataSyncResult({
        updated: updated,
        unchanged: unchanged,
        failed: result.failed
      })
      
      if (result.failed > 0) {
        addToast('warning', `Synced ${result.succeeded}/${result.total} files. ${result.failed} failed.`)
      } else if (updated > 0) {
        addToast('success', `Metadata synced! ${updated} file${updated > 1 ? 's' : ''} updated.`)
      } else {
        addToast('info', 'All metadata is already up to date')
      }
    } catch (err) {
      addToast('error', `Metadata sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setIsSyncingMetadata(false)
    }
  }

  // Compute overall integration status:
  // Green: Both SW API and DM API are up
  // Yellow: SW API is down (no SW installed), but DM API is up  
  // Red: DM API is down
  const getOverallStatus = () => {
    if (!status.running) return 'stopped'
    if (status.dmApiAvailable) {
      return status.swInstalled ? 'online' : 'partial'
    }
    return 'offline'
  }
  
  const overallStatus = getOverallStatus()
  
  const overallStatusConfig = {
    online: { color: 'bg-green-500', textColor: 'text-green-400', label: 'Fully Connected', description: 'Both SolidWorks API and Document Manager API are available' },
    partial: { color: 'bg-yellow-500', textColor: 'text-yellow-400', label: 'Partial', description: 'Document Manager API is available, but SolidWorks is not installed' },
    offline: { color: 'bg-red-500', textColor: 'text-red-400', label: 'Limited', description: 'Document Manager API is not available' },
    stopped: { color: 'bg-plm-fg-dim', textColor: 'text-plm-fg-dim', label: 'Stopped', description: 'Service is not running' },
  }

  return (
    <div className="space-y-6">
      {/* Integration Enable/Disable Toggle */}
      <div className="space-y-3">
        <label className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
          SolidWorks Integration
        </label>
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-plm-fg">Enable SolidWorks Integration</div>
              <div className="text-xs text-plm-fg-muted">
                Enable SolidWorks features like BOM extraction, property reading, and file exports.
                Disable on computers without SolidWorks to hide status warnings.
              </div>
            </div>
            <button
              onClick={() => setSolidworksIntegrationEnabled(!solidworksIntegrationEnabled)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                solidworksIntegrationEnabled ? 'bg-plm-accent' : 'bg-plm-bg-secondary'
              }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  solidworksIntegrationEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Show remaining settings only when integration is enabled */}
      {!solidworksIntegrationEnabled ? (
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border text-center">
          <div className="text-sm text-plm-fg-muted">
            SolidWorks integration is disabled. Enable it above to configure SolidWorks features.
          </div>
        </div>
      ) : (
        <>
      {/* Service Control */}
      <div className="space-y-3">
        <label className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
          SolidWorks Service
        </label>
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border space-y-4">
          {/* Overall Integration Status Banner */}
          <div className={`flex items-center gap-3 p-3 rounded-lg border ${
            overallStatus === 'online' ? 'bg-green-500/10 border-green-500/30' :
            overallStatus === 'partial' ? 'bg-yellow-500/10 border-yellow-500/30' :
            overallStatus === 'offline' ? 'bg-red-500/10 border-red-500/30' :
            'bg-plm-bg-secondary border-plm-border'
          }`}>
            <div className={`w-3 h-3 rounded-full ${overallStatusConfig[overallStatus].color}`} />
            <div className="flex-1">
              <div className={`text-sm font-medium ${overallStatusConfig[overallStatus].textColor}`}>
                {overallStatusConfig[overallStatus].label}
              </div>
              <div className="text-xs text-plm-fg-muted">
                {overallStatusConfig[overallStatus].description}
              </div>
            </div>
          </div>

          {/* Detailed Status indicator */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-2">
                {/* SolidWorks API Status */}
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    status.running && status.swInstalled
                      ? 'bg-green-500' 
                      : status.running && !status.swInstalled
                        ? 'bg-yellow-500'
                        : hasError 
                          ? 'bg-red-500' 
                          : 'bg-plm-fg-dim'
                  }`} />
                  <span className="text-sm text-plm-fg-muted">SolidWorks API:</span>
                  <span className={`text-sm font-medium ${
                    status.running && status.swInstalled 
                      ? 'text-green-400' 
                      : status.running && !status.swInstalled
                        ? 'text-yellow-400'
                        : hasError 
                          ? 'text-red-400' 
                          : 'text-plm-fg-dim'
                  }`}>
                    {status.running 
                      ? (status.swInstalled ? 'Connected' : 'Not Installed')
                      : hasError ? 'Error' : 'Stopped'}
                  </span>
                </div>
                {/* Document Manager API Status */}
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    status.running && status.dmApiAvailable
                      ? 'bg-green-500'
                      : status.running && !status.dmApiAvailable
                        ? 'bg-red-500'
                        : 'bg-plm-fg-dim'
                  }`} />
                  <span className="text-sm text-plm-fg-muted">Document Manager API:</span>
                  <span className={`text-sm font-medium ${
                    status.running && status.dmApiAvailable
                      ? 'text-green-400'
                      : status.running && !status.dmApiAvailable
                        ? 'text-red-400'
                        : 'text-plm-fg-dim'
                  }`}>
                    {status.running 
                      ? (status.dmApiAvailable ? 'Connected' : 'Not Available')
                      : 'Stopped'}
                  </span>
                  {status.running && !status.dmApiAvailable && status.dmApiError && (
                    <span className="text-xs text-red-400/70" title={status.dmApiError}>
                      (No license key)
                    </span>
                  )}
                </div>
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

      {/* Temp Files (~$) */}
      <div className="space-y-3">
        <label className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
          Temporary Lock Files (~$)
        </label>
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border space-y-4">
          <div className="flex items-start gap-2 text-sm text-plm-fg-muted">
            <Info size={16} className="mt-0.5 flex-shrink-0" />
            <span>
              SolidWorks creates temporary <code className="px-1.5 py-0.5 bg-plm-bg-secondary rounded">~$filename.sldprt</code> lock files when files are open.
              These indicate a file is being edited and are automatically deleted when closed.
            </span>
          </div>
          
          {/* Hide toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-plm-border">
            <div className="flex items-center gap-3">
              <EyeOff size={18} className="text-plm-fg-muted" />
              <div>
                <div className="text-sm text-plm-fg">Hide from file browser</div>
                <div className="text-xs text-plm-fg-muted">
                  Don't show ~$ temp files in the file list
                </div>
              </div>
            </div>
            <button
              onClick={() => setHideSolidworksTempFiles(!hideSolidworksTempFiles)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                hideSolidworksTempFiles ? 'bg-plm-accent' : 'bg-plm-bg-secondary'
              }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  hideSolidworksTempFiles ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          
          {/* Ignore toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-plm-border">
            <div className="flex items-center gap-3">
              <FileX size={18} className="text-plm-fg-muted" />
              <div>
                <div className="text-sm text-plm-fg">Ignore from sync</div>
                <div className="text-xs text-plm-fg-muted">
                  Skip ~$ files during check-in and sync operations
                </div>
              </div>
            </div>
            <button
              onClick={() => setIgnoreSolidworksTempFiles(!ignoreSolidworksTempFiles)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                ignoreSolidworksTempFiles ? 'bg-plm-accent' : 'bg-plm-bg-secondary'
              }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  ignoreSolidworksTempFiles ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
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
                  if (result?.success && result.folderPath) {
                    setSolidworksPath(result.folderPath)
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
                <div className="flex items-center justify-between">
                  <label className="text-sm text-plm-fg-dim">License Key</label>
                  <button
                    type="button"
                    onClick={() => setShowLicenseKey(!showLicenseKey)}
                    className="text-xs text-plm-fg-muted hover:text-plm-fg flex items-center gap-1"
                  >
                    {showLicenseKey ? <EyeOff size={12} /> : <Eye size={12} />}
                    {showLicenseKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type={showLicenseKey ? 'text' : 'password'}
                    value={dmLicenseKeyInput}
                    onChange={(e) => setDmLicenseKeyInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && hasUnsavedLicenseKey) {
                        handleSaveLicenseKey()
                      }
                    }}
                    placeholder="COMPANYNAME:swdocmgr_general-...,swdocmgr_previews-...,swdocmgr_xml-..."
                    className="flex-1 px-3 py-2 bg-plm-bg-secondary border border-plm-border rounded-lg text-sm text-plm-fg placeholder-plm-fg-dim focus:outline-none focus:border-plm-accent font-mono"
                  />
                  <button
                    onClick={handleSaveLicenseKey}
                    disabled={!hasUnsavedLicenseKey || isSavingLicenseKey}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                      hasUnsavedLicenseKey
                        ? 'bg-plm-accent text-white hover:bg-plm-accent/80'
                        : 'bg-plm-bg-secondary text-plm-fg-dim cursor-not-allowed'
                    }`}
                  >
                    {isSavingLicenseKey ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Check size={14} />
                    )}
                    Save
                  </button>
                  {organization?.settings?.solidworks_dm_license_key && (
                    <button
                      onClick={handleClearLicenseKey}
                      disabled={isSavingLicenseKey}
                      className="px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30 disabled:opacity-50"
                      title="Clear license key"
                    >
                      <X size={14} />
                      Clear
                    </button>
                  )}
                </div>
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
                {organization?.settings?.solidworks_dm_license_key && !hasUnsavedLicenseKey && (
                  <div className="flex items-center gap-2 text-sm text-green-400">
                    <Check size={14} />
                    Direct file access enabled for all org users
                  </div>
                )}
                {hasUnsavedLicenseKey && (
                  <div className="text-sm text-yellow-400">
                    Unsaved changes
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

      {/* Vault Metadata Sync */}
      <div className="space-y-3">
        <label className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
          Vault Metadata Sync
        </label>
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border space-y-4">
          <div className="flex items-start gap-2 text-sm text-plm-fg-muted">
            <Database size={16} className="mt-0.5 flex-shrink-0" />
            <span>
              Extract part numbers, descriptions, and revisions from SolidWorks custom properties 
              and sync them to the database. This is useful after bulk imports or if metadata 
              wasn't extracted during initial check-in.
            </span>
          </div>
          
          {/* File count and sync button */}
          <div className="flex items-center justify-between pt-2 border-t border-plm-border">
            <div>
              <div className="text-sm text-plm-fg">
                {syncedSwFiles.length > 0 
                  ? `${syncedSwFiles.length} SolidWorks file${syncedSwFiles.length > 1 ? 's' : ''} in vault`
                  : 'No SolidWorks files found'
                }
              </div>
              <div className="text-xs text-plm-fg-muted">
                Parts, assemblies, and drawings with server records
              </div>
            </div>
            <button
              onClick={handleSyncAllVaultMetadata}
              disabled={isSyncingMetadata || !status.running || syncedSwFiles.length === 0}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                !status.running 
                  ? 'bg-plm-bg-secondary text-plm-fg-dim cursor-not-allowed'
                  : isSyncingMetadata
                    ? 'bg-plm-accent/50 text-white cursor-wait'
                    : 'bg-plm-accent text-white hover:bg-plm-accent/80'
              }`}
              title={!status.running ? 'Start the SolidWorks service first' : undefined}
            >
              {isSyncingMetadata ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              {isSyncingMetadata ? 'Syncing...' : 'Sync All Vault Metadata'}
            </button>
          </div>
          
          {/* Last sync result */}
          {lastMetadataSyncResult && (
            <div className="flex items-center gap-4 text-sm pt-2 border-t border-plm-border">
              <span className="text-plm-fg-muted">Last sync:</span>
              {lastMetadataSyncResult.updated > 0 && (
                <span className="text-green-400">
                  {lastMetadataSyncResult.updated} updated
                </span>
              )}
              {lastMetadataSyncResult.unchanged > 0 && (
                <span className="text-plm-fg-dim">
                  {lastMetadataSyncResult.unchanged} unchanged
                </span>
              )}
              {lastMetadataSyncResult.failed > 0 && (
                <span className="text-red-400">
                  {lastMetadataSyncResult.failed} failed
                </span>
              )}
            </div>
          )}
          
          {/* Warning if service not running */}
          {!status.running && (
            <div className="flex items-center gap-2 text-sm text-yellow-400 pt-2 border-t border-plm-border">
              <Info size={14} />
              Start the SolidWorks service to enable metadata extraction
            </div>
          )}
        </div>
      </div>
        </>
      )}
    </div>
  )
}

