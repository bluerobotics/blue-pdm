import { useState, useEffect } from 'react'
import { 
  Loader2, Check, Eye, EyeOff, Puzzle, ShoppingCart, RefreshCw, 
  AlertCircle, Plug, ExternalLink, Save, FolderOpen, Trash2, 
  Plus, X, Edit2
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase } from '../../lib/supabase'

interface OdooSettingsData {
  configured: boolean
  settings?: {
    url: string
    database: string
    username: string
    config_id?: string
    config_name?: string
  }
  is_connected: boolean
  last_sync_at: string | null
  last_sync_status: string | null
  last_sync_count: number | null
  auto_sync: boolean
}

interface SavedConfig {
  id: string
  name: string
  description: string | null
  url: string
  database: string
  username: string
  color: string | null
  is_active: boolean
  last_tested_at: string | null
  last_test_success: boolean | null
  created_at: string
}

const API_URL_KEY = 'blueplm_api_url'
const DEFAULT_API_URL = 'http://127.0.0.1:3001'

// Preset colors for saved configurations
const CONFIG_COLORS = [
  { name: 'Green', value: '#22c55e' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Purple', value: '#8b5cf6' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Red', value: '#ef4444' },
]

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
  const { organization, addToast, getEffectiveRole } = usePDMStore()
  const isAdmin = getEffectiveRole() === 'admin'
  
  const apiUrl = getApiUrl(organization)
  
  // Current active settings
  const [settings, setSettings] = useState<OdooSettingsData | null>(null)
  
  // Form fields
  const [url, setUrl] = useState('')
  const [database, setDatabase] = useState('')
  const [username, setUsername] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  
  // Saved configurations
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([])
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [configName, setConfigName] = useState('')
  const [configDescription, setConfigDescription] = useState('')
  const [configColor, setConfigColor] = useState(CONFIG_COLORS[0].value)
  const [editingConfig, setEditingConfig] = useState<SavedConfig | null>(null)
  
  // Loading states
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isSavingConfig, setIsSavingConfig] = useState(false)
  const [isLoadingConfigs, setIsLoadingConfigs] = useState(false)
  const [activatingConfigId, setActivatingConfigId] = useState<string | null>(null)
  
  // UI state
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [apiServerOnline, setApiServerOnline] = useState<boolean | null>(null)
  
  useEffect(() => {
    loadSettings()
    loadSavedConfigs()
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
  
  const loadSavedConfigs = async () => {
    setIsLoadingConfigs(true)
    try {
      const token = await getAuthToken()
      if (!token) return
      
      const response = await fetch(`${apiUrl}/integrations/odoo/configs`, {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(5000)
      })
      
      if (response.ok) {
        const data = await response.json()
        setSavedConfigs(data.configs || [])
      }
    } catch (err) {
      console.error('Failed to load saved configs:', err)
    } finally {
      setIsLoadingConfigs(false)
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
        body: JSON.stringify({ url, database, username, api_key: apiKey }),
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
  
  const handleSave = async (skipTest: boolean = false) => {
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
        body: JSON.stringify({ url, database, username, api_key: apiKey, skip_test: skipTest })
      })

      const data = await response.json()

      if (response.ok) {
        if (data.connection_error) {
          addToast('warning', `Saved! But connection failed: ${data.connection_error}`)
        } else {
          addToast('success', data.message || 'Odoo credentials saved!')
        }
        loadSettings()
        // Always refresh saved configs list (new config may have been auto-created)
        loadSavedConfigs()
      } else {
        if (response.status === 401) {
          addToast('error', `Auth failed: ${data.message || 'Check API server Supabase config'}`)
        } else {
          addToast('error', data.message || data.error || 'Failed to save configuration')
        }
      }
    } catch (err) {
      console.error('[OdooSettings] Error:', err)
      addToast('error', `Error: ${err}`)
    } finally {
      setIsSaving(false)
    }
  }
  
  const handleSaveConfig = async (andConnect: boolean = true) => {
    if (!configName.trim()) {
      addToast('warning', 'Please enter a configuration name')
      return
    }
    if (!url || !database || !username || !apiKey) {
      addToast('warning', 'Please fill in all Odoo fields first')
      return
    }

    const token = await getAuthToken()
    if (!token) {
      addToast('error', 'Session expired. Please log in again.')
      return
    }

    setIsSavingConfig(true)

    try {
      const endpoint = editingConfig 
        ? `${apiUrl}/integrations/odoo/configs/${editingConfig.id}`
        : `${apiUrl}/integrations/odoo/configs`
      
      const method = editingConfig ? 'PUT' : 'POST'
      
      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: configName.trim(),
          description: configDescription.trim() || null,
          url,
          database,
          username,
          api_key: apiKey,
          color: configColor,
          skip_test: !andConnect  // Skip connection test when just saving
        })
      })

      const data = await response.json()

      if (response.ok) {
        const configId = data.config?.id || editingConfig?.id
        
        // Only activate if andConnect is true
        if (andConnect && configId) {
          try {
            const activateResponse = await fetch(`${apiUrl}/integrations/odoo/configs/${configId}/activate`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}` }
            })
            const activateData = await activateResponse.json()
            
            if (activateResponse.ok) {
              addToast(activateData.connected ? 'success' : 'warning', 
                activateData.connected 
                  ? `"${configName}" saved and connected!`
                  : `"${configName}" saved but connection failed: ${activateData.message}`)
              loadSettings()
            } else {
              addToast('warning', `Configuration saved but activation failed: ${activateData.message}`)
            }
          } catch {
            addToast('warning', 'Configuration saved but failed to activate')
          }
        } else {
          addToast('success', data.message || `Configuration "${configName}" saved!`)
        }
        
        setShowSaveDialog(false)
        setConfigName('')
        setConfigDescription('')
        setConfigColor(CONFIG_COLORS[0].value)
        setEditingConfig(null)
        loadSavedConfigs()
      } else {
        addToast('error', data.message || 'Failed to save configuration')
      }
    } catch (err) {
      addToast('error', `Error: ${err}`)
    } finally {
      setIsSavingConfig(false)
    }
  }
  
  const handleLoadConfig = async (config: SavedConfig) => {
    const token = await getAuthToken()
    if (!token) {
      addToast('error', 'Session expired. Please log in again.')
      return
    }

    try {
      // Fetch full config with API key
      const response = await fetch(`${apiUrl}/integrations/odoo/configs/${config.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (response.ok) {
        const data = await response.json()
        setUrl(data.url)
        setDatabase(data.database)
        setUsername(data.username)
        setApiKey(data.api_key || '')
        addToast('info', `Loaded "${config.name}" - click Save & Test to activate`)
      } else {
        addToast('error', 'Failed to load configuration')
      }
    } catch (err) {
      addToast('error', `Error: ${err}`)
    }
  }
  
  const handleActivateConfig = async (config: SavedConfig) => {
    const token = await getAuthToken()
    if (!token) {
      addToast('error', 'Session expired. Please log in again.')
      return
    }

    setActivatingConfigId(config.id)

    try {
      const response = await fetch(`${apiUrl}/integrations/odoo/configs/${config.id}/activate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const data = await response.json()

      if (response.ok) {
        addToast(data.connected ? 'success' : 'warning', data.message)
        loadSettings()
        loadSavedConfigs()
      } else {
        addToast('error', data.message || 'Failed to activate configuration')
      }
    } catch (err) {
      addToast('error', `Error: ${err}`)
    } finally {
      setActivatingConfigId(null)
    }
  }
  
  const handleDeleteConfig = async (config: SavedConfig) => {
    if (!confirm(`Delete configuration "${config.name}"?`)) return

    const token = await getAuthToken()
    if (!token) {
      addToast('error', 'Session expired. Please log in again.')
      return
    }

    try {
      const response = await fetch(`${apiUrl}/integrations/odoo/configs/${config.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (response.ok) {
        addToast('info', `Deleted "${config.name}"`)
        loadSavedConfigs()
      } else {
        addToast('error', 'Failed to delete configuration')
      }
    } catch (err) {
      addToast('error', `Error: ${err}`)
    }
  }
  
  const handleEditConfig = (config: SavedConfig) => {
    setEditingConfig(config)
    setConfigName(config.name)
    setConfigDescription(config.description || '')
    setConfigColor(config.color || CONFIG_COLORS[0].value)
    // Load the config values into form
    handleLoadConfig(config).then(() => {
      setShowSaveDialog(true)
    })
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
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (response.ok) {
        addToast('info', 'Odoo integration disconnected')
        setSettings(null)
        setUrl('')
        setDatabase('')
        setUsername('')
        setApiKey('')
        setTestResult(null)
      }
    } catch (err) {
      addToast('error', `Error: ${err}`)
    }
  }

  // Find active config if any
  const activeConfig = savedConfigs.find(c => c.id === settings?.settings?.config_id)

  return (
    <div className="space-y-6">
      {/* Admin notice for non-admins */}
      {!isAdmin && (
        <div className="flex items-center gap-2 p-3 bg-plm-info/10 border border-plm-info/30 rounded-lg text-sm text-plm-info">
          <Puzzle size={16} className="flex-shrink-0" />
          <span>Only administrators can edit integration settings.</span>
        </div>
      )}
      
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-lg bg-[#714B67] flex items-center justify-center">
          <ShoppingCart size={24} className="text-white" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-medium text-plm-fg">Odoo ERP</h3>
          <p className="text-sm text-plm-fg-muted">
            Sync suppliers, products, and BOMs from your Odoo instance
          </p>
        </div>
        {isLoading && <Loader2 size={16} className="animate-spin text-plm-fg-muted" />}
        {settings?.is_connected && (
          <span className="px-2 py-1 text-xs font-medium bg-plm-success/20 text-plm-success rounded">
            CONNECTED
          </span>
        )}
      </div>
      
      <div className="space-y-4 p-4 bg-plm-bg rounded-lg border border-plm-border">
        {/* API Server Offline Warning */}
        {apiServerOnline === false && (
          <div className="flex items-start gap-3 p-3 bg-plm-warning/10 border border-plm-warning/30 rounded-lg">
            <AlertCircle size={18} className="text-plm-warning flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-medium text-plm-warning">API Server Offline</div>
              <p className="text-plm-fg-muted mt-1">
                Odoo integration requires the BluePLM API server.{' '}
                <span className="text-plm-fg">Run <code className="px-1.5 py-0.5 bg-plm-sidebar rounded">npm run api</code> locally</span>
                {' '}or configure an external API URL in Settings → REST API.
              </p>
              <button
                onClick={checkApiServer}
                className="mt-2 text-plm-accent hover:underline flex items-center gap-1"
              >
                <RefreshCw size={12} />
                Retry connection
              </button>
            </div>
          </div>
        )}
        
        {/* Saved Configurations Section - Always visible when API is online */}
        {apiServerOnline !== false && (
          <>
            <div className="border border-plm-border rounded-lg overflow-hidden">
              {/* Header with Add button */}
              <div className="flex items-center justify-between px-3 py-2.5 bg-plm-sidebar border-b border-plm-border">
                <div className="flex items-center gap-2">
                  <FolderOpen size={16} className="text-plm-fg-muted" />
                  <span className="text-sm font-medium text-plm-fg">Saved Configurations</span>
                  {savedConfigs.length > 0 && (
                    <span className="px-1.5 py-0.5 text-xs bg-plm-accent/20 text-plm-accent rounded">
                      {savedConfigs.length}
                    </span>
                  )}
                </div>
                {isAdmin && (
                  <button
                    onClick={() => {
                      setEditingConfig(null)
                      setConfigName('')
                      setConfigDescription('')
                      setConfigColor(CONFIG_COLORS[0].value)
                      // Clear form for new config
                      setUrl('')
                      setDatabase('')
                      setUsername('')
                      setApiKey('')
                      setTestResult(null)
                      setShowSaveDialog(true)
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-plm-accent bg-plm-accent/10 hover:bg-plm-accent/20 rounded transition-colors"
                  >
                    <Plus size={14} />
                    New Config
                  </button>
                )}
              </div>
              
              {/* Config list - always visible */}
              <div className="bg-plm-bg">
                {isLoadingConfigs ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 size={16} className="animate-spin text-plm-fg-muted" />
                  </div>
                ) : savedConfigs.length === 0 ? (
                  <div className="text-center py-6">
                    <FolderOpen size={32} className="mx-auto mb-2 text-plm-fg-muted opacity-40" />
                    <p className="text-sm text-plm-fg-muted">No saved configurations yet</p>
                    <p className="text-xs text-plm-fg-muted mt-1">Click "New Config" to create one</p>
                  </div>
                ) : (
                  <div className="divide-y divide-plm-border max-h-48 overflow-y-auto">
                    {savedConfigs.map(config => (
                      <div 
                        key={config.id} 
                        className={`flex items-center gap-3 px-3 py-2.5 hover:bg-plm-highlight/50 ${
                          config.is_active ? 'bg-plm-accent/10' : ''
                        }`}
                      >
                        {/* Color indicator */}
                        <div 
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: config.color || '#6b7280' }}
                        />
                        
                        {/* Config info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-plm-fg truncate">
                              {config.name}
                            </span>
                            {config.is_active && (
                              <span className="px-1.5 py-0.5 text-[10px] uppercase font-semibold bg-plm-success/20 text-plm-success rounded">
                                Active
                              </span>
                            )}
                            {config.last_test_success === true && (
                              <Check size={12} className="text-plm-success flex-shrink-0" />
                            )}
                            {config.last_test_success === false && (
                              <AlertCircle size={12} className="text-plm-error flex-shrink-0" />
                            )}
                          </div>
                          <div className="text-xs text-plm-fg-muted truncate">
                            {config.url} • {config.database}
                          </div>
                        </div>
                        
                        {/* Actions */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {isAdmin && (
                            <>
                              {config.is_active ? (
                                <button
                                  onClick={handleDisconnect}
                                  className="p-1.5 text-plm-fg-muted hover:text-plm-error hover:bg-plm-error/10 rounded transition-colors"
                                  title="Disconnect this configuration"
                                >
                                  <Plug size={14} />
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleActivateConfig(config)}
                                  disabled={activatingConfigId === config.id}
                                  className="p-1.5 text-plm-fg-muted hover:text-plm-accent hover:bg-plm-accent/10 rounded transition-colors disabled:opacity-50"
                                  title="Activate this configuration"
                                >
                                  {activatingConfigId === config.id ? (
                                    <Loader2 size={14} className="animate-spin" />
                                  ) : (
                                    <Plug size={14} />
                                  )}
                                </button>
                              )}
                              <button
                                onClick={() => handleLoadConfig(config)}
                                className="p-1.5 text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight rounded transition-colors"
                                title="Load into form"
                              >
                                <FolderOpen size={14} />
                              </button>
                              <button
                                onClick={() => handleEditConfig(config)}
                                className="p-1.5 text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight rounded transition-colors"
                                title="Edit configuration"
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                onClick={() => handleDeleteConfig(config)}
                                className="p-1.5 text-plm-fg-muted hover:text-plm-error hover:bg-plm-error/10 rounded transition-colors"
                                title="Delete configuration"
                              >
                                <Trash2 size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
        
        {/* Status banner if connected */}
        {settings?.is_connected && (
          <div className="flex items-center justify-between p-3 bg-plm-success/10 border border-plm-success/30 rounded-lg text-sm">
            <div className="flex items-center gap-2 text-plm-success">
              <Check size={16} />
              <span>
                Connected to {settings.settings?.url}
                {settings.settings?.config_name && (
                  <span className="ml-1 text-plm-fg-muted">({settings.settings.config_name})</span>
                )}
              </span>
            </div>
            {settings.last_sync_at && (
              <span className="text-plm-fg-muted text-xs">
                Last sync: {new Date(settings.last_sync_at).toLocaleDateString()}
              </span>
            )}
          </div>
        )}
        
        {/* Quick edit form - only show when connected */}
        {settings?.is_connected && apiServerOnline !== false && (
          <>
            {/* Odoo URL */}
            <div className="space-y-2">
              <label className="text-sm text-plm-fg-muted">Odoo URL</label>
              <input
                type="text"
                value={url}
                onChange={(e) => isAdmin && setUrl(e.target.value)}
                placeholder="https://mycompany.odoo.com or erp.mycompany.com"
                readOnly={!isAdmin}
                className={`w-full px-3 py-2 text-base bg-plm-sidebar border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent font-mono ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
              />
              <p className="text-xs text-plm-fg-muted">https:// will be added automatically if not provided</p>
            </div>
            
            {/* Database */}
            <div className="space-y-2">
              <label className="text-sm text-plm-fg-muted">Database</label>
              <input
                type="text"
                value={database}
                onChange={(e) => isAdmin && setDatabase(e.target.value)}
                placeholder="master or mycompany-main"
                readOnly={!isAdmin}
                className={`w-full px-3 py-2 text-base bg-plm-sidebar border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent font-mono ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
              />
              <p className="text-xs text-plm-fg-muted">
                Find at: your-odoo-url/web/database/manager
              </p>
            </div>
            
            {/* Username */}
            <div className="space-y-2">
              <label className="text-sm text-plm-fg-muted">Username (Email)</label>
              <input
                type="email"
                value={username}
                onChange={(e) => isAdmin && setUsername(e.target.value)}
                placeholder="admin@mycompany.com"
                readOnly={!isAdmin}
                className={`w-full px-3 py-2 text-base bg-plm-sidebar border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
              />
            </div>
            
            {/* API Key */}
            <div className="space-y-2">
              <label className="text-sm text-plm-fg-muted">API Key</label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => isAdmin && setApiKey(e.target.value)}
                  placeholder={settings?.is_connected ? '••••••••••••' : 'Enter API key'}
                  readOnly={!isAdmin}
                  className={`w-full px-3 py-2 pr-10 text-base bg-plm-sidebar border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent font-mono ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg"
                >
                  {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="text-xs text-plm-fg-muted">
                Generate at: Odoo → Settings → Users → [Your User] → API Keys
              </p>
            </div>
            
            {/* Test result */}
            {testResult && (
              <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                testResult.success 
                  ? 'bg-plm-success/10 text-plm-success border border-plm-success/30' 
                  : 'bg-plm-error/10 text-plm-error border border-plm-error/30'
              }`}>
                {testResult.success ? <Check size={16} /> : <AlertCircle size={16} />}
                {testResult.message}
              </div>
            )}
            
            {/* Action buttons - only show for admins */}
            {isAdmin && (
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={handleTest}
                  disabled={isTesting || !url || !database || !username || !apiKey}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 text-base bg-plm-sidebar border border-plm-border text-plm-fg rounded-lg hover:bg-plm-highlight transition-colors disabled:opacity-50"
                >
                  {isTesting ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />}
                  Test
                </button>
                <button
                  onClick={() => handleSave(true)}
                  disabled={isSaving || !url || !database || !username || !apiKey}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 text-base bg-plm-sidebar border border-plm-border text-plm-fg rounded-lg hover:bg-plm-highlight transition-colors disabled:opacity-50"
                >
                  {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  Save
                </button>
                <button
                  onClick={() => handleSave(false)}
                  disabled={isSaving || !url || !database || !username || !apiKey}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 text-base bg-plm-accent text-white rounded-lg hover:bg-plm-accent/90 transition-colors disabled:opacity-50"
                >
                  {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  Save & Test
                </button>
              </div>
            )}
          </>
        )}
        
        {/* Sync and disconnect when connected - only show for admins */}
        {settings?.is_connected && isAdmin && (
              <div className="flex gap-2 pt-2 border-t border-plm-border">
                <button
                  onClick={handleSync}
                  disabled={isSyncing}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-base bg-plm-success/20 hover:bg-plm-success/30 text-plm-success rounded-lg transition-colors disabled:opacity-50"
                >
                  {isSyncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                  Sync Suppliers Now
                </button>
                <button
                  onClick={handleDisconnect}
                  className="px-4 py-2.5 text-base text-plm-error hover:bg-plm-error/10 rounded-lg transition-colors"
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
                className="flex items-center gap-1 text-sm text-plm-accent hover:underline"
              >
                <ExternalLink size={14} />
                Odoo API Documentation
              </a>
            </div>
      </div>
      
      {/* Save Configuration Dialog - Full form (admin only) */}
      {showSaveDialog && isAdmin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-plm-bg border border-plm-border rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-plm-border sticky top-0 bg-plm-bg">
              <h3 className="text-base font-medium text-plm-fg">
                {editingConfig ? 'Edit Configuration' : 'New Odoo Configuration'}
              </h3>
              <button
                onClick={() => {
                  setShowSaveDialog(false)
                  setEditingConfig(null)
                }}
                className="p-1 text-plm-fg-muted hover:text-plm-fg rounded"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              {/* Name & Color row */}
              <div className="flex gap-3">
                <div className="flex-1 space-y-2">
                  <label className="text-sm text-plm-fg-muted">Configuration Name *</label>
                  <input
                    type="text"
                    value={configName}
                    onChange={(e) => setConfigName(e.target.value)}
                    placeholder="e.g., Production, Dev Server"
                    className="w-full px-3 py-2 text-sm bg-plm-sidebar border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent"
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-plm-fg-muted">Color</label>
                  <div className="flex gap-1">
                    {CONFIG_COLORS.slice(0, 4).map(color => (
                      <button
                        key={color.value}
                        onClick={() => setConfigColor(color.value)}
                        className={`w-8 h-8 rounded flex items-center justify-center transition-all ${
                          configColor === color.value ? 'ring-2 ring-offset-1 ring-offset-plm-bg ring-plm-accent' : 'hover:opacity-80'
                        }`}
                        style={{ backgroundColor: color.value }}
                        title={color.name}
                      >
                        {configColor === color.value && <Check size={12} className="text-white" />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* More colors */}
              <div className="flex gap-1 -mt-2">
                {CONFIG_COLORS.slice(4).map(color => (
                  <button
                    key={color.value}
                    onClick={() => setConfigColor(color.value)}
                    className={`w-6 h-6 rounded flex items-center justify-center transition-all ${
                      configColor === color.value ? 'ring-2 ring-offset-1 ring-offset-plm-bg ring-plm-accent' : 'hover:opacity-80'
                    }`}
                    style={{ backgroundColor: color.value }}
                    title={color.name}
                  >
                    {configColor === color.value && <Check size={10} className="text-white" />}
                  </button>
                ))}
              </div>
              
              {/* Description */}
              <div className="space-y-2">
                <label className="text-sm text-plm-fg-muted">Description (optional)</label>
                <input
                  type="text"
                  value={configDescription}
                  onChange={(e) => setConfigDescription(e.target.value)}
                  placeholder="e.g., Main production Odoo instance"
                  className="w-full px-3 py-2 text-sm bg-plm-sidebar border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent"
                />
              </div>
              
              <div className="h-px bg-plm-border my-2" />
              
              {/* Connection Details */}
              <div className="text-xs font-medium text-plm-fg-muted uppercase tracking-wider">Connection Details</div>
              
              {/* Odoo URL */}
              <div className="space-y-1">
                <label className="text-sm text-plm-fg-muted">Odoo URL *</label>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://mycompany.odoo.com"
                  className="w-full px-3 py-2 text-sm bg-plm-sidebar border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent font-mono"
                />
              </div>
              
              {/* Database */}
              <div className="space-y-1">
                <label className="text-sm text-plm-fg-muted">Database *</label>
                <input
                  type="text"
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                  placeholder="master or mycompany-main"
                  className="w-full px-3 py-2 text-sm bg-plm-sidebar border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent font-mono"
                />
              </div>
              
              {/* Username */}
              <div className="space-y-1">
                <label className="text-sm text-plm-fg-muted">Username (Email) *</label>
                <input
                  type="email"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin@mycompany.com"
                  className="w-full px-3 py-2 text-sm bg-plm-sidebar border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent"
                />
              </div>
              
              {/* API Key */}
              <div className="space-y-1">
                <label className="text-sm text-plm-fg-muted">API Key *</label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Enter API key"
                    className="w-full px-3 py-2 pr-10 text-sm bg-plm-sidebar border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg"
                  >
                    {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <p className="text-[11px] text-plm-fg-muted">
                  Generate at: Odoo → Settings → Users → [Your User] → API Keys
                </p>
              </div>
              
              {/* Test result inside dialog */}
              {testResult && (
                <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                  testResult.success 
                    ? 'bg-plm-success/10 text-plm-success border border-plm-success/30' 
                    : 'bg-plm-error/10 text-plm-error border border-plm-error/30'
                }`}>
                  {testResult.success ? <Check size={14} /> : <AlertCircle size={14} />}
                  <span className="text-xs">{testResult.message}</span>
                </div>
              )}
            </div>
            
            <div className="flex justify-between gap-2 px-4 py-3 border-t border-plm-border bg-plm-sidebar/50 sticky bottom-0">
              <button
                onClick={handleTest}
                disabled={isTesting || !url || !database || !username || !apiKey}
                className="flex items-center gap-2 px-3 py-2 text-sm text-plm-fg-muted hover:text-plm-fg border border-plm-border rounded-lg transition-colors disabled:opacity-50"
              >
                {isTesting ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
                Test Connection
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowSaveDialog(false)
                    setEditingConfig(null)
                  }}
                  className="px-4 py-2 text-sm text-plm-fg-muted hover:text-plm-fg rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleSaveConfig(false)}
                  disabled={isSavingConfig || !configName.trim() || !url || !database || !username || !apiKey}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-plm-sidebar border border-plm-border text-plm-fg rounded-lg hover:bg-plm-highlight transition-colors disabled:opacity-50"
                >
                  {isSavingConfig ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {editingConfig ? 'Update' : 'Save'}
                </button>
                <button
                  onClick={() => handleSaveConfig(true)}
                  disabled={isSavingConfig || !configName.trim() || !url || !database || !username || !apiKey}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-plm-accent text-white rounded-lg hover:bg-plm-accent/90 transition-colors disabled:opacity-50"
                >
                  {isSavingConfig ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
                  {editingConfig ? 'Update & Connect' : 'Save & Connect'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
