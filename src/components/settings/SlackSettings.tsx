import { useState, useEffect } from 'react'
import { 
  Loader2, 
  Check, 
  Eye, 
  EyeOff, 
  Puzzle, 
  Hash, 
  Bell, 
  RefreshCw, 
  AlertCircle, 
  Plug, 
  ExternalLink,
  Trash2,
  TestTube2,
  Send
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase } from '../../lib/supabase'

// Slack logo SVG component
function SlackLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.522 2.521 2.528 2.528 0 0 1-2.521-2.521V2.522A2.528 2.528 0 0 1 15.165 0a2.528 2.528 0 0 1 2.521 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.521 2.522A2.528 2.528 0 0 1 15.165 24a2.528 2.528 0 0 1-2.521-2.522v-2.522h2.521zm0-1.27a2.528 2.528 0 0 1-2.521-2.522 2.528 2.528 0 0 1 2.521-2.521h6.313A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.521h-6.313z" fill="currentColor"/>
    </svg>
  )
}

interface SlackChannel {
  id: string
  name: string
  is_private: boolean
}

interface NotificationEvent {
  id: string
  label: string
  description: string
  enabled: boolean
  channel: string
}

interface SlackSettingsData {
  configured: boolean
  is_connected: boolean
  workspace_name?: string
  workspace_id?: string
  bot_user_id?: string
  channels?: SlackChannel[]
  notifications: NotificationEvent[]
}

const DEFAULT_NOTIFICATION_EVENTS: NotificationEvent[] = [
  { id: 'eco_created', label: 'ECO Created', description: 'When a new Engineering Change Order is created', enabled: true, channel: '' },
  { id: 'eco_approved', label: 'ECO Approved', description: 'When an ECO is fully approved', enabled: true, channel: '' },
  { id: 'eco_rejected', label: 'ECO Rejected', description: 'When an ECO is rejected', enabled: true, channel: '' },
  { id: 'eco_released', label: 'ECO Released', description: 'When ECO changes are released to production', enabled: true, channel: '' },
  { id: 'review_requested', label: 'Review Requested', description: 'When someone is assigned to review a file', enabled: true, channel: '' },
  { id: 'review_completed', label: 'Review Completed', description: 'When a review is approved or rejected', enabled: true, channel: '' },
  { id: 'file_released', label: 'File Released', description: 'When files are released to a new revision', enabled: false, channel: '' },
  { id: 'file_obsoleted', label: 'File Obsoleted', description: 'When files are marked as obsolete', enabled: false, channel: '' },
]

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

