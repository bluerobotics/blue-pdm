import { useState, useEffect } from 'react'
import { 
  Shield, 
  RefreshCw, 
  Loader2, 
  Circle, 
  Key, 
  Eye, 
  EyeOff, 
  Copy, 
  Check,
  Clock,
  Trash2,
  Activity,
  ExternalLink,
  Edit2
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase } from '../../lib/supabase'

// Cast supabase client to bypass known v2 type inference issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

interface ApiCallRecord {
  id: string
  timestamp: Date
  method: string
  endpoint: string
  status: number
  duration: number
}

const API_URL_KEY = 'blueplm_api_url'
const API_HISTORY_KEY = 'blueplm_api_history'

export function ApiSettings() {
  const { user, organization, setOrganization, addToast, getEffectiveRole } = usePDMStore()
  const isAdmin = getEffectiveRole() === 'admin'
  
  const [apiToken, setApiToken] = useState<string | null>(null)
  const [showToken, setShowToken] = useState(false)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [apiUrl, setApiUrl] = useState(() => {
    return organization?.settings?.api_url || localStorage.getItem(API_URL_KEY) || ''
  })
  const [editingApiUrl, setEditingApiUrl] = useState(false)
  const [apiUrlInput, setApiUrlInput] = useState('')
  const [apiStatus, setApiStatus] = useState<'unknown' | 'online' | 'offline' | 'checking'>('unknown')
  const [apiVersion, setApiVersion] = useState<string | null>(null)
  const [apiBuild, setApiBuild] = useState<string | null>(null)
  const [apiHistory, setApiHistory] = useState<ApiCallRecord[]>(() => {
    try {
      const stored = localStorage.getItem(API_HISTORY_KEY)
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  
  // Get API token from Supabase session
  useEffect(() => {
    const getToken = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) {
        setApiToken(session.access_token)
      }
    }
    getToken()
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setApiToken(session?.access_token || null)
    })
    
    return () => subscription.unsubscribe()
  }, [])
  
  // Sync API URL from org settings
  useEffect(() => {
    if (organization?.settings?.api_url) {
      setApiUrl(organization.settings.api_url)
      localStorage.setItem(API_URL_KEY, organization.settings.api_url)
    }
  }, [organization?.settings?.api_url])
  
  // Check API status on mount (only if we have a URL)
  useEffect(() => {
    if (apiUrl) {
      checkApiStatus()
    }
  }, [])
  
  const checkApiStatus = async () => {
    if (!apiUrl) {
      setApiStatus('unknown')
      return
    }
    
    setApiStatus('checking')
    const start = Date.now()
    try {
      const response = await fetch(`${apiUrl}/health`, { 
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      })
      const duration = Date.now() - start
      
      if (response.ok) {
        const data = await response.json()
        setApiStatus('online')
        setApiVersion(data.version || null)
        setApiBuild(data.build || null)
        addApiCall('GET', '/health', response.status, duration)
      } else {
        setApiStatus('offline')
        addApiCall('GET', '/health', response.status, duration)
      }
    } catch {
      setApiStatus('offline')
      addApiCall('GET', '/health', 0, Date.now() - start)
    }
    setLastChecked(new Date())
  }
  
  const addApiCall = (method: string, endpoint: string, status: number, duration: number) => {
    const newCall: ApiCallRecord = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      method,
      endpoint,
      status,
      duration
    }
    setApiHistory(prev => {
      const updated = [newCall, ...prev].slice(0, 50)
      localStorage.setItem(API_HISTORY_KEY, JSON.stringify(updated))
      return updated
    })
  }
  
  const clearApiHistory = () => {
    setApiHistory([])
    localStorage.removeItem(API_HISTORY_KEY)
  }
  
  const handleSaveApiUrl = async () => {
    let url = apiUrlInput.trim()
    if (url) {
      // Remove any existing protocol and normalize
      url = url.replace(/^https?:\/\//, '')
      // Remove trailing slashes
      url = url.replace(/\/+$/, '')
      // Remove any leading/trailing whitespace that might have snuck in
      url = url.trim()
      // Add https:// (always use https for production)
      url = 'https://' + url
      
      setApiUrl(url)
      localStorage.setItem(API_URL_KEY, url)
      
      // Save org-wide for all members when admin sets external URL
      if (organization && isAdmin) {
        try {
          // IMPORTANT: Fetch current settings from database first to avoid overwriting
          // other fields that may have been set by other components
          const { data: currentOrg, error: fetchError } = await db
            .from('organizations')
            .select('settings')
            .eq('id', organization.id)
            .single()
          
          if (fetchError) {
            console.error('[API] Failed to fetch current settings:', fetchError)
          }
          
          // Merge with current database settings (not local state which may be stale)
          const currentSettings = currentOrg?.settings || organization.settings || {}
          const newSettings = { ...currentSettings, api_url: url }
          
          const { error } = await db
            .from('organizations')
            .update({ settings: newSettings })
            .eq('id', organization.id)
          
          if (error) {
            console.error('[API] Failed to save API URL to org:', error)
            addToast('error', `Saved locally, but failed to sync: ${error.message}`)
          } else {
            // Update local state
            setOrganization({
              ...organization,
              settings: newSettings
            })
            addToast('success', 'API URL saved for organization')
          }
        } catch (err) {
          console.error('[API] Failed to save API URL to org (exception):', err)
          addToast('error', 'Saved locally, but failed to sync to organization')
        }
      } else {
        addToast('success', 'API URL saved')
      }
    }
    setEditingApiUrl(false)
    setTimeout(checkApiStatus, 100)
  }
  
  const handleCopyToken = async () => {
    if (!apiToken) return
    try {
      await navigator.clipboard.writeText(apiToken)
      setTokenCopied(true)
      setTimeout(() => setTokenCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy token:', err)
    }
  }
  
  const testApiEndpoint = async (endpoint: string) => {
    if (!apiToken) return
    const start = Date.now()
    try {
      const response = await fetch(`${apiUrl}${endpoint}`, {
        headers: { 'Authorization': `Bearer ${apiToken}` },
        signal: AbortSignal.timeout(10000)
      })
      addApiCall('GET', endpoint, response.status, Date.now() - start)
    } catch {
      addApiCall('GET', endpoint, 0, Date.now() - start)
    }
  }

  if (!isAdmin) {
    return (
      <div className="text-center py-12">
        <Shield size={40} className="mx-auto text-plm-fg-muted mb-4" />
        <div className="text-base font-medium text-plm-fg">Admin Only</div>
        <p className="text-sm text-plm-fg-muted mt-1">
          API settings require admin access.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* API URL */}
      <div className="space-y-2">
        <label className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
          API Server URL
        </label>
        {editingApiUrl ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={apiUrlInput}
                onChange={(e) => setApiUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveApiUrl()
                  if (e.key === 'Escape') setEditingApiUrl(false)
                }}
                placeholder="blueplm-api-production.up.railway.app"
                className="flex-1 bg-plm-bg border border-plm-border rounded-lg px-3 py-2 text-base font-mono focus:border-plm-accent focus:outline-none"
                autoFocus
              />
              <button onClick={handleSaveApiUrl} className="btn btn-primary btn-sm">
                Save
              </button>
              <button 
                onClick={() => setEditingApiUrl(false)} 
                className="btn btn-sm bg-plm-bg border border-plm-border hover:border-plm-fg-muted"
              >
                Cancel
              </button>
            </div>
            <p className="text-sm text-plm-fg-dim">
              Paste your Railway/Render domain — https:// is added automatically
            </p>
          </div>
        ) : apiUrl ? (
          <div 
            className="p-3 bg-plm-bg rounded-lg border border-plm-border cursor-pointer hover:border-plm-accent transition-colors flex items-center justify-between group"
            onClick={() => {
              setApiUrlInput(apiUrl.replace(/^https?:\/\//, ''))
              setEditingApiUrl(true)
            }}
          >
            <code className="text-base text-plm-fg font-mono">{apiUrl}</code>
            <Edit2 size={14} className="text-plm-fg-muted opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        ) : (
          <button
            onClick={() => {
              setApiUrlInput('')
              setEditingApiUrl(true)
            }}
            className="w-full p-4 bg-plm-bg rounded-lg border border-dashed border-plm-border hover:border-plm-accent transition-colors text-plm-fg-muted"
          >
            + Set API Server URL
          </button>
        )}
      </div>

      {/* Server Status */}
      {apiUrl && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
              Server Status
            </label>
            <button
              onClick={checkApiStatus}
              disabled={apiStatus === 'checking'}
              className="text-sm text-plm-fg-muted hover:text-plm-fg flex items-center gap-1"
            >
              <RefreshCw size={14} className={apiStatus === 'checking' ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
          <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-full ${
                apiStatus === 'online' ? 'bg-green-500/20' :
                apiStatus === 'offline' ? 'bg-red-500/20' :
                apiStatus === 'checking' ? 'bg-yellow-500/20' :
                'bg-plm-fg-muted/20'
              }`}>
                {apiStatus === 'checking' ? (
                  <Loader2 size={18} className="animate-spin text-yellow-400" />
                ) : (
                  <Circle size={18} className={`${
                    apiStatus === 'online' ? 'text-green-400 fill-green-400' :
                    apiStatus === 'offline' ? 'text-red-400' :
                    'text-plm-fg-muted'
                  }`} />
                )}
              </div>
              <div className="flex-1">
                <div className="text-base font-medium text-plm-fg">
                  {apiStatus === 'online' && 'API Server Online'}
                  {apiStatus === 'offline' && 'API Server Offline'}
                  {apiStatus === 'checking' && 'Checking...'}
                  {apiStatus === 'unknown' && 'Status Unknown'}
                </div>
                <div className="text-sm text-plm-fg-muted flex items-center gap-2 flex-wrap">
                  {apiVersion && <span>v{apiVersion}</span>}
                  {apiBuild && (
                    <code className="px-1.5 py-0.5 bg-plm-bg-secondary rounded text-xs font-mono text-plm-accent">
                      {apiBuild}
                    </code>
                  )}
                  {lastChecked && <span>• Checked {lastChecked.toLocaleTimeString()}</span>}
                </div>
              </div>
            </div>
            
            {apiStatus === 'offline' && (
              <div className="mt-4 p-3 bg-plm-bg-secondary rounded-lg text-sm space-y-2">
                <div className="font-medium text-plm-fg">🚀 Need to deploy?</div>
                <p className="text-plm-fg-muted">
                  Deploy to Railway or Render in 5 min.
                </p>
                <div className="flex gap-2">
                  <a href="https://railway.app/new" target="_blank" rel="noopener noreferrer" className="text-plm-accent hover:underline">Railway</a>
                  <span className="text-plm-fg-muted">•</span>
                  <a href="https://render.com/deploy" target="_blank" rel="noopener noreferrer" className="text-plm-accent hover:underline">Render</a>
                  <span className="text-plm-fg-muted">•</span>
                  <a href="https://github.com/bluerobotics/bluePLM/blob/main/api/README.md#deployment" target="_blank" rel="noopener noreferrer" className="text-plm-accent hover:underline">Guide</a>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* API Token */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
          <Key size={14} />
          Access Token
        </div>
        {apiToken ? (
          <div className="p-4 bg-plm-bg rounded-lg border border-plm-border space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm font-mono text-plm-fg-muted overflow-hidden text-ellipsis">
                {showToken 
                  ? apiToken 
                  : `${apiToken.substring(0, 20)}${'•'.repeat(30)}`
                }
              </code>
              <button
                onClick={() => setShowToken(!showToken)}
                className="p-2 text-plm-fg-muted hover:text-plm-fg rounded transition-colors"
                title={showToken ? 'Hide token' : 'Show token'}
              >
                {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              <button
                onClick={handleCopyToken}
                className={`p-2 rounded transition-colors ${
                  tokenCopied 
                    ? 'text-green-400 bg-green-400/10' 
                    : 'text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight'
                }`}
                title="Copy token"
              >
                {tokenCopied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            {apiUrl && (
              <div className="text-sm text-plm-fg-muted">
                <code className="block p-2 bg-plm-bg-secondary rounded text-plm-fg-dim">
                  curl -H "Authorization: Bearer $TOKEN" {apiUrl}/files
                </code>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 bg-plm-bg rounded-lg border border-plm-border text-base text-plm-fg-muted">
            Sign in to get an API token
          </div>
        )}
      </div>

      {/* Quick Test */}
      {apiToken && apiStatus === 'online' && apiUrl && (
        <div className="space-y-2">
          <label className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
            Quick Test
          </label>
          <div className="flex flex-wrap gap-2">
            {['/vaults', '/files?limit=5', '/checkouts', '/activity?limit=5'].map(endpoint => (
              <button
                key={endpoint}
                onClick={() => testApiEndpoint(endpoint)}
                className="px-3 py-1.5 text-sm bg-plm-bg border border-plm-border rounded-lg hover:border-plm-accent transition-colors font-mono"
              >
                GET {endpoint}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* API Call History */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
            <Activity size={14} />
            Recent API Calls
          </div>
          {apiHistory.length > 0 && (
            <button
              onClick={clearApiHistory}
              className="text-sm text-plm-fg-muted hover:text-plm-error flex items-center gap-1"
            >
              <Trash2 size={14} />
              Clear
            </button>
          )}
        </div>
        <div className="bg-plm-bg rounded-lg border border-plm-border overflow-hidden">
          {apiHistory.length === 0 ? (
            <div className="p-4 text-base text-plm-fg-muted text-center">
              No API calls recorded
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto">
              {apiHistory.slice(0, 20).map(call => (
                <div 
                  key={call.id}
                  className="flex items-center gap-2 px-4 py-2 border-b border-plm-border last:border-0 text-sm"
                >
                  <span className={`px-2 py-0.5 rounded font-medium ${
                    call.status >= 200 && call.status < 300 
                      ? 'bg-green-500/20 text-green-400' 
                      : call.status === 0
                      ? 'bg-red-500/20 text-red-400'
                      : 'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {call.status || 'ERR'}
                  </span>
                  <span className="text-plm-fg-muted">{call.method}</span>
                  <span className="text-plm-fg font-mono flex-1 truncate">{call.endpoint}</span>
                  <span className="text-plm-fg-muted flex items-center gap-1">
                    <Clock size={10} />
                    {call.duration}ms
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Documentation Link */}
      {apiUrl && (
        <div className="pt-2">
          <a
            href={`${apiUrl}/docs`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-base text-plm-accent hover:underline"
          >
            <ExternalLink size={18} />
            Open API Documentation (Swagger)
          </a>
        </div>
      )}
    </div>
  )
}
