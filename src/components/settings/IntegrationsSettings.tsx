import { useState, useEffect } from 'react'
import { HardDrive, Loader2, Check, Eye, EyeOff, Puzzle } from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase } from '../../lib/supabase'

export function IntegrationsSettings() {
  const { user, organization, addToast } = usePDMStore()
  
  // Google Drive settings state
  const [gdriveClientId, setGdriveClientId] = useState('')
  const [gdriveClientSecret, setGdriveClientSecret] = useState('')
  const [gdriveEnabled, setGdriveEnabled] = useState(false)
  const [isLoadingGdrive, setIsLoadingGdrive] = useState(false)
  const [isSavingGdrive, setIsSavingGdrive] = useState(false)
  const [showGdriveSecret, setShowGdriveSecret] = useState(false)
  
  // Load Google Drive settings on mount
  useEffect(() => {
    loadGdriveSettings()
  }, [])
  
  const loadGdriveSettings = async () => {
    if (!organization?.id) return
    
    setIsLoadingGdrive(true)
    try {
      const { data, error } = await (supabase.rpc as any)('get_google_drive_settings', {
        p_org_id: organization.id
      })
      
      if (error) {
        console.error('Error loading Google Drive settings:', error)
        return
      }
      
      if (data && Array.isArray(data) && data.length > 0) {
        const settings = data[0] as { client_id?: string; client_secret?: string; enabled?: boolean }
        setGdriveClientId(settings.client_id || '')
        setGdriveClientSecret(settings.client_secret || '')
        setGdriveEnabled(settings.enabled || false)
      }
    } catch (err) {
      console.error('Error loading Google Drive settings:', err)
    } finally {
      setIsLoadingGdrive(false)
    }
  }
  
  const saveGdriveSettings = async () => {
    if (!organization?.id || user?.role !== 'admin') return
    
    setIsSavingGdrive(true)
    try {
      const { error } = await (supabase.rpc as any)('update_google_drive_settings', {
        p_org_id: organization.id,
        p_client_id: gdriveClientId || null,
        p_client_secret: gdriveClientSecret || null,
        p_enabled: gdriveEnabled
      })
      
      if (error) {
        console.error('Error saving Google Drive settings:', error)
        addToast('error', 'Failed to save: ' + error.message)
        return
      }
      
      addToast('success', 'Google Drive settings saved')
    } catch (err) {
      console.error('Error saving Google Drive settings:', err)
      addToast('error', 'Failed to save Google Drive settings')
    } finally {
      setIsSavingGdrive(false)
    }
  }

  if (user?.role !== 'admin') {
    return (
      <div className="text-center py-12">
        <Puzzle size={40} className="mx-auto mb-4 text-pdm-fg-muted opacity-50" />
        <p className="text-sm text-pdm-fg-muted">
          Only administrators can manage integrations.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Google Drive Integration */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-pdm-sidebar flex items-center justify-center">
            <HardDrive size={24} className="text-pdm-accent" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-pdm-fg">Google Drive</h3>
            <p className="text-xs text-pdm-fg-muted">
              Allow org members to connect their Google Drive
            </p>
          </div>
          {isLoadingGdrive && <Loader2 size={16} className="animate-spin text-pdm-fg-muted" />}
        </div>
        
        <div className="space-y-4 p-4 bg-pdm-bg rounded-lg border border-pdm-border">
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-pdm-fg">Enable Google Drive</span>
            <button
              onClick={() => setGdriveEnabled(!gdriveEnabled)}
              className={`w-11 h-6 rounded-full transition-colors relative ${
                gdriveEnabled ? 'bg-pdm-accent' : 'bg-pdm-border'
              }`}
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                gdriveEnabled ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>
          
          {gdriveEnabled && (
            <>
              {/* Client ID */}
              <div className="space-y-2">
                <label className="text-xs text-pdm-fg-muted">Client ID</label>
                <input
                  type="text"
                  value={gdriveClientId}
                  onChange={(e) => setGdriveClientId(e.target.value)}
                  placeholder="xxxxxxx.apps.googleusercontent.com"
                  className="w-full px-3 py-2 text-sm bg-pdm-sidebar border border-pdm-border rounded-lg focus:outline-none focus:border-pdm-accent font-mono"
                />
              </div>
              
              {/* Client Secret */}
              <div className="space-y-2">
                <label className="text-xs text-pdm-fg-muted">Client Secret</label>
                <div className="relative">
                  <input
                    type={showGdriveSecret ? 'text' : 'password'}
                    value={gdriveClientSecret}
                    onChange={(e) => setGdriveClientSecret(e.target.value)}
                    placeholder="GOCSPX-xxxxxxxxxxxx"
                    className="w-full px-3 py-2 pr-10 text-sm bg-pdm-sidebar border border-pdm-border rounded-lg focus:outline-none focus:border-pdm-accent font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGdriveSecret(!showGdriveSecret)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-pdm-fg-muted hover:text-pdm-fg"
                  >
                    {showGdriveSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              
              {/* Help text */}
              <div className="p-4 bg-pdm-sidebar rounded-lg">
                <p className="text-xs text-pdm-fg-muted font-medium mb-2">Setup instructions:</p>
                <ol className="text-xs text-pdm-fg-muted space-y-1 list-decimal list-inside">
                  <li>
                    Go to{' '}
                    <a 
                      href="https://console.cloud.google.com/apis/credentials" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-pdm-accent hover:underline"
                    >
                      Google Cloud Console
                    </a>
                  </li>
                  <li>Create or select a project</li>
                  <li>Enable the Google Drive API</li>
                  <li>Create OAuth 2.0 credentials (Desktop app type)</li>
                  <li>Copy the Client ID and Client Secret here</li>
                </ol>
              </div>
              
              {/* Save button */}
              <button
                onClick={saveGdriveSettings}
                disabled={isSavingGdrive}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm bg-pdm-accent text-white rounded-lg hover:bg-pdm-accent/90 transition-colors disabled:opacity-50"
              >
                {isSavingGdrive ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Check size={16} />
                )}
                Save Google Drive Settings
              </button>
            </>
          )}
        </div>
      </div>
      
      {/* More integrations placeholder */}
      <div className="pt-4 border-t border-pdm-border">
        <p className="text-sm text-pdm-fg-muted text-center">
          More integrations coming soon...
        </p>
      </div>
    </div>
  )
}

