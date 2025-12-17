import { useState, useEffect } from 'react'
import { 
  Plug, 
  MessageSquare, 
  ShoppingCart, 
  Settings, 
  Check, 
  X, 
  Loader2,
  RefreshCw,
  ExternalLink,
  Eye,
  EyeOff,
  AlertCircle
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase } from '../../lib/supabase'

const API_URL_KEY = 'blueplm_api_url'
const DEFAULT_API_URL = 'http://127.0.0.1:3001'

// Helper to get API URL from org settings or localStorage
function getApiUrl(organization: { settings?: { api_url?: string } } | null): string {
  return organization?.settings?.api_url || localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL
}

// Helper to get valid auth token
async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token || null
}

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

interface IntegrationCardProps {
  icon: React.ReactNode
  name: string
  description: string
  connected?: boolean
  onClick?: () => void
}

function IntegrationCard({ icon, name, description, connected, onClick }: IntegrationCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-3 p-3 bg-plm-highlight rounded hover:bg-plm-highlight/80 transition-colors text-left"
    >
      <div className="relative w-10 h-10 rounded-lg bg-plm-bg flex items-center justify-center flex-shrink-0">
        {icon}
        {/* Connection status dot */}
        {connected !== undefined && (
          <div 
            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-plm-highlight ${
              connected ? 'bg-plm-success' : 'bg-plm-fg-muted'
            }`}
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-plm-fg">{name}</span>
          {connected && (
            <span className="px-1.5 py-0.5 text-[9px] font-medium bg-plm-success/20 text-plm-success rounded">
              CONNECTED
            </span>
          )}
        </div>
        <p className="text-xs text-plm-fg-muted mt-0.5 line-clamp-2">{description}</p>
      </div>
    </button>
  )
}

function OdooConfigPanel({ 
  settings, 
  onClose, 
  onSave,
  onRefresh
}: { 
  settings: OdooSettings | null
  onClose: () => void
  onSave: () => void
  onRefresh: () => void
}) {
  const { addToast, organization, getEffectiveRole } = usePDMStore()
  const isAdmin = getEffectiveRole() === 'admin'
  const [url, setUrl] = useState(settings?.settings?.url || '')
  const [database, setDatabase] = useState(settings?.settings?.database || '')
  const [username, setUsername] = useState(settings?.settings?.username || '')
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  const apiUrl = getApiUrl(organization)

  const handleTest = async () => {
    if (!url || !database || !username || !apiKey) {
      addToast('warning', 'Please fill in all fields')
      return
    }

    const token = await getAuthToken()
    if (!token) {
      addToast('error', 'Session expired. Please log in again.')
      return
    }

    setTesting(true)
    setTestResult(null)

    try {
      const response = await fetch(`${apiUrl}/integrations/odoo/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ url, database, username, api_key: apiKey })
      })

      const data = await response.json()

      if (response.ok) {
        setTestResult({ success: true, message: `Connected! User: ${data.user_name}, Odoo ${data.version}` })
      } else {
        setTestResult({ success: false, message: data.message || 'Connection failed' })
      }
    } catch (err) {
      setTestResult({ success: false, message: String(err) })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async (skipTest: boolean = false) => {
    if (!url || !database || !username || !apiKey) {
      addToast('warning', 'Please fill in all fields')
      return
    }

    const token = await getAuthToken()
    if (!token) {
      addToast('error', 'Session expired. Please log in again.')
      console.error('[IntegrationsView] No auth token available')
      return
    }

    console.log('[IntegrationsView] Saving with token:', token.substring(0, 20) + '...')

    setSaving(true)

    try {
      const response = await fetch(`${apiUrl}/integrations/odoo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ url, database, username, api_key: apiKey, skip_test: skipTest })
      })

      const data = await response.json()
      console.log('[IntegrationsView] Response:', response.status, data)

      if (response.ok) {
        if (data.connection_error) {
          addToast('warning', `Saved! But connection failed: ${data.connection_error}`)
        } else {
          addToast('success', data.message || 'Odoo credentials saved!')
        }
        onSave()
        onRefresh()
      } else {
        // Show more detailed error for auth issues
        if (response.status === 401) {
          addToast('error', `Auth failed: ${data.message || 'Check API server Supabase config'}`)
        } else {
          addToast('error', data.message || 'Failed to save configuration')
        }
      }
    } catch (err) {
      console.error('[IntegrationsView] Error:', err)
      addToast('error', `Error: ${err}`)
    } finally {
      setSaving(false)
    }
  }

  const handleSync = async () => {
    const token = await getAuthToken()
    if (!token) {
      addToast('error', 'Session expired. Please log in again.')
      return
    }

    setSyncing(true)

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
        onRefresh()
      } else {
        addToast('error', data.message || 'Sync failed')
      }
    } catch (err) {
      addToast('error', `Sync error: ${err}`)
    } finally {
      setSyncing(false)
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
        onRefresh()
        onClose()
      }
    } catch (err) {
      addToast('error', `Error: ${err}`)
    }
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#714B67] flex items-center justify-center">
            <ShoppingCart size={16} className="text-white" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-plm-fg">Odoo Integration</h3>
            <p className="text-[10px] text-plm-fg-muted">Sync suppliers from your Odoo ERP</p>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="p-1 text-plm-fg-muted hover:text-plm-fg transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Admin notice for non-admins */}
      {!isAdmin && (
        <div className="flex items-center gap-2 p-2 bg-plm-info/10 border border-plm-info/30 rounded text-xs text-plm-info">
          <AlertCircle size={14} className="flex-shrink-0" />
          <span>Only administrators can edit integration settings.</span>
        </div>
      )}

      {/* Status banner if connected */}
      {settings?.is_connected && (
        <div className="flex items-center justify-between p-2 bg-plm-success/10 border border-plm-success/30 rounded text-xs">
          <div className="flex items-center gap-2 text-plm-success">
            <Check size={14} />
            <span>Connected to {settings.settings?.url}</span>
          </div>
          {settings.last_sync_at && (
            <span className="text-plm-fg-muted">
              Last sync: {new Date(settings.last_sync_at).toLocaleDateString()}
            </span>
          )}
        </div>
      )}

      {/* Configuration form */}
      <div className="space-y-3">
        <div>
          <label className="text-xs text-plm-fg-muted block mb-1">Odoo URL</label>
          <input
            type="url"
            value={url}
            onChange={(e) => isAdmin && setUrl(e.target.value)}
            placeholder="https://mycompany.odoo.com"
            readOnly={!isAdmin}
            className={`w-full px-3 py-2 bg-plm-input border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted focus:outline-none focus:border-plm-accent ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
          />
        </div>

        <div>
          <label className="text-xs text-plm-fg-muted block mb-1">Database</label>
          <input
            type="text"
            value={database}
            onChange={(e) => isAdmin && setDatabase(e.target.value)}
            placeholder="mycompany-main"
            readOnly={!isAdmin}
            className={`w-full px-3 py-2 bg-plm-input border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted focus:outline-none focus:border-plm-accent ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
          />
        </div>

        <div>
          <label className="text-xs text-plm-fg-muted block mb-1">Username (Email)</label>
          <input
            type="email"
            value={username}
            onChange={(e) => isAdmin && setUsername(e.target.value)}
            placeholder="admin@mycompany.com"
            readOnly={!isAdmin}
            className={`w-full px-3 py-2 bg-plm-input border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted focus:outline-none focus:border-plm-accent ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
          />
        </div>

        <div>
          <label className="text-xs text-plm-fg-muted block mb-1">API Key</label>
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => isAdmin && setApiKey(e.target.value)}
              placeholder={settings?.is_connected ? '••••••••••••' : 'Enter API key'}
              readOnly={!isAdmin}
              className={`w-full px-3 py-2 pr-10 bg-plm-input border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted focus:outline-none focus:border-plm-accent ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
            />
            <button
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg"
            >
              {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className="text-[10px] text-plm-fg-muted mt-1">
            Generate at: Odoo → Settings → Users → API Keys
          </p>
        </div>

        {/* Test result */}
        {testResult && (
          <div className={`flex items-center gap-2 p-2 rounded text-xs ${
            testResult.success 
              ? 'bg-plm-success/10 text-plm-success' 
              : 'bg-plm-error/10 text-plm-error'
          }`}>
            {testResult.success ? <Check size={14} /> : <AlertCircle size={14} />}
            {testResult.message}
          </div>
        )}
      </div>

      {/* Actions - only show for admins */}
      {isAdmin && (
        <div className="grid grid-cols-3 gap-2 pt-2">
          <button
            onClick={handleTest}
            disabled={testing || !url || !database || !username || !apiKey}
            className="flex items-center justify-center gap-2 px-3 py-2 bg-plm-sidebar border border-plm-border hover:bg-plm-highlight text-plm-fg rounded text-sm font-medium transition-colors disabled:opacity-50"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
            Test
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={saving || !url || !database || !username || !apiKey}
            className="flex items-center justify-center gap-2 px-3 py-2 bg-plm-sidebar border border-plm-border hover:bg-plm-highlight text-plm-fg rounded text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Save
          </button>
          <button
            onClick={() => handleSave(false)}
            disabled={saving || !url || !database || !username || !apiKey}
            className="flex items-center justify-center gap-2 px-3 py-2 bg-plm-accent hover:bg-plm-accent/90 text-white rounded text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Save & Test
          </button>
        </div>
      )}

      {/* Sync and disconnect when connected - only show for admins */}
      {settings?.is_connected && isAdmin && (
        <div className="flex gap-2 pt-2 border-t border-plm-border">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-plm-success/20 hover:bg-plm-success/30 text-plm-success rounded text-sm font-medium transition-colors disabled:opacity-50"
          >
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Sync Suppliers Now
          </button>
          <button
            onClick={handleDisconnect}
            className="px-3 py-2 text-plm-error hover:bg-plm-error/10 rounded text-sm transition-colors"
          >
            Disconnect
          </button>
        </div>
      )}

      {/* Help link */}
      <div className="pt-2 border-t border-plm-border">
        <a
          href="https://www.odoo.com/documentation/17.0/developer/reference/external_api.html"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-plm-accent hover:underline"
        >
          <ExternalLink size={12} />
          Odoo API Documentation
        </a>
      </div>
    </div>
  )
}

export function IntegrationsView() {
  const { organization } = usePDMStore()
  const [showOdooConfig, setShowOdooConfig] = useState(false)
  const [odooSettings, setOdooSettings] = useState<OdooSettings | null>(null)
  const [, setLoading] = useState(true)

  const apiUrl = getApiUrl(organization)

  const loadOdooSettings = async () => {
    try {
      const token = await getAuthToken()
      if (!token) {
        console.warn('[IntegrationsView] No auth token available')
        setLoading(false)
        return
      }

      const response = await fetch(`${apiUrl}/integrations/odoo`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      
      if (response.ok) {
        const data = await response.json()
        setOdooSettings(data)
      } else {
        console.warn('[IntegrationsView] Failed to load Odoo settings:', response.status)
      }
    } catch (err) {
      console.error('Failed to load Odoo settings:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOdooSettings()
  }, [apiUrl])

  if (showOdooConfig) {
    return (
      <OdooConfigPanel
        settings={odooSettings}
        onClose={() => setShowOdooConfig(false)}
        onSave={() => setShowOdooConfig(false)}
        onRefresh={loadOdooSettings}
      />
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 space-y-3">
        <IntegrationCard
          icon={<ShoppingCart size={20} className="text-[#714B67]" />}
          name="Odoo"
          description="Sync suppliers, products, and BOMs from your Odoo ERP"
          connected={odooSettings?.is_connected}
          onClick={() => setShowOdooConfig(true)}
        />
        <IntegrationCard
          icon={<MessageSquare size={20} className="text-[#4A154B]" />}
          name="Slack"
          description="Approval reminders, review notifications, ECO channels"
        />
        <IntegrationCard
          icon={<Settings size={20} className="text-plm-fg-muted" />}
          name="Webhooks"
          description="Custom integrations via HTTP webhooks"
        />
      </div>
      
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-plm-highlight flex items-center justify-center mb-4">
          <Plug size={32} className="text-plm-fg-muted" />
        </div>
        <h3 className="text-sm font-medium text-plm-fg mb-2">Integrations Hub</h3>
        <p className="text-xs text-plm-fg-muted max-w-[200px]">
          Connect external services for automations, notifications, and data sync.
        </p>
        {!odooSettings?.is_connected && (
          <div className="mt-6 px-3 py-1.5 bg-plm-info/20 text-plm-info text-[10px] font-medium rounded">
            Click Odoo above to set up your first integration
          </div>
        )}
      </div>
    </div>
  )
}
