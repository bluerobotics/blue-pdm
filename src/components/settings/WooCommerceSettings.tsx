import { useState, useEffect } from 'react'
import { 
  Loader2, 
  Check, 
  Eye, 
  EyeOff, 
  Puzzle, 
  ShoppingBag, 
  RefreshCw, 
  AlertCircle, 
  Plug, 
  ExternalLink,
  Package,
  ArrowLeftRight,
  Settings2
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase } from '../../lib/supabase'

interface WooCommerceSettingsData {
  configured: boolean
  is_connected: boolean
  store_url?: string
  store_name?: string
  wc_version?: string
  last_sync_at: string | null
  last_sync_status: string | null
  products_synced: number | null
  auto_sync: boolean
}

interface SyncSettings {
  sync_products: boolean
  sync_on_release: boolean
  sync_categories: boolean
  default_status: 'draft' | 'publish' | 'private'
}

const API_URL_KEY = 'blueplm_api_url'
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

export function WooCommerceSettings() {
  const { organization, addToast, getEffectiveRole } = usePDMStore()
  const isAdmin = getEffectiveRole() === 'admin'
  
  const apiUrl = getApiUrl(organization)
  
  // Current settings
  const [settings, setSettings] = useState<WooCommerceSettingsData | null>(null)
  
  // Form fields
  const [storeUrl, setStoreUrl] = useState('')
  const [consumerKey, setConsumerKey] = useState('')
  const [consumerSecret, setConsumerSecret] = useState('')
  const [showConsumerKey, setShowConsumerKey] = useState(false)
  const [showConsumerSecret, setShowConsumerSecret] = useState(false)
  
  // Sync settings
  const [syncSettings, setSyncSettings] = useState<SyncSettings>({
    sync_products: true,
    sync_on_release: false,
    sync_categories: true,
    default_status: 'draft'
  })
  
  // Loading states
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  
  // UI state
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
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
        console.warn('[WooCommerceSettings] No auth token available')
        setIsLoading(false)
        return
      }

      const response = await fetch(`${apiUrl}/integrations/woocommerce`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        signal: AbortSignal.timeout(5000)
      })
      
      setApiServerOnline(true)
      
      if (response.ok) {
        const data = await response.json()
        setSettings(data)
        if (data.configured) {
          setStoreUrl(data.store_url || '')
          if (data.sync_settings) {
            setSyncSettings(data.sync_settings)
          }
        }
      }
    } catch (err) {
      if (err instanceof TypeError && err.message.includes('fetch')) {
        setApiServerOnline(false)
      }
      console.error('Failed to load WooCommerce settings:', err)
    } finally {
      setIsLoading(false)
    }
  }
  
  const handleTest = async () => {
    if (!storeUrl || !consumerKey || !consumerSecret) {
      addToast('warning', 'Please fill in all WooCommerce fields')
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
      const response = await fetch(`${apiUrl}/integrations/woocommerce/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          store_url: storeUrl, 
          consumer_key: consumerKey, 
          consumer_secret: consumerSecret 
        }),
        signal: AbortSignal.timeout(15000)
      })

      const data = await response.json()

      if (response.ok) {
        setTestResult({ 
          success: true, 
          message: `Connected to ${data.store_name || storeUrl}! WooCommerce ${data.version}` 
        })
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
    if (!storeUrl || !consumerKey || !consumerSecret) {
      addToast('warning', 'Please fill in all WooCommerce fields')
      return
    }

    const token = await getAuthToken()
    if (!token) {
      addToast('error', 'Session expired. Please log in again.')
      return
    }

    setIsSaving(true)

    try {
      const response = await fetch(`${apiUrl}/integrations/woocommerce`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          store_url: storeUrl, 
          consumer_key: consumerKey, 
          consumer_secret: consumerSecret,
          sync_settings: syncSettings,
          skip_test: skipTest 
        })
      })

      const data = await response.json()

      if (response.ok) {
        if (data.connection_error) {
          addToast('warning', `Saved! But connection failed: ${data.connection_error}`)
        } else {
          addToast('success', data.message || 'WooCommerce credentials saved!')
        }
        loadSettings()
      } else {
        if (response.status === 401) {
          addToast('error', `Auth failed: ${data.message || 'Check API server Supabase config'}`)
        } else {
          addToast('error', data.message || data.error || 'Failed to save connection')
        }
      }
    } catch (err) {
      console.error('[WooCommerceSettings] Error:', err)
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
      const response = await fetch(`${apiUrl}/integrations/woocommerce/sync/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      })

      const data = await response.json()

      if (response.ok) {
        addToast('success', `Synced ${data.created} new, ${data.updated} updated products to WooCommerce`)
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
    if (!confirm('Are you sure you want to disconnect WooCommerce?')) return

    const token = await getAuthToken()
    if (!token) {
      addToast('error', 'Session expired. Please log in again.')
      return
    }

    try {
      const response = await fetch(`${apiUrl}/integrations/woocommerce`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (response.ok) {
        addToast('info', 'WooCommerce integration disconnected')
        setSettings(null)
        setStoreUrl('')
        setConsumerKey('')
        setConsumerSecret('')
        setTestResult(null)
      }
    } catch (err) {
      addToast('error', `Error: ${err}`)
    }
  }

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
        <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#96588a] to-[#7f4275] flex items-center justify-center shadow-lg">
          <ShoppingBag size={24} className="text-white" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-medium text-plm-fg">WooCommerce</h3>
          <p className="text-sm text-plm-fg-muted">
            Sync products and parts with your WooCommerce store
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
        {/* Coming Soon Notice */}
        <div className="flex items-start gap-3 p-4 bg-plm-accent/10 border border-plm-accent/30 rounded-lg">
          <Package size={20} className="text-plm-accent flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-medium text-plm-accent">Coming Soon</div>
            <p className="text-plm-fg-muted mt-1">
              WooCommerce integration is under development. This will allow you to:
            </p>
            <ul className="mt-2 space-y-1 text-plm-fg-muted">
              <li className="flex items-center gap-2">
                <ArrowLeftRight size={14} className="text-plm-accent" />
                Push released parts as WooCommerce products
              </li>
              <li className="flex items-center gap-2">
                <Settings2 size={14} className="text-plm-accent" />
                Auto-sync on part release
              </li>
              <li className="flex items-center gap-2">
                <Package size={14} className="text-plm-accent" />
                Map part categories to product categories
              </li>
            </ul>
          </div>
        </div>

        {/* API Server Offline Warning */}
        {apiServerOnline === false && (
          <div className="flex items-start gap-3 p-3 bg-plm-warning/10 border border-plm-warning/30 rounded-lg">
            <AlertCircle size={18} className="text-plm-warning flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-medium text-plm-warning">API Server Offline</div>
              <p className="text-plm-fg-muted mt-1">
                WooCommerce integration requires the BluePLM API server.{' '}
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
        
        {/* Status banner if connected */}
        {settings?.is_connected && (
          <div className="flex items-center justify-between p-3 bg-plm-success/10 border border-plm-success/30 rounded-lg text-sm">
            <div className="flex items-center gap-2 text-plm-success">
              <Check size={16} />
              <span>Connected to {settings.store_name || settings.store_url}</span>
            </div>
            {settings.last_sync_at && (
              <span className="text-plm-fg-muted text-xs">
                Last sync: {new Date(settings.last_sync_at).toLocaleDateString()}
                {settings.products_synced !== null && ` (${settings.products_synced} products)`}
              </span>
            )}
          </div>
        )}
        
        {/* Configuration form */}
        {apiServerOnline !== false && (
          <>
            {/* Store URL */}
            <div className="space-y-2">
              <label className="text-sm text-plm-fg-muted">Store URL</label>
              <input
                type="text"
                value={storeUrl}
                onChange={(e) => isAdmin && setStoreUrl(e.target.value)}
                placeholder="https://mystore.com or https://mystore.com/shop"
                readOnly={!isAdmin}
                className={`w-full px-3 py-2 text-base bg-plm-sidebar border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent font-mono ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
              />
              <p className="text-xs text-plm-fg-muted">Your WooCommerce store URL (with or without /shop)</p>
            </div>
            
            {/* Consumer Key */}
            <div className="space-y-2">
              <label className="text-sm text-plm-fg-muted">Consumer Key</label>
              <div className="relative">
                <input
                  type={showConsumerKey ? 'text' : 'password'}
                  value={consumerKey}
                  onChange={(e) => isAdmin && setConsumerKey(e.target.value)}
                  placeholder={settings?.is_connected ? '••••••••••••' : 'ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
                  readOnly={!isAdmin}
                  className={`w-full px-3 py-2 pr-10 text-base bg-plm-sidebar border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent font-mono ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => setShowConsumerKey(!showConsumerKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg"
                >
                  {showConsumerKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            
            {/* Consumer Secret */}
            <div className="space-y-2">
              <label className="text-sm text-plm-fg-muted">Consumer Secret</label>
              <div className="relative">
                <input
                  type={showConsumerSecret ? 'text' : 'password'}
                  value={consumerSecret}
                  onChange={(e) => isAdmin && setConsumerSecret(e.target.value)}
                  placeholder={settings?.is_connected ? '••••••••••••' : 'cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
                  readOnly={!isAdmin}
                  className={`w-full px-3 py-2 pr-10 text-base bg-plm-sidebar border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent font-mono ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => setShowConsumerSecret(!showConsumerSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg"
                >
                  {showConsumerSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="text-xs text-plm-fg-muted">
                Generate at: WooCommerce → Settings → Advanced → REST API → Add Key
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
                  disabled={isTesting || !storeUrl || !consumerKey || !consumerSecret}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 text-base bg-plm-sidebar border border-plm-border text-plm-fg rounded-lg hover:bg-plm-highlight transition-colors disabled:opacity-50"
                >
                  {isTesting ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />}
                  Test
                </button>
                <button
                  onClick={() => handleSave(true)}
                  disabled={isSaving || !storeUrl || !consumerKey || !consumerSecret}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 text-base bg-plm-sidebar border border-plm-border text-plm-fg rounded-lg hover:bg-plm-highlight transition-colors disabled:opacity-50"
                >
                  {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  Save
                </button>
                <button
                  onClick={() => handleSave(false)}
                  disabled={isSaving || !storeUrl || !consumerKey || !consumerSecret}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 text-base bg-plm-accent text-white rounded-lg hover:bg-plm-accent/90 transition-colors disabled:opacity-50"
                >
                  {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  Save & Test
                </button>
              </div>
            )}
          </>
        )}
        
        {/* Sync Settings (shown when connected) */}
        {settings?.is_connected && (
          <>
            <div className="pt-4 border-t border-plm-border">
              <div className="flex items-center gap-2 mb-4">
                <Settings2 size={18} className="text-plm-fg-muted" />
                <span className="text-base font-medium text-plm-fg">Sync Settings</span>
              </div>
              
              <div className="space-y-3">
                {/* Sync products toggle */}
                <div className="flex items-center justify-between p-3 bg-plm-sidebar rounded-lg">
                  <div>
                    <div className="text-sm font-medium text-plm-fg">Sync Products</div>
                    <div className="text-xs text-plm-fg-muted">Push released parts as WooCommerce products</div>
                  </div>
                  <button
                    onClick={() => isAdmin && setSyncSettings(s => ({ ...s, sync_products: !s.sync_products }))}
                    disabled={!isAdmin}
                    className={`w-11 h-6 rounded-full transition-colors relative ${
                      syncSettings.sync_products ? 'bg-plm-accent' : 'bg-plm-border'
                    } ${!isAdmin ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                      syncSettings.sync_products ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
                
                {/* Auto-sync on release */}
                <div className="flex items-center justify-between p-3 bg-plm-sidebar rounded-lg">
                  <div>
                    <div className="text-sm font-medium text-plm-fg">Auto-Sync on Release</div>
                    <div className="text-xs text-plm-fg-muted">Automatically push parts when released</div>
                  </div>
                  <button
                    onClick={() => isAdmin && setSyncSettings(s => ({ ...s, sync_on_release: !s.sync_on_release }))}
                    disabled={!isAdmin}
                    className={`w-11 h-6 rounded-full transition-colors relative ${
                      syncSettings.sync_on_release ? 'bg-plm-accent' : 'bg-plm-border'
                    } ${!isAdmin ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                      syncSettings.sync_on_release ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
                
                {/* Default product status */}
                <div className="p-3 bg-plm-sidebar rounded-lg">
                  <label className="text-sm font-medium text-plm-fg block mb-2">Default Product Status</label>
                  <select
                    value={syncSettings.default_status}
                    onChange={(e) => isAdmin && setSyncSettings(s => ({ 
                      ...s, 
                      default_status: e.target.value as 'draft' | 'publish' | 'private' 
                    }))}
                    disabled={!isAdmin}
                    className={`w-full px-3 py-2 text-sm bg-plm-bg border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <option value="draft">Draft (review before publishing)</option>
                    <option value="publish">Published (visible immediately)</option>
                    <option value="private">Private (only visible to admins)</option>
                  </select>
                </div>
              </div>
            </div>
            
            {/* Sync and disconnect - only show for admins */}
            {isAdmin && (
              <div className="flex gap-2 pt-4 border-t border-plm-border">
                <button
                  onClick={handleSync}
                  disabled={isSyncing}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-base bg-plm-success/20 hover:bg-plm-success/30 text-plm-success rounded-lg transition-colors disabled:opacity-50"
                >
                  {isSyncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                  Sync Products Now
                </button>
                <button
                  onClick={handleDisconnect}
                  className="px-4 py-2.5 text-base text-plm-error hover:bg-plm-error/10 rounded-lg transition-colors"
                >
                  Disconnect
                </button>
              </div>
            )}
          </>
        )}
        
        {/* Setup instructions (when not connected) */}
        {!settings?.is_connected && apiServerOnline !== false && (
          <div className="p-4 bg-plm-sidebar rounded-lg mt-4">
            <p className="text-sm text-plm-fg-muted font-medium mb-3">Setup Instructions:</p>
            <ol className="text-sm text-plm-fg-muted space-y-2 list-decimal list-inside">
              <li>Log into your WordPress admin panel</li>
              <li>Go to <strong>WooCommerce → Settings → Advanced → REST API</strong></li>
              <li>Click <strong>Add Key</strong></li>
              <li>Give it a description (e.g., "BluePLM Integration")</li>
              <li>Set permissions to <strong>Read/Write</strong></li>
              <li>Click <strong>Generate API Key</strong></li>
              <li>Copy both the <strong>Consumer Key</strong> and <strong>Consumer Secret</strong></li>
              <li>Paste them above and test the connection</li>
            </ol>
          </div>
        )}
        
        {/* Help link */}
        <div className="pt-2">
          <a
            href="https://woocommerce.com/document/woocommerce-rest-api/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-sm text-plm-accent hover:underline"
          >
            <ExternalLink size={14} />
            WooCommerce REST API Documentation
          </a>
        </div>
      </div>
    </div>
  )
}

