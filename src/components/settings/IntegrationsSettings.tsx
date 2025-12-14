import { useState, useEffect } from 'react'
import { HardDrive, Loader2, Check, Eye, EyeOff, Puzzle, ShoppingCart, RefreshCw, AlertCircle, Plug, ExternalLink, MessageSquare } from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase } from '../../lib/supabase'

interface OdooSettings {
  configured: boolean
  settings?: {
    url: string
    database: string
    username: string
  }
  is_connected: boolean
  last_sync_at: string | null
  last_sync_status: string | null
  last_sync_count: number | null
  auto_sync: boolean
}

const API_URL_KEY = 'bluepdm_api_url'
const DEFAULT_API_URL = 'http://localhost:3001'

// Get the configured API URL (org settings > localStorage > env > default)
function getApiUrl(organization: { settings?: { api_url?: string } } | null): string {
  return organization?.settings?.api_url 
    || localStorage.getItem(API_URL_KEY) 
    || import.meta.env.VITE_API_URL 
    || DEFAULT_API_URL
}

export function IntegrationsSettings() {
  const { user, organization, addToast } = usePDMStore()
  
  // Get the API URL from org settings or fallback
  const apiUrl = getApiUrl(organization)
  
  // Google Drive settings state
  const [gdriveClientId, setGdriveClientId] = useState('')
  const [gdriveClientSecret, setGdriveClientSecret] = useState('')
  const [gdriveEnabled, setGdriveEnabled] = useState(false)
  const [isLoadingGdrive, setIsLoadingGdrive] = useState(false)
  const [isSavingGdrive, setIsSavingGdrive] = useState(false)
  const [showGdriveSecret, setShowGdriveSecret] = useState(false)
  
  // API server status
  const [apiServerOnline, setApiServerOnline] = useState<boolean | null>(null)
  
  // Odoo settings state
  const [odooSettings, setOdooSettings] = useState<OdooSettings | null>(null)
  const [odooUrl, setOdooUrl] = useState('')
  const [odooDatabase, setOdooDatabase] = useState('')
  const [odooUsername, setOdooUsername] = useState('')
  const [odooApiKey, setOdooApiKey] = useState('')
  const [showOdooApiKey, setShowOdooApiKey] = useState(false)
  const [isLoadingOdoo, setIsLoadingOdoo] = useState(false)
  const [isSavingOdoo, setIsSavingOdoo] = useState(false)
  const [isTestingOdoo, setIsTestingOdoo] = useState(false)
  const [isSyncingOdoo, setIsSyncingOdoo] = useState(false)
  const [odooTestResult, setOdooTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [odooEnabled, setOdooEnabled] = useState(false)
  
  // Load settings on mount
  useEffect(() => {
    loadGdriveSettings()
    loadOdooSettings()
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
  
  // Check API server status
  const checkApiServer = async () => {
    try {
      const response = await fetch(`${apiUrl}/health`, {
        signal: AbortSignal.timeout(3000)
      })
      setApiServerOnline(response.ok)
      return response.ok
    } catch {
      setApiServerOnline(false)
      return false
    }
  }
  
  // Odoo functions
  const loadOdooSettings = async () => {
    setIsLoadingOdoo(true)
    try {
      const response = await fetch(`${apiUrl}/integrations/odoo`, {
        headers: {
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        },
        signal: AbortSignal.timeout(5000)
      })
      
      setApiServerOnline(true)
      
      if (response.ok) {
        const data = await response.json()
        setOdooSettings(data)
        if (data.configured && data.settings) {
          setOdooUrl(data.settings.url || '')
          setOdooDatabase(data.settings.database || '')
          setOdooUsername(data.settings.username || '')
          setOdooEnabled(true)
        }
      }
    } catch (err) {
      // Check if it's a connection error
      if (err instanceof TypeError && err.message.includes('fetch')) {
        setApiServerOnline(false)
      }
      console.error('Failed to load Odoo settings:', err)
    } finally {
      setIsLoadingOdoo(false)
    }
  }
  
  const handleTestOdoo = async () => {
    if (!odooUrl || !odooDatabase || !odooUsername || !odooApiKey) {
      addToast('warning', 'Please fill in all Odoo fields')
      return
    }

    setIsTestingOdoo(true)
    setOdooTestResult(null)

    try {
      const response = await fetch(`${apiUrl}/integrations/odoo/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        },
        body: JSON.stringify({ 
          url: odooUrl, 
          database: odooDatabase, 
          username: odooUsername, 
          api_key: odooApiKey 
        }),
        signal: AbortSignal.timeout(15000)
      })

      const data = await response.json()

      if (response.ok) {
        setOdooTestResult({ success: true, message: `Connected! User: ${data.user_name}, Odoo ${data.version}` })
      } else {
        setOdooTestResult({ success: false, message: data.message || data.error || 'Connection failed' })
      }
    } catch (err) {
      if (err instanceof TypeError && err.message.includes('fetch')) {
        setApiServerOnline(false)
        setOdooTestResult({ success: false, message: 'API server is offline. Run "npm run api" locally.' })
      } else {
        setOdooTestResult({ success: false, message: String(err) })
      }
    } finally {
      setIsTestingOdoo(false)
    }
  }
  
  const handleSaveOdoo = async () => {
    if (!odooUrl || !odooDatabase || !odooUsername || !odooApiKey) {
      addToast('warning', 'Please fill in all Odoo fields')
      return
    }

    setIsSavingOdoo(true)

    try {
      const response = await fetch(`${apiUrl}/integrations/odoo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        },
        body: JSON.stringify({ 
          url: odooUrl, 
          database: odooDatabase, 
          username: odooUsername, 
          api_key: odooApiKey 
        })
      })

      const data = await response.json()

      if (response.ok) {
        addToast('success', 'Odoo integration configured successfully!')
        loadOdooSettings()
      } else {
        addToast('error', data.message || data.error || 'Failed to save configuration')
      }
    } catch (err) {
      addToast('error', `Error: ${err}`)
    } finally {
      setIsSavingOdoo(false)
    }
  }
  
  const handleSyncOdoo = async () => {
    setIsSyncingOdoo(true)

    try {
      const response = await fetch(`${apiUrl}/integrations/odoo/sync/suppliers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        }
      })

      const data = await response.json()

      if (response.ok) {
        addToast('success', `Synced ${data.created} new, ${data.updated} updated suppliers from Odoo`)
        loadOdooSettings()
      } else {
        addToast('error', data.message || data.error || 'Sync failed')
      }
    } catch (err) {
      addToast('error', `Sync error: ${err}`)
    } finally {
      setIsSyncingOdoo(false)
    }
  }
  
  const handleDisconnectOdoo = async () => {
    if (!confirm('Are you sure you want to disconnect Odoo?')) return

    try {
      const response = await fetch(`${apiUrl}/integrations/odoo`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        }
      })

      if (response.ok) {
        addToast('info', 'Odoo integration disconnected')
        setOdooSettings(null)
        setOdooUrl('')
        setOdooDatabase('')
        setOdooUsername('')
        setOdooApiKey('')
        setOdooEnabled(false)
        setOdooTestResult(null)
      }
    } catch (err) {
      addToast('error', `Error: ${err}`)
    }
  }

  if (user?.role !== 'admin') {
    return (
      <div className="text-center py-12">
        <Puzzle size={40} className="mx-auto mb-4 text-pdm-fg-muted opacity-50" />
        <p className="text-base text-pdm-fg-muted">
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
            <h3 className="text-base font-medium text-pdm-fg">Google Drive</h3>
            <p className="text-sm text-pdm-fg-muted">
              Allow org members to connect their Google Drive
            </p>
          </div>
          {isLoadingGdrive && <Loader2 size={16} className="animate-spin text-pdm-fg-muted" />}
        </div>
        
        <div className="space-y-4 p-4 bg-pdm-bg rounded-lg border border-pdm-border">
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <span className="text-base text-pdm-fg">Enable Google Drive</span>
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
                <label className="text-sm text-pdm-fg-muted">Client ID</label>
                <input
                  type="text"
                  value={gdriveClientId}
                  onChange={(e) => setGdriveClientId(e.target.value)}
                  placeholder="xxxxxxx.apps.googleusercontent.com"
                  className="w-full px-3 py-2 text-base bg-pdm-sidebar border border-pdm-border rounded-lg focus:outline-none focus:border-pdm-accent font-mono"
                />
              </div>
              
              {/* Client Secret */}
              <div className="space-y-2">
                <label className="text-sm text-pdm-fg-muted">Client Secret</label>
                <div className="relative">
                  <input
                    type={showGdriveSecret ? 'text' : 'password'}
                    value={gdriveClientSecret}
                    onChange={(e) => setGdriveClientSecret(e.target.value)}
                    placeholder="GOCSPX-xxxxxxxxxxxx"
                    className="w-full px-3 py-2 pr-10 text-base bg-pdm-sidebar border border-pdm-border rounded-lg focus:outline-none focus:border-pdm-accent font-mono"
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
                <p className="text-sm text-pdm-fg-muted font-medium mb-2">Setup instructions:</p>
                <ol className="text-sm text-pdm-fg-muted space-y-1 list-decimal list-inside">
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
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-base bg-pdm-accent text-white rounded-lg hover:bg-pdm-accent/90 transition-colors disabled:opacity-50"
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
      
      {/* Odoo Integration */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-[#714B67] flex items-center justify-center">
            <ShoppingCart size={24} className="text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-medium text-pdm-fg">Odoo ERP</h3>
            <p className="text-sm text-pdm-fg-muted">
              Sync suppliers, products, and BOMs from your Odoo instance
            </p>
          </div>
          {isLoadingOdoo && <Loader2 size={16} className="animate-spin text-pdm-fg-muted" />}
          {odooSettings?.is_connected && (
            <span className="px-2 py-1 text-xs font-medium bg-pdm-success/20 text-pdm-success rounded">
              CONNECTED
            </span>
          )}
        </div>
        
        <div className="space-y-4 p-4 bg-pdm-bg rounded-lg border border-pdm-border">
          {/* API Server Offline Warning */}
          {apiServerOnline === false && (
            <div className="flex items-start gap-3 p-3 bg-pdm-warning/10 border border-pdm-warning/30 rounded-lg">
              <AlertCircle size={18} className="text-pdm-warning flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <div className="font-medium text-pdm-warning">API Server Offline</div>
                <p className="text-pdm-fg-muted mt-1">
                  Odoo integration requires the BluePDM API server.{' '}
                  <span className="text-pdm-fg">Run <code className="px-1.5 py-0.5 bg-pdm-sidebar rounded">npm run api</code> locally</span>
                  {' '}or configure an external API URL in Settings → REST API.
                </p>
                <button
                  onClick={checkApiServer}
                  className="mt-2 text-pdm-accent hover:underline flex items-center gap-1"
                >
                  <RefreshCw size={12} />
                  Retry connection
                </button>
              </div>
            </div>
          )}
          
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <span className="text-base text-pdm-fg">Enable Odoo Integration</span>
            <button
              onClick={() => setOdooEnabled(!odooEnabled)}
              disabled={apiServerOnline === false}
              className={`w-11 h-6 rounded-full transition-colors relative ${
                odooEnabled ? 'bg-pdm-accent' : 'bg-pdm-border'
              } ${apiServerOnline === false ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                odooEnabled ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>
          
          {odooEnabled && apiServerOnline !== false && (
            <>
              {/* Status banner if connected */}
              {odooSettings?.is_connected && (
                <div className="flex items-center justify-between p-3 bg-pdm-success/10 border border-pdm-success/30 rounded-lg text-sm">
                  <div className="flex items-center gap-2 text-pdm-success">
                    <Check size={16} />
                    <span>Connected to {odooSettings.settings?.url}</span>
                  </div>
                  {odooSettings.last_sync_at && (
                    <span className="text-pdm-fg-muted text-xs">
                      Last sync: {new Date(odooSettings.last_sync_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              )}
              
              {/* Odoo URL */}
              <div className="space-y-2">
                <label className="text-sm text-pdm-fg-muted">Odoo URL</label>
                <input
                  type="text"
                  value={odooUrl}
                  onChange={(e) => setOdooUrl(e.target.value)}
                  placeholder="https://mycompany.odoo.com or erp.mycompany.com"
                  className="w-full px-3 py-2 text-base bg-pdm-sidebar border border-pdm-border rounded-lg focus:outline-none focus:border-pdm-accent font-mono"
                />
                <p className="text-xs text-pdm-fg-muted">https:// will be added automatically if not provided</p>
              </div>
              
              {/* Database */}
              <div className="space-y-2">
                <label className="text-sm text-pdm-fg-muted">Database</label>
                <input
                  type="text"
                  value={odooDatabase}
                  onChange={(e) => setOdooDatabase(e.target.value)}
                  placeholder="master or mycompany-main"
                  className="w-full px-3 py-2 text-base bg-pdm-sidebar border border-pdm-border rounded-lg focus:outline-none focus:border-pdm-accent font-mono"
                />
                <p className="text-xs text-pdm-fg-muted">
                  Find at: your-odoo-url/web/database/manager
                </p>
              </div>
              
              {/* Username */}
              <div className="space-y-2">
                <label className="text-sm text-pdm-fg-muted">Username (Email)</label>
                <input
                  type="email"
                  value={odooUsername}
                  onChange={(e) => setOdooUsername(e.target.value)}
                  placeholder="admin@mycompany.com"
                  className="w-full px-3 py-2 text-base bg-pdm-sidebar border border-pdm-border rounded-lg focus:outline-none focus:border-pdm-accent"
                />
              </div>
              
              {/* API Key */}
              <div className="space-y-2">
                <label className="text-sm text-pdm-fg-muted">API Key</label>
                <div className="relative">
                  <input
                    type={showOdooApiKey ? 'text' : 'password'}
                    value={odooApiKey}
                    onChange={(e) => setOdooApiKey(e.target.value)}
                    placeholder={odooSettings?.is_connected ? '••••••••••••' : 'Enter API key'}
                    className="w-full px-3 py-2 pr-10 text-base bg-pdm-sidebar border border-pdm-border rounded-lg focus:outline-none focus:border-pdm-accent font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOdooApiKey(!showOdooApiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-pdm-fg-muted hover:text-pdm-fg"
                  >
                    {showOdooApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="text-xs text-pdm-fg-muted">
                  Generate at: Odoo → Settings → Users → [Your User] → API Keys
                </p>
              </div>
              
              {/* Test result */}
              {odooTestResult && (
                <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                  odooTestResult.success 
                    ? 'bg-pdm-success/10 text-pdm-success border border-pdm-success/30' 
                    : 'bg-pdm-error/10 text-pdm-error border border-pdm-error/30'
                }`}>
                  {odooTestResult.success ? <Check size={16} /> : <AlertCircle size={16} />}
                  {odooTestResult.message}
                </div>
              )}
              
              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleTestOdoo}
                  disabled={isTestingOdoo || !odooUrl || !odooDatabase || !odooUsername || !odooApiKey}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-base bg-pdm-sidebar border border-pdm-border text-pdm-fg rounded-lg hover:bg-pdm-highlight transition-colors disabled:opacity-50"
                >
                  {isTestingOdoo ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />}
                  Test Connection
                </button>
                <button
                  onClick={handleSaveOdoo}
                  disabled={isSavingOdoo || !odooUrl || !odooDatabase || !odooUsername || !odooApiKey}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-base bg-pdm-accent text-white rounded-lg hover:bg-pdm-accent/90 transition-colors disabled:opacity-50"
                >
                  {isSavingOdoo ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  Save & Connect
                </button>
              </div>
              
              {/* Sync and disconnect when connected */}
              {odooSettings?.is_connected && (
                <div className="flex gap-2 pt-2 border-t border-pdm-border">
                  <button
                    onClick={handleSyncOdoo}
                    disabled={isSyncingOdoo}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-base bg-pdm-success/20 hover:bg-pdm-success/30 text-pdm-success rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isSyncingOdoo ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                    Sync Suppliers Now
                  </button>
                  <button
                    onClick={handleDisconnectOdoo}
                    className="px-4 py-2.5 text-base text-pdm-error hover:bg-pdm-error/10 rounded-lg transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              )}
              
              {/* Help link */}
              <div className="pt-2">
                <a
                  href="https://www.odoo.com/documentation/17.0/developer/reference/external_api.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-pdm-accent hover:underline"
                >
                  <ExternalLink size={14} />
                  Odoo API Documentation
                </a>
              </div>
            </>
          )}
        </div>
      </div>
      
      {/* Slack Integration */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-[#4A154B] flex items-center justify-center">
            <MessageSquare size={24} className="text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-medium text-pdm-fg">Slack</h3>
            <p className="text-sm text-pdm-fg-muted">
              Approval reminders, review notifications, ECO channels
            </p>
          </div>
          <span className="px-2 py-1 text-xs font-medium bg-pdm-fg-muted/20 text-pdm-fg-muted rounded">
            COMING SOON
          </span>
        </div>
        
        <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-border">
          <p className="text-sm text-pdm-fg-muted">
            Slack integration will enable:
          </p>
          <ul className="mt-2 text-sm text-pdm-fg-muted list-disc list-inside space-y-1">
            <li>Automatic notifications for pending approvals</li>
            <li>ECO status updates in dedicated channels</li>
            <li>Review reminders and escalations</li>
            <li>File check-in/check-out alerts</li>
          </ul>
        </div>
      </div>
      
      {/* Webhooks Integration */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-pdm-sidebar flex items-center justify-center">
            <Plug size={24} className="text-pdm-fg-muted" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-medium text-pdm-fg">Webhooks</h3>
            <p className="text-sm text-pdm-fg-muted">
              Custom integrations via HTTP webhooks
            </p>
          </div>
          <span className="px-2 py-1 text-xs font-medium bg-pdm-fg-muted/20 text-pdm-fg-muted rounded">
            COMING SOON
          </span>
        </div>
        
        <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-border">
          <p className="text-sm text-pdm-fg-muted">
            Webhooks will allow you to:
          </p>
          <ul className="mt-2 text-sm text-pdm-fg-muted list-disc list-inside space-y-1">
            <li>Trigger external workflows on file events</li>
            <li>Send data to your custom endpoints</li>
            <li>Integrate with any HTTP-compatible service</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

