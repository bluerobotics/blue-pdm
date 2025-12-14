import { useState, useEffect } from 'react'
import { 
  Database, 
  RefreshCw, 
  Loader2, 
  Circle, 
  Key, 
  Eye, 
  EyeOff, 
  Copy, 
  Check,
  Shield,
  Activity,
  HardDrive,
  Users,
  FileText,
  Clock,
  Globe,
  Server,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  TrendingUp
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase, getCurrentConfig, isSupabaseConfigured } from '../../lib/supabase'

interface SupabaseStats {
  totalFiles: number
  totalVaults: number
  totalUsers: number
  totalCheckouts: number
  realtimeConnected: boolean
}

interface DailyActivity {
  date: string
  dayLabel: string
  checkouts: number
  checkins: number
  creates: number
  deletes: number
  stateChanges: number
  total: number
  bytesIn: number
  bytesOut: number
  uniqueUsers: number
}

interface NetworkStats {
  totalBytesIn: number
  totalBytesOut: number
  totalEvents: number
  activeUsers: number
  peakDay: string
  peakEvents: number
}

export function SupabaseSettings() {
  const { user, organization } = usePDMStore()
  
  const [status, setStatus] = useState<'unknown' | 'online' | 'offline' | 'checking'>('unknown')
  const [showKey, setShowKey] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)
  const [urlCopied, setUrlCopied] = useState(false)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [latency, setLatency] = useState<number | null>(null)
  const [stats, setStats] = useState<SupabaseStats>({
    totalFiles: 0,
    totalVaults: 0,
    totalUsers: 0,
    totalCheckouts: 0,
    realtimeConnected: false
  })
  const [loadingStats, setLoadingStats] = useState(false)
  const [authStatus, setAuthStatus] = useState<'authenticated' | 'unauthenticated' | 'checking'>('checking')
  const [sessionInfo, setSessionInfo] = useState<{
    expiresAt: Date | null
    provider: string | null
  }>({ expiresAt: null, provider: null })
  const [dailyActivity, setDailyActivity] = useState<DailyActivity[]>([])
  const [networkStats, setNetworkStats] = useState<NetworkStats>({
    totalBytesIn: 0,
    totalBytesOut: 0,
    totalEvents: 0,
    activeUsers: 0,
    peakDay: '',
    peakEvents: 0
  })
  const [loadingActivity, setLoadingActivity] = useState(false)
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d' | 'all'>('7d')
  
  const config = getCurrentConfig()
  const isConfigured = isSupabaseConfigured()
  const isAdmin = user?.role === 'admin'
  
  // Check connection status on mount
  useEffect(() => {
    checkConnectionStatus()
    checkAuthStatus()
  }, [])
  
  // Load stats when we have an organization
  useEffect(() => {
    if (organization?.id && status === 'online') {
      loadStats()
      loadActivityData()
    }
  }, [organization?.id, status])
  
  // Reload activity when time range changes
  useEffect(() => {
    if (organization?.id && status === 'online') {
      loadActivityData()
    }
  }, [timeRange])
  
  const checkConnectionStatus = async () => {
    if (!isConfigured) {
      setStatus('offline')
      return
    }
    
    setStatus('checking')
    const start = Date.now()
    
    try {
      // Simple query to test connection
      const { error } = await supabase.from('organizations').select('id').limit(1)
      const duration = Date.now() - start
      setLatency(duration)
      
      if (error && (error.message.includes('Invalid API key') || error.code === 'PGRST301')) {
        setStatus('offline')
      } else {
        setStatus('online')
      }
    } catch {
      setStatus('offline')
      setLatency(null)
    }
    
    setLastChecked(new Date())
  }
  
  const checkAuthStatus = async () => {
    setAuthStatus('checking')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        setAuthStatus('authenticated')
        setSessionInfo({
          expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
          provider: session.user?.app_metadata?.provider || 'email'
        })
      } else {
        setAuthStatus('unauthenticated')
      }
    } catch {
      setAuthStatus('unauthenticated')
    }
  }
  
  const loadStats = async () => {
    if (!organization?.id) return
    
    setLoadingStats(true)
    try {
      // Get stats in parallel
      const [filesResult, vaultsResult, usersResult, checkoutsResult] = await Promise.all([
        supabase.from('files').select('id', { count: 'exact', head: true }).eq('org_id', organization.id),
        supabase.from('vaults').select('id', { count: 'exact', head: true }).eq('org_id', organization.id),
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('org_id', organization.id),
        supabase.from('files').select('id', { count: 'exact', head: true }).eq('org_id', organization.id).not('checked_out_by', 'is', null)
      ])
      
      // Check realtime connection by looking at supabase channels
      const channels = supabase.getChannels()
      const realtimeConnected = channels.length > 0
      
      setStats({
        totalFiles: filesResult.count || 0,
        totalVaults: vaultsResult.count || 0,
        totalUsers: usersResult.count || 0,
        totalCheckouts: checkoutsResult.count || 0,
        realtimeConnected
      })
    } catch (err) {
      console.error('[SupabaseSettings] Failed to load stats:', err)
    }
    setLoadingStats(false)
  }
  
  const loadActivityData = async () => {
    if (!organization?.id) return
    
    setLoadingActivity(true)
    try {
      // Calculate date range based on timeRange
      const now = new Date()
      let startDate: Date | null = new Date()
      let bucketCount: number
      let bucketType: 'hour' | 'day' | 'week' | 'month'
      
      switch (timeRange) {
        case '24h':
          startDate.setHours(startDate.getHours() - 23)
          startDate.setMinutes(0, 0, 0)
          bucketCount = 24
          bucketType = 'hour'
          break
        case '7d':
          startDate.setDate(startDate.getDate() - 6)
          startDate.setHours(0, 0, 0, 0)
          bucketCount = 7
          bucketType = 'day'
          break
        case '30d':
          startDate.setDate(startDate.getDate() - 29)
          startDate.setHours(0, 0, 0, 0)
          bucketCount = 30
          bucketType = 'day'
          break
        case 'all':
          startDate = null // No filter
          bucketCount = 12
          bucketType = 'month'
          break
      }
      
      // Build activity query
      let activityQuery = supabase
        .from('activity')
        .select('action, user_id, created_at')
        .eq('org_id', organization.id)
        .order('created_at', { ascending: true })
      
      if (startDate) {
        activityQuery = activityQuery.gte('created_at', startDate.toISOString())
      }
      
      const { data: activities, error: activityError } = await activityQuery
      
      if (activityError) {
        console.error('[SupabaseSettings] Activity query error:', activityError)
      }
      
      // Build versions query
      let versionsQuery = supabase
        .from('file_versions')
        .select('file_size, created_at, version')
      
      if (startDate) {
        versionsQuery = versionsQuery.gte('created_at', startDate.toISOString())
      }
      
      const { data: versions, error: versionError } = await versionsQuery
      
      if (versionError) {
        console.error('[SupabaseSettings] Versions query error:', versionError)
      }
      
      // Build buckets based on time range
      const buckets: DailyActivity[] = []
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      
      if (timeRange === '24h') {
        // Hourly buckets
        for (let i = 0; i < bucketCount; i++) {
          const bucketDate = new Date(startDate!)
          bucketDate.setHours(startDate!.getHours() + i)
          const hour = bucketDate.getHours()
          const isNow = i === bucketCount - 1
          
          buckets.push({
            date: bucketDate.toISOString(),
            dayLabel: isNow ? 'Now' : `${hour}:00`,
            checkouts: 0, checkins: 0, creates: 0, deletes: 0, stateChanges: 0,
            total: 0, bytesIn: 0, bytesOut: 0, uniqueUsers: 0
          })
        }
      } else if (timeRange === '7d' || timeRange === '30d') {
        // Daily buckets
        for (let i = 0; i < bucketCount; i++) {
          const bucketDate = new Date(startDate!)
          bucketDate.setDate(startDate!.getDate() + i)
          const dateStr = bucketDate.toISOString().split('T')[0]
          const isToday = i === bucketCount - 1
          const isYesterday = i === bucketCount - 2
          
          let label: string
          if (isToday) label = 'Today'
          else if (isYesterday) label = 'Yest'
          else if (timeRange === '30d') label = `${bucketDate.getDate()}`
          else label = dayNames[bucketDate.getDay()]
          
          buckets.push({
            date: dateStr,
            dayLabel: label,
            checkouts: 0, checkins: 0, creates: 0, deletes: 0, stateChanges: 0,
            total: 0, bytesIn: 0, bytesOut: 0, uniqueUsers: 0
          })
        }
      } else {
        // Monthly buckets for "all time" - last 12 months
        for (let i = 11; i >= 0; i--) {
          const bucketDate = new Date(now)
          bucketDate.setMonth(bucketDate.getMonth() - i)
          bucketDate.setDate(1)
          const monthKey = `${bucketDate.getFullYear()}-${String(bucketDate.getMonth() + 1).padStart(2, '0')}`
          const isThisMonth = i === 0
          
          buckets.push({
            date: monthKey,
            dayLabel: isThisMonth ? 'This Mo' : monthNames[bucketDate.getMonth()],
            checkouts: 0, checkins: 0, creates: 0, deletes: 0, stateChanges: 0,
            total: 0, bytesIn: 0, bytesOut: 0, uniqueUsers: 0
          })
        }
      }
      
      // Process activities into buckets
      const usersByBucket: Record<string, Set<string>> = {}
      
      if (activities) {
        for (const activity of activities) {
          const actDate = new Date(activity.created_at)
          let bucketKey: string
          
          if (timeRange === '24h') {
            // Match by hour
            const actHour = new Date(actDate)
            actHour.setMinutes(0, 0, 0)
            bucketKey = actHour.toISOString()
          } else if (timeRange === '7d' || timeRange === '30d') {
            bucketKey = activity.created_at.split('T')[0]
          } else {
            // Monthly
            bucketKey = `${actDate.getFullYear()}-${String(actDate.getMonth() + 1).padStart(2, '0')}`
          }
          
          const bucketIndex = buckets.findIndex(b => b.date === bucketKey)
          
          if (bucketIndex >= 0) {
            const bucket = buckets[bucketIndex]
            bucket.total++
            
            if (!usersByBucket[bucketKey]) usersByBucket[bucketKey] = new Set()
            usersByBucket[bucketKey].add(activity.user_id)
            
            switch (activity.action) {
              case 'checkout': bucket.checkouts++; break
              case 'checkin': bucket.checkins++; break
              case 'create': bucket.creates++; break
              case 'delete': bucket.deletes++; break
              case 'state_change':
              case 'revision_change': bucket.stateChanges++; break
            }
          }
        }
      }
      
      // Process file versions for byte tracking
      if (versions) {
        for (const version of versions) {
          const versionDate = new Date(version.created_at)
          let bucketKey: string
          
          if (timeRange === '24h') {
            const vHour = new Date(versionDate)
            vHour.setMinutes(0, 0, 0)
            bucketKey = vHour.toISOString()
          } else if (timeRange === '7d' || timeRange === '30d') {
            bucketKey = version.created_at.split('T')[0]
          } else {
            bucketKey = `${versionDate.getFullYear()}-${String(versionDate.getMonth() + 1).padStart(2, '0')}`
          }
          
          const bucketIndex = buckets.findIndex(b => b.date === bucketKey)
          if (bucketIndex >= 0) {
            buckets[bucketIndex].bytesIn += version.file_size || 0
          }
        }
      }
      
      // Apply unique user counts
      for (const bucket of buckets) {
        bucket.uniqueUsers = usersByBucket[bucket.date]?.size || 0
      }
      
      // Calculate network stats
      const totalBytesIn = buckets.reduce((sum, d) => sum + d.bytesIn, 0)
      const totalEvents = buckets.reduce((sum, d) => sum + d.total, 0)
      const allUsers = new Set<string>()
      if (activities) {
        for (const a of activities) allUsers.add(a.user_id)
      }
      
      // Estimate bytes out
      const avgFileSize = versions && versions.length > 0 
        ? versions.reduce((sum, v) => sum + (v.file_size || 0), 0) / versions.length 
        : 0
      const totalCheckouts = buckets.reduce((sum, d) => sum + d.checkouts, 0)
      const estimatedBytesOut = totalCheckouts * avgFileSize
      
      for (const bucket of buckets) {
        bucket.bytesOut = bucket.checkouts * avgFileSize
      }
      
      // Find peak
      const peakBucket = buckets.reduce((max, d) => d.total > max.total ? d : max, buckets[0])
      
      setDailyActivity(buckets)
      setNetworkStats({
        totalBytesIn,
        totalBytesOut: estimatedBytesOut,
        totalEvents,
        activeUsers: allUsers.size,
        peakDay: peakBucket?.dayLabel || '',
        peakEvents: peakBucket?.total || 0
      })
    } catch (err) {
      console.error('[SupabaseSettings] Failed to load activity:', err)
    }
    setLoadingActivity(false)
  }
  
  const handleCopyKey = async () => {
    if (!config?.anonKey || !isAdmin) return
    try {
      await navigator.clipboard.writeText(config.anonKey)
      setKeyCopied(true)
      setTimeout(() => setKeyCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy key:', err)
    }
  }
  
  const handleCopyUrl = async () => {
    if (!config?.url) return
    try {
      await navigator.clipboard.writeText(config.url)
      setUrlCopied(true)
      setTimeout(() => setUrlCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy URL:', err)
    }
  }
  
  const maskKey = (key: string): string => {
    if (key.length <= 20) return '•'.repeat(key.length)
    return key.substring(0, 12) + '•'.repeat(20) + key.substring(key.length - 8)
  }
  
  const formatExpiryTime = (date: Date): string => {
    const now = new Date()
    const diff = date.getTime() - now.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(minutes / 60)
    
    if (minutes < 0) return 'Expired'
    if (hours > 0) return `${hours}h ${minutes % 60}m`
    return `${minutes}m`
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-emerald-500/20 rounded-lg">
          <Database size={20} className="text-emerald-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-plm-fg">Supabase Connection</h2>
          <p className="text-sm text-plm-fg-muted">Monitor your database connection and statistics</p>
        </div>
      </div>

      {/* Connection Status */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
            Connection Status
          </label>
          <button
            onClick={checkConnectionStatus}
            disabled={status === 'checking'}
            className="text-sm text-plm-fg-muted hover:text-plm-fg flex items-center gap-1"
          >
            <RefreshCw size={14} className={status === 'checking' ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-full ${
              status === 'online' ? 'bg-green-500/20' :
              status === 'offline' ? 'bg-red-500/20' :
              status === 'checking' ? 'bg-yellow-500/20' :
              'bg-plm-fg-muted/20'
            }`}>
              {status === 'checking' ? (
                <Loader2 size={18} className="animate-spin text-yellow-400" />
              ) : (
                <Circle size={18} className={`${
                  status === 'online' ? 'text-green-400 fill-green-400' :
                  status === 'offline' ? 'text-red-400' :
                  'text-plm-fg-muted'
                }`} />
              )}
            </div>
            <div className="flex-1">
              <div className="text-base font-medium text-plm-fg">
                {status === 'online' && 'Connected to Supabase'}
                {status === 'offline' && 'Connection Failed'}
                {status === 'checking' && 'Checking connection...'}
                {status === 'unknown' && 'Status Unknown'}
              </div>
              <div className="text-sm text-plm-fg-muted flex items-center gap-2 flex-wrap">
                {latency !== null && <span>{latency}ms latency</span>}
                {lastChecked && <span>• Checked {lastChecked.toLocaleTimeString()}</span>}
              </div>
            </div>
          </div>
          
          {/* Auth Status */}
          <div className="mt-4 pt-4 border-t border-plm-border/50">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-full ${
                authStatus === 'authenticated' ? 'bg-blue-500/20' :
                authStatus === 'unauthenticated' ? 'bg-orange-500/20' :
                'bg-plm-fg-muted/20'
              }`}>
                {authStatus === 'checking' ? (
                  <Loader2 size={16} className="animate-spin text-plm-fg-muted" />
                ) : authStatus === 'authenticated' ? (
                  <Shield size={16} className="text-blue-400" />
                ) : (
                  <Shield size={16} className="text-orange-400" />
                )}
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-plm-fg">
                  {authStatus === 'authenticated' ? 'Authenticated' : 
                   authStatus === 'unauthenticated' ? 'Not authenticated' : 
                   'Checking...'}
                </div>
                {sessionInfo.expiresAt && authStatus === 'authenticated' && (
                  <div className="text-xs text-plm-fg-muted flex items-center gap-2">
                    <span>Provider: {sessionInfo.provider}</span>
                    <span>• Session expires in {formatExpiryTime(sessionInfo.expiresAt)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Supabase URL */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
          <Globe size={14} />
          Supabase URL
        </div>
        {config?.url ? (
          <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm font-mono text-plm-fg overflow-hidden text-ellipsis">
                {config.url}
              </code>
              <button
                onClick={handleCopyUrl}
                className={`p-2 rounded transition-colors ${
                  urlCopied 
                    ? 'text-green-400 bg-green-400/10' 
                    : 'text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight'
                }`}
                title="Copy URL"
              >
                {urlCopied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-plm-bg rounded-lg border border-plm-border text-base text-plm-fg-muted">
            Not configured
          </div>
        )}
      </div>

      {/* Supabase Anon Key - Admin Only */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
          <Key size={14} />
          Anon Key
          {!isAdmin && (
            <span className="px-2 py-0.5 bg-plm-fg-muted/20 rounded text-xs font-normal normal-case">
              Admin only
            </span>
          )}
        </div>
        {isAdmin ? (
          config?.anonKey ? (
            <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm font-mono text-plm-fg-muted overflow-hidden text-ellipsis whitespace-nowrap">
                  {showKey ? config.anonKey : maskKey(config.anonKey)}
                </code>
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="p-2 text-plm-fg-muted hover:text-plm-fg rounded transition-colors"
                  title={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <button
                  onClick={handleCopyKey}
                  className={`p-2 rounded transition-colors ${
                    keyCopied 
                      ? 'text-green-400 bg-green-400/10' 
                      : 'text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight'
                  }`}
                  title="Copy key"
                >
                  {keyCopied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <p className="mt-2 text-xs text-plm-fg-dim">
                This is the public anon key. Keep your service role key secure and never expose it.
              </p>
            </div>
          ) : (
            <div className="p-4 bg-plm-bg rounded-lg border border-plm-border text-base text-plm-fg-muted">
              Not configured
            </div>
          )
        ) : (
          <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
            <div className="flex items-center gap-3 text-plm-fg-muted">
              <Shield size={18} />
              <span className="text-sm">Contact your administrator to view API credentials</span>
            </div>
          </div>
        )}
      </div>

      {/* Database Statistics */}
      {organization && status === 'online' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
              <Activity size={14} />
              Database Statistics
            </div>
            <button
              onClick={loadStats}
              disabled={loadingStats}
              className="text-sm text-plm-fg-muted hover:text-plm-fg flex items-center gap-1"
            >
              <RefreshCw size={14} className={loadingStats ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              icon={<FileText size={16} />}
              label="Files"
              value={stats.totalFiles}
              loading={loadingStats}
            />
            <StatCard
              icon={<HardDrive size={16} />}
              label="Vaults"
              value={stats.totalVaults}
              loading={loadingStats}
            />
            <StatCard
              icon={<Users size={16} />}
              label="Members"
              value={stats.totalUsers}
              loading={loadingStats}
            />
            <StatCard
              icon={<Clock size={16} />}
              label="Checked Out"
              value={stats.totalCheckouts}
              loading={loadingStats}
            />
          </div>
        </div>
      )}

      {/* Network Activity Histogram */}
      {organization && status === 'online' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
              <BarChart3 size={14} />
              Network Activity
            </div>
            <div className="flex items-center gap-2">
              {/* Time Range Selector */}
              <div className="flex items-center bg-plm-bg rounded-lg border border-plm-border p-0.5">
                {(['24h', '7d', '30d', 'all'] as const).map((range) => (
                  <button
                    key={range}
                    onClick={() => setTimeRange(range)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      timeRange === range
                        ? 'bg-plm-accent text-white'
                        : 'text-plm-fg-muted hover:text-plm-fg'
                    }`}
                  >
                    {range === '24h' ? '24H' : range === '7d' ? '7D' : range === '30d' ? '30D' : 'All'}
                  </button>
                ))}
              </div>
              <button
                onClick={loadActivityData}
                disabled={loadingActivity}
                className="text-sm text-plm-fg-muted hover:text-plm-fg flex items-center gap-1"
              >
                <RefreshCw size={14} className={loadingActivity ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
          
          <div className="p-4 bg-plm-bg rounded-lg border border-plm-border space-y-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="flex items-center gap-2">
                <ArrowUpRight size={14} className="text-emerald-400" />
                <div>
                  <div className="text-plm-fg-muted text-xs">Data In</div>
                  <div className="text-plm-fg font-medium">{formatBytes(networkStats.totalBytesIn)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ArrowDownRight size={14} className="text-blue-400" />
                <div>
                  <div className="text-plm-fg-muted text-xs">Data Out (est.)</div>
                  <div className="text-plm-fg font-medium">{formatBytes(networkStats.totalBytesOut)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Activity size={14} className="text-purple-400" />
                <div>
                  <div className="text-plm-fg-muted text-xs">Total Events</div>
                  <div className="text-plm-fg font-medium">{networkStats.totalEvents.toLocaleString()}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Users size={14} className="text-orange-400" />
                <div>
                  <div className="text-plm-fg-muted text-xs">Active Users</div>
                  <div className="text-plm-fg font-medium">{networkStats.activeUsers}</div>
                </div>
              </div>
            </div>
            
            {/* Histogram */}
            {loadingActivity ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={24} className="animate-spin text-plm-fg-muted" />
              </div>
            ) : (
              <div className="space-y-2">
                {/* Activity bars */}
                <div className="flex items-end gap-1 h-32">
                  {dailyActivity.map((day, idx) => {
                    const maxTotal = Math.max(...dailyActivity.map(d => d.total), 1)
                    const height = (day.total / maxTotal) * 100
                    const isToday = idx === dailyActivity.length - 1
                    
                    return (
                      <div
                        key={day.date}
                        className="flex-1 flex flex-col items-center gap-1 group relative"
                      >
                        {/* Stacked bar */}
                        <div 
                          className="w-full rounded-t transition-all duration-200 group-hover:opacity-80 relative overflow-hidden"
                          style={{ height: `${Math.max(height, 2)}%` }}
                        >
                          {/* Checkins layer */}
                          <div 
                            className="absolute bottom-0 left-0 right-0 bg-emerald-500"
                            style={{ height: `${day.total > 0 ? (day.checkins / day.total) * 100 : 0}%` }}
                          />
                          {/* Checkouts layer */}
                          <div 
                            className="absolute left-0 right-0 bg-blue-500"
                            style={{ 
                              bottom: `${day.total > 0 ? (day.checkins / day.total) * 100 : 0}%`,
                              height: `${day.total > 0 ? (day.checkouts / day.total) * 100 : 0}%` 
                            }}
                          />
                          {/* Creates layer */}
                          <div 
                            className="absolute left-0 right-0 bg-purple-500"
                            style={{ 
                              bottom: `${day.total > 0 ? ((day.checkins + day.checkouts) / day.total) * 100 : 0}%`,
                              height: `${day.total > 0 ? (day.creates / day.total) * 100 : 0}%` 
                            }}
                          />
                          {/* Other (state changes, deletes) */}
                          <div 
                            className="absolute left-0 right-0 top-0 bg-orange-500"
                            style={{ 
                              height: `${day.total > 0 ? ((day.stateChanges + day.deletes) / day.total) * 100 : 0}%` 
                            }}
                          />
                        </div>
                        
                        {/* Tooltip */}
                        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-plm-bg-secondary border border-plm-border rounded-lg p-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 whitespace-nowrap shadow-lg">
                          <div className="font-medium text-plm-fg mb-1">
                            {timeRange === '24h' 
                              ? new Date(day.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                              : timeRange === 'all'
                              ? day.date
                              : new Date(day.date).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
                            }
                          </div>
                          <div className="space-y-0.5 text-plm-fg-muted">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded bg-emerald-500" />
                              Check-ins: {day.checkins}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded bg-blue-500" />
                              Checkouts: {day.checkouts}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded bg-purple-500" />
                              Creates: {day.creates}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded bg-orange-500" />
                              Other: {day.stateChanges + day.deletes}
                            </div>
                            <div className="pt-1 border-t border-plm-border mt-1">
                              <div>Data in: {formatBytes(day.bytesIn)}</div>
                              <div>Users: {day.uniqueUsers}</div>
                            </div>
                          </div>
                        </div>
                        
                        {/* Day label */}
                        <span className={`text-[10px] ${isToday ? 'text-plm-accent font-medium' : 'text-plm-fg-muted'}`}>
                          {day.dayLabel.substring(0, 3)}
                        </span>
                      </div>
                    )
                  })}
                </div>
                
                {/* Legend */}
                <div className="flex items-center justify-center gap-4 text-xs text-plm-fg-muted pt-2 border-t border-plm-border/50">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded bg-emerald-500" />
                    Check-ins
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded bg-blue-500" />
                    Checkouts
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded bg-purple-500" />
                    Creates
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded bg-orange-500" />
                    Other
                  </div>
                </div>
                
                {/* Peak callout */}
                {networkStats.peakEvents > 0 && (
                  <div className="flex items-center gap-2 text-xs text-plm-fg-muted pt-2">
                    <TrendingUp size={12} className="text-plm-accent" />
                    <span>
                      Peak: <strong className="text-plm-fg">{networkStats.peakEvents}</strong> events {timeRange === '24h' ? 'at' : 'on'} {networkStats.peakDay}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Realtime Status */}
      {status === 'online' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
            <Zap size={14} />
            Realtime
          </div>
          <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-full ${stats.realtimeConnected ? 'bg-purple-500/20' : 'bg-plm-fg-muted/20'}`}>
                <Zap size={16} className={stats.realtimeConnected ? 'text-purple-400' : 'text-plm-fg-muted'} />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-plm-fg">
                  {stats.realtimeConnected ? 'Realtime subscriptions active' : 'No active subscriptions'}
                </div>
                <div className="text-xs text-plm-fg-muted">
                  {stats.realtimeConnected 
                    ? `${supabase.getChannels().length} active channel(s)` 
                    : 'Subscribe to database changes for live updates'}
                </div>
              </div>
            </div>
            
            {/* Channel List */}
            {stats.realtimeConnected && supabase.getChannels().length > 0 && (
              <div className="mt-3 pt-3 border-t border-plm-border/50 space-y-1.5">
                {supabase.getChannels().map((channel, idx) => {
                  const topic = channel.topic || 'unknown'
                  const state = channel.state
                  
                  return (
                    <div 
                      key={idx}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        state === 'joined' ? 'bg-green-400' :
                        state === 'joining' ? 'bg-yellow-400 animate-pulse' :
                        state === 'leaving' ? 'bg-orange-400' :
                        'bg-plm-fg-muted'
                      }`} />
                      <code className="text-plm-fg font-mono truncate flex-1">{topic}</code>
                      <span className="text-plm-fg-muted capitalize">{state}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Server Info */}
      {isAdmin && config?.url && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
            <Server size={14} />
            Server Information
          </div>
          <div className="p-4 bg-plm-bg rounded-lg border border-plm-border text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-plm-fg-muted">Project URL</span>
              <code className="text-plm-fg font-mono">{new URL(config.url).hostname}</code>
            </div>
            <div className="flex justify-between">
              <span className="text-plm-fg-muted">Region</span>
              <span className="text-plm-fg">{extractRegion(config.url)}</span>
            </div>
            {config.orgSlug && (
              <div className="flex justify-between">
                <span className="text-plm-fg-muted">Organization Slug</span>
                <code className="text-plm-fg font-mono">{config.orgSlug}</code>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Not Configured Warning */}
      {!isConfigured && (
        <div className="p-4 bg-orange-500/10 border border-orange-500/30 rounded-lg">
          <div className="flex items-start gap-3">
            <Shield className="text-orange-400 mt-0.5" size={18} />
            <div>
              <div className="font-medium text-plm-fg">Supabase Not Configured</div>
              <p className="text-sm text-plm-fg-muted mt-1">
                Connect to a Supabase project to enable cloud features. Use the organization code from your administrator 
                or configure environment variables during development.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Helper component for stat cards
function StatCard({ 
  icon, 
  label, 
  value, 
  loading 
}: { 
  icon: React.ReactNode
  label: string
  value: number
  loading: boolean
}) {
  return (
    <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
      <div className="flex items-center gap-2 text-plm-fg-muted mb-2">
        {icon}
        <span className="text-xs uppercase tracking-wide">{label}</span>
      </div>
      {loading ? (
        <Loader2 size={18} className="animate-spin text-plm-fg-muted" />
      ) : (
        <div className="text-2xl font-semibold text-plm-fg">{value.toLocaleString()}</div>
      )}
    </div>
  )
}

// Format bytes to human readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

// Extract region from Supabase URL
function extractRegion(url: string): string {
  try {
    const hostname = new URL(url).hostname
    // Format: <project-id>.supabase.co or <project-id>.<region>.supabase.co
    const parts = hostname.split('.')
    if (parts.length >= 3 && parts[1] !== 'supabase') {
      // Has region in URL
      const regionMap: Record<string, string> = {
        'us-east-1': 'US East (N. Virginia)',
        'us-west-1': 'US West (N. California)',
        'eu-west-1': 'EU (Ireland)',
        'eu-central-1': 'EU (Frankfurt)',
        'ap-southeast-1': 'Asia Pacific (Singapore)',
        'ap-northeast-1': 'Asia Pacific (Tokyo)',
        'ap-south-1': 'Asia Pacific (Mumbai)',
        'sa-east-1': 'South America (São Paulo)',
      }
      return regionMap[parts[1]] || parts[1]
    }
    return 'Default'
  } catch {
    return 'Unknown'
  }
}