export function SlackSettings() {
  const { user, organization, addToast, getEffectiveRole } = usePDMStore()
  const isAdmin = getEffectiveRole() === 'admin'
  
  const apiUrl = getApiUrl(organization)
  
  const [settings, setSettings] = useState<SlackSettingsData | null>(null)
  const [botToken, setBotToken] = useState('')
  const [signingSecret, setSigningSecret] = useState('')
  const [showBotToken, setShowBotToken] = useState(false)
  const [showSigningSecret, setShowSigningSecret] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [isFetchingChannels, setIsFetchingChannels] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [apiServerOnline, setApiServerOnline] = useState<boolean | null>(null)
  const [notifications, setNotifications] = useState<NotificationEvent[]>(DEFAULT_NOTIFICATION_EVENTS)
  const [channels, setChannels] = useState<SlackChannel[]>([])
  const [defaultChannel, setDefaultChannel] = useState('')
  const [testMessage, setTestMessage] = useState('')
  const [isSendingTest, setIsSendingTest] = useState(false)
  
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
        console.warn('[SlackSettings] No auth token available')
        setIsLoading(false)
        return
      }

      const response = await fetch(`${apiUrl}/integrations/slack`, {
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
          setEnabled(true)
          setChannels(data.channels || [])
          setNotifications(data.notifications || DEFAULT_NOTIFICATION_EVENTS)
          if (data.notifications?.length > 0) {
            // Find the most common channel as default
            const channelCounts: Record<string, number> = {}
            data.notifications.forEach((n: NotificationEvent) => {
              if (n.channel) {
                channelCounts[n.channel] = (channelCounts[n.channel] || 0) + 1
              }
            })
            const mostCommon = Object.entries(channelCounts).sort((a, b) => b[1] - a[1])[0]
            if (mostCommon) {
              setDefaultChannel(mostCommon[0])
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof TypeError && err.message.includes('fetch')) {
        setApiServerOnline(false)
      }
      console.error('Failed to load Slack settings:', err)
    } finally {
      setIsLoading(false)
    }
  }
  
  const handleTest = async () => {
    if (!botToken) {
      addToast('warning', 'Please enter a Bot Token')
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
      const response = await fetch(`${apiUrl}/integrations/slack/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          bot_token: botToken,
          signing_secret: signingSecret
        }),
        signal: AbortSignal.timeout(15000)
      })

      const data = await response.json()

      if (response.ok) {
        setTestResult({ 
          success: true, 
          message: `Connected to ${data.workspace_name || 'Slack workspace'}` 
        })
        if (data.channels) {
          setChannels(data.channels)
        }
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
  
  const handleFetchChannels = async () => {
    const token = await getAuthToken()
    if (!token) return

    setIsFetchingChannels(true)
    try {
      const response = await fetch(`${apiUrl}/integrations/slack/channels`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        signal: AbortSignal.timeout(10000)
      })

      if (response.ok) {
        const data = await response.json()
        setChannels(data.channels || [])
        addToast('success', `Found ${data.channels?.length || 0} channels`)
      } else {
        addToast('error', 'Failed to fetch channels')
      }
    } catch (err) {
      addToast('error', `Error: ${err}`)
    } finally {
      setIsFetchingChannels(false)
    }
  }
  
  const handleSave = async (skipTest: boolean = false) => {
    if (!botToken && !settings?.configured) {
      addToast('warning', 'Please enter a Bot Token')
      return
    }

    const token = await getAuthToken()
    if (!token) {
      addToast('error', 'Session expired. Please log in again.')
      return
    }

    setIsSaving(true)

    try {
      const response = await fetch(`${apiUrl}/integrations/slack`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          bot_token: botToken || undefined,
          signing_secret: signingSecret || undefined,
          default_channel: defaultChannel,
          notifications: notifications,
          skip_test: skipTest
        })
      })

      const data = await response.json()

      if (response.ok) {
        if (data.connection_error) {
          addToast('warning', `Saved! But connection failed: ${data.connection_error}`)
        } else {
          addToast('success', data.message || 'Slack settings saved!')
        }
        loadSettings()
      } else {
        if (response.status === 401) {
          addToast('error', `Auth failed: ${data.message || 'Check API server Supabase config'}`)
        } else {
          addToast('error', data.message || data.error || 'Failed to save configuration')
        }
      }
    } catch (err) {
      console.error('[SlackSettings] Error:', err)
      addToast('error', `Error: ${err}`)
    } finally {
      setIsSaving(false)
    }
  }
  
  const handleSendTestMessage = async () => {
    if (!defaultChannel) {
      addToast('warning', 'Please select a default channel first')
      return
    }

    const token = await getAuthToken()
    if (!token) {
      addToast('error', 'Session expired. Please log in again.')
      return
    }

    setIsSendingTest(true)

    try {
      const response = await fetch(`${apiUrl}/integrations/slack/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          channel: defaultChannel,
          message: testMessage || '🔧 Test message from BluePLM!'
        })
      })

      const data = await response.json()

      if (response.ok) {
        addToast('success', 'Test message sent!')
        setTestMessage('')
      } else {
        addToast('error', data.message || 'Failed to send message')
      }
    } catch (err) {
      addToast('error', `Error: ${err}`)
    } finally {
      setIsSendingTest(false)
    }
  }
  
  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect Slack? This will stop all notifications.')) return

    const token = await getAuthToken()
    if (!token) {
      addToast('error', 'Session expired. Please log in again.')
      return
    }

    try {
      const response = await fetch(`${apiUrl}/integrations/slack`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.ok) {
        addToast('info', 'Slack integration disconnected')
        setSettings(null)
        setBotToken('')
        setSigningSecret('')
        setEnabled(false)
        setTestResult(null)
        setChannels([])
        setDefaultChannel('')
        setNotifications(DEFAULT_NOTIFICATION_EVENTS)
      }
    } catch (err) {
      addToast('error', `Error: ${err}`)
    }
  }
  
  const toggleNotification = (eventId: string) => {
    setNotifications(prev => prev.map(n => 
      n.id === eventId ? { ...n, enabled: !n.enabled } : n
    ))
  }
  
  const setNotificationChannel = (eventId: string, channel: string) => {
    setNotifications(prev => prev.map(n => 
      n.id === eventId ? { ...n, channel } : n
    ))
  }
  
  const setAllNotificationChannels = (channel: string) => {
    setDefaultChannel(channel)
    setNotifications(prev => prev.map(n => ({ ...n, channel })))
  }

  if (!isAdmin) {
    return (
      <div className="text-center py-12">
        <Puzzle size={40} className="mx-auto mb-4 text-plm-fg-muted opacity-50" />
        <p className="text-base text-plm-fg-muted">
          Only administrators can manage Slack integration.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#611f69] to-[#4A154B] flex items-center justify-center shadow-lg">
          <SlackLogo size={26} />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-medium text-plm-fg">Slack</h3>
          <p className="text-sm text-plm-fg-muted">
            Approval reminders, review notifications, ECO updates
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
                Slack integration requires the BluePLM API server.{' '}
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
        
        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <span className="text-base text-plm-fg">Enable Slack Integration</span>
          <button
            onClick={() => setEnabled(!enabled)}
            disabled={apiServerOnline === false}
            className={`w-11 h-6 rounded-full transition-colors relative ${
              enabled ? 'bg-plm-accent' : 'bg-plm-border'
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
              <div className="flex items-center justify-between p-3 bg-plm-success/10 border border-plm-success/30 rounded-lg text-sm">
                <div className="flex items-center gap-2 text-plm-success">
                  <Check size={16} />
                  <span>Connected to {settings.workspace_name || 'Slack'}</span>
                </div>
                <span className="text-plm-fg-muted text-xs">
                  {channels.length} channel{channels.length !== 1 ? 's' : ''} available
                </span>
              </div>
            )}
            
            {/* Bot Token */}
            <div className="space-y-2">
              <label className="text-sm text-plm-fg-muted">Bot User OAuth Token</label>
              <div className="relative">
                <input
                  type={showBotToken ? 'text' : 'password'}
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder={settings?.is_connected ? '••••••••••••' : 'xoxb-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx'}
                  className="w-full px-3 py-2 pr-10 text-base bg-plm-sidebar border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowBotToken(!showBotToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg"
                >
                  {showBotToken ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="text-xs text-plm-fg-muted">
                Found in your Slack App → OAuth & Permissions → Bot User OAuth Token
              </p>
            </div>
            
            {/* Signing Secret (optional, for events) */}
            <div className="space-y-2">
              <label className="text-sm text-plm-fg-muted">
                Signing Secret <span className="opacity-60">(optional)</span>
              </label>
              <div className="relative">
                <input
                  type={showSigningSecret ? 'text' : 'password'}
                  value={signingSecret}
                  onChange={(e) => setSigningSecret(e.target.value)}
                  placeholder="For receiving events from Slack"
                  className="w-full px-3 py-2 pr-10 text-base bg-plm-sidebar border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowSigningSecret(!showSigningSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg"
                >
                  {showSigningSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="text-xs text-plm-fg-muted">
                Found in your Slack App → Basic Information → App Credentials
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
            
            {/* Action buttons */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={handleTest}
                disabled={isTesting || !botToken}
                className="flex items-center justify-center gap-2 px-4 py-2.5 text-base bg-plm-sidebar border border-plm-border text-plm-fg rounded-lg hover:bg-plm-highlight transition-colors disabled:opacity-50"
              >
                {isTesting ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />}
                Test
              </button>
              <button
                onClick={() => handleSave(true)}
                disabled={isSaving || (!botToken && !settings?.configured)}
                className="flex items-center justify-center gap-2 px-4 py-2.5 text-base bg-plm-sidebar border border-plm-border text-plm-fg rounded-lg hover:bg-plm-highlight transition-colors disabled:opacity-50"
              >
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                Save
              </button>
              <button
                onClick={() => handleSave(false)}
                disabled={isSaving || (!botToken && !settings?.configured)}
                className="flex items-center justify-center gap-2 px-4 py-2.5 text-base bg-plm-accent text-white rounded-lg hover:bg-plm-accent/90 transition-colors disabled:opacity-50"
              >
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                Save & Test
              </button>
            </div>
            
            {/* Notification Settings (shown when connected) */}
            {settings?.is_connected && (
              <>
                <div className="pt-4 border-t border-plm-border">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Bell size={18} className="text-plm-fg-muted" />
                      <span className="text-base font-medium text-plm-fg">Notification Settings</span>
                    </div>
                    <button
                      onClick={handleFetchChannels}
                      disabled={isFetchingChannels}
                      className="flex items-center gap-1 text-sm text-plm-accent hover:underline"
                    >
                      {isFetchingChannels ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <RefreshCw size={14} />
                      )}
                      Refresh channels
                    </button>
                  </div>
                  
                  {/* Default channel selector */}
                  <div className="mb-4 p-3 bg-plm-sidebar rounded-lg">
                    <label className="text-sm text-plm-fg-muted block mb-2">Default Channel</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Hash size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
                        <select
                          value={defaultChannel}
                          onChange={(e) => setAllNotificationChannels(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 text-base bg-plm-bg border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent appearance-none"
                        >
                          <option value="">Select a channel...</option>
                          {channels.map(ch => (
                            <option key={ch.id} value={ch.id}>
                              {ch.is_private ? '🔒 ' : ''}{ch.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <p className="text-xs text-plm-fg-muted mt-2">
                      All notifications will be sent to this channel by default
                    </p>
                  </div>
                  
                  {/* Notification events */}
                  <div className="space-y-2">
                    {notifications.map(event => (
                      <div 
                        key={event.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                          event.enabled 
                            ? 'bg-plm-sidebar border-plm-border' 
                            : 'bg-plm-bg/50 border-plm-border/50 opacity-60'
                        }`}
                      >
                        <button
                          onClick={() => toggleNotification(event.id)}
                          className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${
                            event.enabled ? 'bg-plm-accent' : 'bg-plm-border'
                          }`}
                        >
                          <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                            event.enabled ? 'translate-x-5' : 'translate-x-1'
                          }`} />
                        </button>
                        
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-plm-fg">{event.label}</div>
                          <div className="text-xs text-plm-fg-muted truncate">{event.description}</div>
                        </div>
                        
                        {event.enabled && (
                          <select
                            value={event.channel || defaultChannel}
                            onChange={(e) => setNotificationChannel(event.id, e.target.value)}
                            className="px-2 py-1.5 text-sm bg-plm-bg border border-plm-border rounded focus:outline-none focus:border-plm-accent max-w-[140px]"
                          >
                            <option value="">Use default</option>
                            {channels.map(ch => (
                              <option key={ch.id} value={ch.id}>
                                {ch.is_private ? '🔒' : '#'} {ch.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* Test message section */}
                <div className="pt-4 border-t border-plm-border">
                  <div className="flex items-center gap-2 mb-3">
                    <TestTube2 size={18} className="text-plm-fg-muted" />
                    <span className="text-base font-medium text-plm-fg">Send Test Message</span>
                  </div>
                  
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={testMessage}
                      onChange={(e) => setTestMessage(e.target.value)}
                      placeholder="🔧 Test message from BluePLM!"
                      className="flex-1 px-3 py-2 text-base bg-plm-sidebar border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent"
                    />
                    <button
                      onClick={handleSendTestMessage}
                      disabled={isSendingTest || !defaultChannel}
                      className="flex items-center gap-2 px-4 py-2 text-base bg-plm-accent text-white rounded-lg hover:bg-plm-accent/90 transition-colors disabled:opacity-50"
                    >
                      {isSendingTest ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Send size={16} />
                      )}
                      Send
                    </button>
                  </div>
                  {!defaultChannel && (
                    <p className="text-xs text-plm-warning mt-2">
                      Select a default channel above to send test messages
                    </p>
                  )}
                </div>
                
                {/* Disconnect button */}
                <div className="flex justify-end pt-4 border-t border-plm-border">
                  <button
                    onClick={handleDisconnect}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-plm-error hover:bg-plm-error/10 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} />
                    Disconnect Slack
                  </button>
                </div>
              </>
            )}
            
            {/* Setup instructions (when not connected) */}
            {!settings?.is_connected && (
              <div className="p-4 bg-plm-sidebar rounded-lg mt-4">
                <p className="text-sm text-plm-fg-muted font-medium mb-3">Setup Instructions:</p>
                <ol className="text-sm text-plm-fg-muted space-y-2 list-decimal list-inside">
                  <li>
                    Go to{' '}
                    <a 
                      href="https://api.slack.com/apps" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-plm-accent hover:underline"
                    >
                      Slack API Apps
                    </a>{' '}
                    and create a new app
                  </li>
                  <li>Select "From scratch" and choose your workspace</li>
                  <li>Go to <strong>OAuth & Permissions</strong> and add these Bot Token Scopes:
                    <ul className="ml-6 mt-1 space-y-0.5 list-disc">
                      <li><code className="px-1 py-0.5 bg-plm-bg rounded text-xs">channels:read</code> - View channels</li>
                      <li><code className="px-1 py-0.5 bg-plm-bg rounded text-xs">chat:write</code> - Send messages</li>
                      <li><code className="px-1 py-0.5 bg-plm-bg rounded text-xs">groups:read</code> - View private channels</li>
                    </ul>
                  </li>
                  <li>Click <strong>Install to Workspace</strong> and authorize</li>
                  <li>Copy the <strong>Bot User OAuth Token</strong> (starts with xoxb-)</li>
                  <li>Invite the bot to your desired channels: <code className="px-1 py-0.5 bg-plm-bg rounded text-xs">/invite @YourBotName</code></li>
                </ol>
              </div>
            )}
            
            {/* Help link */}
            <div className="pt-2">
              <a
                href="https://api.slack.com/tutorials/tracks/posting-messages-with-curl"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-plm-accent hover:underline"
              >
                <ExternalLink size={14} />
                Slack API Documentation
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
