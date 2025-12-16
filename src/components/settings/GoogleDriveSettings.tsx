import { useState, useEffect } from 'react'
import { HardDrive, Loader2, Check, Eye, EyeOff, Puzzle } from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase } from '../../lib/supabase'

export function GoogleDriveSettings() {
  const { user, organization, addToast, getEffectiveRole } = usePDMStore()
  const isAdmin = getEffectiveRole() === 'admin'
  
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  
  useEffect(() => {
    loadSettings()
  }, [organization?.id])
  
  const loadSettings = async () => {
    if (!organization?.id) return
    
    setIsLoading(true)
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
        setClientId(settings.client_id || '')
        setClientSecret(settings.client_secret || '')
        setEnabled(settings.enabled || false)
      }
    } catch (err) {
      console.error('Error loading Google Drive settings:', err)
    } finally {
      setIsLoading(false)
    }
  }
  
  const saveSettings = async () => {
    if (!organization?.id || !isAdmin) return
    
    setIsSaving(true)
    try {
      const { error } = await (supabase.rpc as any)('update_google_drive_settings', {
        p_org_id: organization.id,
        p_client_id: clientId || null,
        p_client_secret: clientSecret || null,
        p_enabled: enabled
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
      setIsSaving(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="text-center py-12">
        <Puzzle size={40} className="mx-auto mb-4 text-plm-fg-muted opacity-50" />
        <p className="text-base text-plm-fg-muted">
          Only administrators can manage Google Drive integration.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-lg bg-plm-sidebar flex items-center justify-center">
          <HardDrive size={24} className="text-plm-accent" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-medium text-plm-fg">Google Drive</h3>
          <p className="text-sm text-plm-fg-muted">
            Allow org members to connect their Google Drive
          </p>
        </div>
        {isLoading && <Loader2 size={16} className="animate-spin text-plm-fg-muted" />}
      </div>
      
      <div className="space-y-4 p-4 bg-plm-bg rounded-lg border border-plm-border">
        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <span className="text-base text-plm-fg">Enable Google Drive</span>
          <button
            onClick={() => setEnabled(!enabled)}
            className={`w-11 h-6 rounded-full transition-colors relative ${
              enabled ? 'bg-plm-accent' : 'bg-plm-border'
            }`}
          >
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
        
        {enabled && (
          <>
            {/* Client ID */}
            <div className="space-y-2">
              <label className="text-sm text-plm-fg-muted">Client ID</label>
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="xxxxxxx.apps.googleusercontent.com"
                className="w-full px-3 py-2 text-base bg-plm-sidebar border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent font-mono"
              />
            </div>
            
            {/* Client Secret */}
            <div className="space-y-2">
              <label className="text-sm text-plm-fg-muted">Client Secret</label>
              <div className="relative">
                <input
                  type={showSecret ? 'text' : 'password'}
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="GOCSPX-xxxxxxxxxxxx"
                  className="w-full px-3 py-2 pr-10 text-base bg-plm-sidebar border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg"
                >
                  {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            
            {/* Help text */}
            <div className="p-4 bg-plm-sidebar rounded-lg">
              <p className="text-sm text-plm-fg-muted font-medium mb-2">Setup instructions:</p>
              <ol className="text-sm text-plm-fg-muted space-y-1 list-decimal list-inside">
                <li>
                  Go to{' '}
                  <a 
                    href="https://console.cloud.google.com/apis/credentials" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-plm-accent hover:underline"
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
              onClick={saveSettings}
              disabled={isSaving}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-base bg-plm-accent text-white rounded-lg hover:bg-plm-accent/90 transition-colors disabled:opacity-50"
            >
              {isSaving ? (
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
  )
}

