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
  ExternalLink
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase } from '../../lib/supabase'

// Note: External API URL is saved org-wide when an admin sets it

interface ApiCallRecord {
  id: string
  timestamp: Date
  method: string
  endpoint: string
  status: number
  duration: number
}

const API_URL_KEY = 'bluepdm_api_url'
const API_HISTORY_KEY = 'bluepdm_api_history'
const DEFAULT_API_URL = 'http://127.0.0.1:3001'

export function ApiSettings() {
  const { user, organization, setOrganization, addToast } = usePDMStore()
  
  const [apiToken, setApiToken] = useState<string | null>(null)
  const [showToken, setShowToken] = useState(false)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [apiUrl, setApiUrl] = useState(() => {
    return organization?.settings?.api_url || localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL
  })
  const [editingApiUrl, setEditingApiUrl] = useState(false)
  const [apiUrlInput, setApiUrlInput] = useState('')
  const [apiStatus, setApiStatus] = useState<'unknown' | 'online' | 'offline' | 'checking'>('unknown')
  const [apiVersion, setApiVersion] = useState<string | null>(null)
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
  
  // Check API status on mount
  useEffect(() => {
    checkApiStatus()
  }, [])
  
  const checkApiStatus = async () => {
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
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url
      }
      url = url.replace(/\/+$/, '')
      setApiUrl(url)
      localStorage.setItem(API_URL_KEY, url)
      
      if (url !== 'http://127.0.0.1:3001') {
        localStorage.setItem('bluepdm_external_api_url', url)
        // Save org-wide for all members when admin sets external URL
        if (organization && user?.role === 'admin') {
          try {
            const newSettings = { ...organization.settings, api_url: url }
            const { error } = await (supabase as any)
              .from('organizations')
              .update({ settings: newSettings })
              .eq('id', organization.id)
            if (!error) {
              setOrganization({
                ...organization,
                settings: { ...organization.settings, api_url: url }
              })
              addToast('success', 'API URL saved for entire organization')
            } else {
              addToast('error', 'Saved locally, but failed to sync to organization')
            }
          } catch (err) {
            console.error('Failed to save API URL to org:', err)
            addToast('error', 'Saved locally, but failed to sync to organization')
          }
        }
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

  if (user?.role !== 'admin') {
    return (
      <div className="text-center py-12">
        <Shield size={40} className="mx-auto text-pdm-fg-muted mb-4" />
        <div className="text-sm font-medium text-pdm-fg">Admin Only</div>
        <p className="text-xs text-pdm-fg-muted mt-1">
          API settings require admin access.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Environment Toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => {
            setApiUrl('http://127.0.0.1:3001')
            localStorage.setItem(API_URL_KEY, 'http://127.0.0.1:3001')
            setTimeout(checkApiStatus, 100)
          }}
          className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
            apiUrl === 'http://127.0.0.1:3001'
              ? 'bg-pdm-accent/20 border-pdm-accent text-pdm-fg'
              : 'bg-pdm-bg border-pdm-border text-pdm-fg-muted hover:border-pdm-fg-muted'
          }`}
        >
          🖥️ Local
        </button>
        <button
          onClick={() => {
            const externalUrl = organization?.settings?.api_url || localStorage.getItem('bluepdm_external_api_url') || ''
            if (externalUrl) {
              setApiUrl(externalUrl)
              localStorage.setItem(API_URL_KEY, externalUrl)
              setTimeout(checkApiStatus, 100)
            } else {
              setEditingApiUrl(true)
              setApiUrlInput('')
            }
          }}
          className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
            apiUrl !== 'http://127.0.0.1:3001'
              ? 'bg-pdm-accent/20 border-pdm-accent text-pdm-fg'
              : 'bg-pdm-bg border-pdm-border text-pdm-fg-muted hover:border-pdm-fg-muted'
          }`}
        >
          ☁️ External
        </button>
      </div>

      {/* Server Status */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-pdm-fg-muted uppercase tracking-wide font-medium">
            Server Status
          </label>
          <button
            onClick={checkApiStatus}
            disabled={apiStatus === 'checking'}
            className="text-xs text-pdm-fg-muted hover:text-pdm-fg flex items-center gap-1"
          >
            <RefreshCw size={12} className={apiStatus === 'checking' ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
        <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-border">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-full ${
              apiStatus === 'online' ? 'bg-green-500/20' :
              apiStatus === 'offline' ? 'bg-red-500/20' :
              apiStatus === 'checking' ? 'bg-yellow-500/20' :
              'bg-pdm-fg-muted/20'
            }`}>
              {apiStatus === 'checking' ? (
                <Loader2 size={18} className="animate-spin text-yellow-400" />
              ) : (
                <Circle size={18} className={`${
                  apiStatus === 'online' ? 'text-green-400 fill-green-400' :
                  apiStatus === 'offline' ? 'text-red-400' :
                  'text-pdm-fg-muted'
                }`} />
              )}
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-pdm-fg">
                {apiStatus === 'online' && 'API Server Online'}
                {apiStatus === 'offline' && 'API Server Offline'}
                {apiStatus === 'checking' && 'Checking...'}
                {apiStatus === 'unknown' && 'Status Unknown'}
              </div>
              <div className="text-xs text-pdm-fg-muted">
                {apiVersion && `v${apiVersion} • `}
                {lastChecked && `Checked ${lastChecked.toLocaleTimeString()}`}
              </div>
            </div>
          </div>
          
          {(apiStatus === 'offline' || apiStatus === 'unknown') && (
            <div className="mt-4 p-3 bg-pdm-bg-secondary rounded-lg text-xs space-y-2">
              <div className="font-medium text-pdm-fg">🚀 Need to deploy?</div>
              <p className="text-pdm-fg-muted">
                Each org hosts their own API. Deploy to Railway or Render in 5 min.
              </p>
              <div className="flex gap-2">
                <a href="https://railway.app/new" target="_blank" rel="noopener noreferrer" className="text-pdm-accent hover:underline">Railway</a>
                <span className="text-pdm-fg-muted">•</span>
                <a href="https://render.com/deploy" target="_blank" rel="noopener noreferrer" className="text-pdm-accent hover:underline">Render</a>
                <span className="text-pdm-fg-muted">•</span>
                <a href="https://github.com/bluerobotics/blue-pdm/blob/main/api/README.md#deployment" target="_blank" rel="noopener noreferrer" className="text-pdm-accent hover:underline">Guide</a>
              </div>
              <div className="pt-1 text-pdm-fg-dim">
                Local: <code className="bg-pdm-bg px-1.5 py-0.5 rounded">npm run api</code>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* API URL */}
      <div className="space-y-2">
        <label className="text-xs text-pdm-fg-muted uppercase tracking-wide font-medium">
          API URL
        </label>
        {editingApiUrl ? (
          <div className="space-y-1">
            <div className="flex gap-2">
              <input
                type="text"
                value={apiUrlInput}
                onChange={(e) => setApiUrlInput(e.target.value)}
                onPaste={(e) => {
                  e.preventDefault()
                  const pasted = e.clipboardData.getData('text').trim()
                  // Normalize pasted URL - handle both with and without protocol
                  let normalized = pasted
                  // Remove any existing protocol prefix
                  normalized = normalized.replace(/^https?:\/\//, '')
                  // Add https:// back
                  normalized = 'https://' + normalized
                  // Remove trailing slashes
                  normalized = normalized.replace(/\/+$/, '')
                  setApiUrlInput(normalized)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveApiUrl()
                  if (e.key === 'Escape') setEditingApiUrl(false)
                }}
                placeholder="bluepdm-api.example.com"
                className="flex-1 bg-pdm-bg border border-pdm-border rounded-lg px-3 py-2 text-sm font-mono focus:border-pdm-accent focus:outline-none"
                autoFocus
              />
              <button onClick={handleSaveApiUrl} className="btn btn-primary btn-sm">
                Save
              </button>
            </div>
            <p className="text-xs text-pdm-fg-dim">
              Paste domain with or without https:// — we'll normalize it automatically
            </p>
          </div>
        ) : (
          <div 
            className="p-3 bg-pdm-bg rounded-lg border border-pdm-border cursor-pointer hover:border-pdm-accent transition-colors"
            onClick={() => {
              setApiUrlInput(apiUrl)
              setEditingApiUrl(true)
            }}
          >
            <code className="text-sm text-pdm-fg font-mono">{apiUrl}</code>
          </div>
        )}
      </div>

      {/* API Token */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-pdm-fg-muted uppercase tracking-wide font-medium">
          <Key size={12} />
          Access Token
        </div>
        {apiToken ? (
          <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-border space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-pdm-fg-muted overflow-hidden text-ellipsis">
                {showToken 
                  ? apiToken 
                  : `${apiToken.substring(0, 20)}${'•'.repeat(30)}`
                }
              </code>
              <button
                onClick={() => setShowToken(!showToken)}
                className="p-2 text-pdm-fg-muted hover:text-pdm-fg rounded transition-colors"
                title={showToken ? 'Hide token' : 'Show token'}
              >
                {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              <button
                onClick={handleCopyToken}
                className={`p-2 rounded transition-colors ${
                  tokenCopied 
                    ? 'text-green-400 bg-green-400/10' 
                    : 'text-pdm-fg-muted hover:text-pdm-fg hover:bg-pdm-highlight'
                }`}
                title="Copy token"
              >
                {tokenCopied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <div className="text-xs text-pdm-fg-muted">
              <code className="block p-2 bg-pdm-bg-secondary rounded text-pdm-fg-dim">
                curl -H "Authorization: Bearer $TOKEN" {apiUrl}/files
              </code>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-border text-sm text-pdm-fg-muted">
            Sign in to get an API token
          </div>
        )}
      </div>

      {/* Quick Test */}
      {apiToken && apiStatus === 'online' && (
        <div className="space-y-2">
          <label className="text-xs text-pdm-fg-muted uppercase tracking-wide font-medium">
            Quick Test
          </label>
          <div className="flex flex-wrap gap-2">
            {['/vaults', '/files?limit=5', '/checkouts', '/activity?limit=5'].map(endpoint => (
              <button
                key={endpoint}
                onClick={() => testApiEndpoint(endpoint)}
                className="px-3 py-1.5 text-xs bg-pdm-bg border border-pdm-border rounded-lg hover:border-pdm-accent transition-colors font-mono"
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
          <div className="flex items-center gap-2 text-xs text-pdm-fg-muted uppercase tracking-wide font-medium">
            <Activity size={12} />
            Recent API Calls
          </div>
          {apiHistory.length > 0 && (
            <button
              onClick={clearApiHistory}
              className="text-xs text-pdm-fg-muted hover:text-pdm-error flex items-center gap-1"
            >
              <Trash2 size={12} />
              Clear
            </button>
          )}
        </div>
        <div className="bg-pdm-bg rounded-lg border border-pdm-border overflow-hidden">
          {apiHistory.length === 0 ? (
            <div className="p-4 text-sm text-pdm-fg-muted text-center">
              No API calls recorded
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto">
              {apiHistory.slice(0, 20).map(call => (
                <div 
                  key={call.id}
                  className="flex items-center gap-2 px-4 py-2 border-b border-pdm-border last:border-0 text-xs"
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
                  <span className="text-pdm-fg-muted">{call.method}</span>
                  <span className="text-pdm-fg font-mono flex-1 truncate">{call.endpoint}</span>
                  <span className="text-pdm-fg-muted flex items-center gap-1">
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
      <div className="pt-2">
        <a
          href={`${apiUrl}/docs`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-pdm-accent hover:underline"
        >
          <ExternalLink size={16} />
          Open API Documentation (Swagger)
        </a>
      </div>
    </div>
  )
}

