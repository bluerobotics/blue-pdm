import { useState, useEffect } from 'react'
import { Loader2, Check, Eye, EyeOff, Puzzle, ShoppingCart, RefreshCw, AlertCircle, Plug, ExternalLink } from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase } from '../../lib/supabase'

interface OdooSettingsData {
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
const DEFAULT_API_URL = 'http://127.0.0.1:3001'

function getApiUrl(organization: { settings?: { api_url?: string } } | null): string {
  return organization?.settings?.api_url 
    || localStorage.getItem(API_URL_KEY) 
    || import.meta.env.VITE_API_URL 
    || DEFAULT_API_URL
}

async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token || null
}

export function OdooSettings() {
  const { user, organization, addToast } = usePDMStore()
  
  const apiUrl = getApiUrl(organization)
  
  const [settings, setSettings] = useState<OdooSettingsData | null>(null)
  const [url, setUrl] = useState('')
  const [database, setDatabase] = useState('')
  const [username, setUsername] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [apiServerOnline, setApiServerOnline] = useState<boolean | null>(null)
  
  useEffect(() => {
    loadSettings()
  }, [])
  
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
  
  const loadSettings = async () => {
    setIsLoading(true)
    try {
      const token = await getAuthToken()
      if (!token) {
        console.warn('[OdooSettings] No auth token available')
        setIsLoading(false)
        return
      }

      const response = await fetch(`${apiUrl}/integrations/odoo`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        signal: AbortSignal.timeout(5000)
      })
      
      setApiServerOnline(true)
      
      if (response.ok) {
        const data = await response.json()
        setSettings(data)
        if (data.configured && data.settings) {
          setUrl(data.settings.url || '')
          setDatabase(data.settings.database || '')
          setUsername(data.settings.username || '')
          setEnabled(true)
        }
      }
    } catch (err) {
      if (err instanceof TypeError && err.message.includes('fetch')) {
        setApiServerOnline(false)
      }
      console.error('Failed to load Odoo settings:', err)
    } finally {
      setIsLoading(false)
    }
  }
  
  const handleTest = async () => {
    if (!url || !database || !username || !apiKey) {
      addToast('warning', 'Please fill in all Odoo fields')
      return
    }

    const token = await getAuthToken()
    if (!token) {
      addToast('error', 'Session expired. Please log in again.')
      return
    }

    setIsTesting(true)
    setTestResult(null)

    try {
      const response = await fetch(`${apiUrl}/integrations/odoo/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          url, 
          database, 
          username, 
          api_key: apiKey 
        }),
        signal: AbortSignal.timeout(15000)
      })

      const data = await response.json()

      if (response.ok) {
        setTestResult({ success: true, message: `Connected! User: ${data.user_name}, Odoo ${data.version}` })
      } else {
        setTestResult({ success: false, message: data.message || data.error || 'Connection failed' })
      }
    } catch (err) {
      if (err instanceof TypeError && err.message.includes('fetch')) {
        setApiServerOnline(false)
        setTestResult({ success: false, message: 'API server is offline. Run "npm run api" locally.' })
      } else {
        setTestResult({ success: false, message: String(err) })
      }
    } finally {
      setIsTesting(false)
    }
  }
  
  const handleSave = async () => {
    if (!url || !database || !username || !apiKey) {
      addToast('warning', 'Please fill in all Odoo fields')
      return
    }

    const token = await getAuthToken()
    if (!token) {
      addToast('error', 'Session expired. Please log in again.')
      return
    }

    setIsSaving(true)

    try {
      const response = await fetch(`${apiUrl}/integrations/odoo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          url, 
          database, 
          username, 
          api_key: apiKey 
        })
      })

      const data = await response.json()

      if (response.ok) {
        addToast('success', 'Odoo integration configured successfully!')
        loadSettings()
      } else {
        addToast('error', data.message || data.error || 'Failed to save configuration')
      }
    } catch (err) {
      addToast('error', `Error: ${err}`)
    } finally {
      setIsSaving(false)
    }
  }
  
  const handleSync = async () => {
    const token = await getAuthToken()
    if (!token) {
      addToast('error', 'Session expired. Please log in again.')
      return
    }

    setIsSyncing(true)

    try {
      const response = await fetch(`${apiUrl}/integrations/odoo/sync/suppliers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      })

      const data = await response.json()

      if (response.ok) {
        addToast('success', `Synced ${data.created} new, ${data.updated} updated suppliers from Odoo`)
        loadSettings()
      } else {
        addToast('error', data.message || data.error || 'Sync failed')
      }
    } catch (err) {
      addToast('error', `Sync error: ${err}`)
    } finally {
      setIsSyncing(false)
    }
  }
  
  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect Odoo?')) return

    const token = await getAuthToken()
    if (!token) {
      addToast('error', 'Session expired. Please log in again.')
      return
    }

    try {
      const response = await fetch(`${apiUrl}/integrations/odoo`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.ok) {
        addToast('info', 'Odoo integration disconnected')
        setSettings(null)
        setUrl('')
        setDatabase('')
        setUsername('')
        setApiKey('')
        setEnabled(false)
        setTestResult(null)
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
          Only administrators can manage Odoo integration.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
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
        {isLoading && <Loader2 size={16} className="animate-spin text-pdm-fg-muted" />}
        {settings?.is_connected && (
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
            onClick={() => setEnabled(!enabled)}
            disabled={apiServerOnline === false}
            className={`w-11 h-6 rounded-full transition-colors relative ${
              enabled ? 'bg-pdm-accent' : 'bg-pdm-border'
            } ${apiServerOnline === false ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
        
        {enabled && apiServerOnline !== false && (
          <>
            {/* Status banner if connected */}
            {settings?.is_connected && (
              <div className="flex items-center justify-between p-3 bg-pdm-success/10 border border-pdm-success/30 rounded-lg text-sm">
                <div className="flex items-center gap-2 text-pdm-success">
                  <Check size={16} />
                  <span>Connected to {settings.settings?.url}</span>
                </div>
                {settings.last_sync_at && (
                  <span className="text-pdm-fg-muted text-xs">
                    Last sync: {new Date(settings.last_sync_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            )}
            
            {/* Odoo URL */}
            <div className="space-y-2">
              <label className="text-sm text-pdm-fg-muted">Odoo URL</label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
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
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
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
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin@mycompany.com"
                className="w-full px-3 py-2 text-base bg-pdm-sidebar border border-pdm-border rounded-lg focus:outline-none focus:border-pdm-accent"
              />
            </div>
            
            {/* API Key */}
            <div className="space-y-2">
              <label className="text-sm text-pdm-fg-muted">API Key</label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={settings?.is_connected ? '••••••••••••' : 'Enter API key'}
                  className="w-full px-3 py-2 pr-10 text-base bg-pdm-sidebar border border-pdm-border rounded-lg focus:outline-none focus:border-pdm-accent font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-pdm-fg-muted hover:text-pdm-fg"
                >
                  {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="text-xs text-pdm-fg-muted">
                Generate at: Odoo → Settings → Users → [Your User] → API Keys
              </p>
            </div>
            
            {/* Test result */}
            {testResult && (
              <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                testResult.success 
                  ? 'bg-pdm-success/10 text-pdm-success border border-pdm-success/30' 
                  : 'bg-pdm-error/10 text-pdm-error border border-pdm-error/30'
              }`}>
                {testResult.success ? <Check size={16} /> : <AlertCircle size={16} />}
                {testResult.message}
              </div>
            )}
            
            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={handleTest}
                disabled={isTesting || !url || !database || !username || !apiKey}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-base bg-pdm-sidebar border border-pdm-border text-pdm-fg rounded-lg hover:bg-pdm-highlight transition-colors disabled:opacity-50"
              >
                {isTesting ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />}
                Test Connection
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || !url || !database || !username || !apiKey}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-base bg-pdm-accent text-white rounded-lg hover:bg-pdm-accent/90 transition-colors disabled:opacity-50"
              >
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                Save & Connect
              </button>
            </div>
            
            {/* Sync and disconnect when connected */}
            {settings?.is_connected && (
              <div className="flex gap-2 pt-2 border-t border-pdm-border">
                <button
                  onClick={handleSync}
                  disabled={isSyncing}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-base bg-pdm-success/20 hover:bg-pdm-success/30 text-pdm-success rounded-lg transition-colors disabled:opacity-50"
                >
                  {isSyncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                  Sync Suppliers Now
                </button>
                <button
                  onClick={handleDisconnect}
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
  )
}

