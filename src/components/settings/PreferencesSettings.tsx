import { useState, useEffect } from 'react'
import {
  LogOut, 
  Monitor, 
  Laptop, 
  Loader2,
  RefreshCw, 
  Download, 
  CheckCircle, 
  Plus,
  X,
  FileText,
  ToggleLeft,
  ToggleRight,
  Moon,
  Sun,
  Waves,
  Globe,
  ChevronDown,
  Snowflake,
  Ghost,
  CloudDownload,
  CloudSun,
  Crown,
  Trash2,
  BarChart3,
  Shield
} from 'lucide-react'
import { usePDMStore, ThemeMode, Language } from '../../stores/pdmStore'
import { CalendarDays } from 'lucide-react'
import { signOut, getSupabaseClient, endRemoteSession } from '../../lib/supabase'
import { getMachineId } from '../../lib/backup'
import { useTranslation } from '../../lib/i18n'
import { isAnalyticsEnabled, initAnalytics } from '../../lib/analytics'

interface UserSession {
  id: string
  machine_id: string
  machine_name: string
  platform: string | null
  app_version: string | null
  last_seen: string
  is_active: boolean
}

// Only show languages that have actual translations (not English fallback)
const languageOptions: { value: Language; label: string; nativeLabel: string }[] = [
  { value: 'en', label: 'English', nativeLabel: 'English' },
  { value: 'fr', label: 'French', nativeLabel: 'Français' },
  { value: 'de', label: 'German', nativeLabel: 'Deutsch' },
  { value: 'es', label: 'Spanish', nativeLabel: 'Español' },
  { value: 'pt', label: 'Portuguese', nativeLabel: 'Português' },
  { value: 'zh-CN', label: 'Chinese (Simplified)', nativeLabel: '简体中文' },
  { value: 'zh-TW', label: 'Chinese (Traditional)', nativeLabel: '繁體中文' },
  { value: 'sindarin', label: 'Sindarin (Elvish)', nativeLabel: '🧝 Tengwar' },
]

export function PreferencesSettings() {
  const { t } = useTranslation()
  const { 
    user, 
    setUser, 
    setOrganization,
    activeVaultId,
    lowercaseExtensions, 
    setLowercaseExtensions,
    ignorePatterns,
    addIgnorePattern,
    removeIgnorePattern,
    theme,
    setTheme,
    autoApplySeasonalThemes,
    setAutoApplySeasonalThemes,
    language,
    setLanguage,
    autoDownloadCloudFiles,
    setAutoDownloadCloudFiles,
    autoDownloadUpdates,
    setAutoDownloadUpdates,
    autoDownloadExcludedFiles,
    clearAutoDownloadExclusions,
    logSharingEnabled,
    setLogSharingEnabled
  } = usePDMStore()
  
  const [sessions, setSessions] = useState<UserSession[]>([])
  const [currentMachineId, setCurrentMachineId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [signingOutSessionId, setSigningOutSessionId] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState<string>('')
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [updateCheckResult, setUpdateCheckResult] = useState<'none' | 'available' | 'error' | null>(null)
  const [newIgnorePattern, setNewIgnorePattern] = useState('')
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false)

  // Theme options with translations
  const themeOptions: { value: ThemeMode; label: string; icon: React.ReactNode; description: string }[] = [
    { value: 'dark', label: t('preferences.themeDark'), icon: <Moon size={18} />, description: t('preferences.themeDarkDesc') },
    { value: 'deep-blue', label: t('preferences.themeDeepBlue'), icon: <Waves size={18} />, description: t('preferences.themeDeepBlueDesc') },
    { value: 'kenneth', label: t('preferences.themeKenneth'), icon: <Crown size={18} />, description: t('preferences.themeKennethDesc') },
    { value: 'light', label: t('preferences.themeLight'), icon: <Sun size={18} />, description: t('preferences.themeLightDesc') },
    { value: 'weather', label: t('preferences.themeWeather'), icon: <CloudSun size={18} />, description: t('preferences.themeWeatherDesc') },
    { value: 'christmas', label: t('preferences.themeChristmas'), icon: <Snowflake size={18} />, description: t('preferences.themeChristmasDesc') },
    { value: 'halloween', label: t('preferences.themeHalloween'), icon: <Ghost size={18} />, description: t('preferences.themeHalloweenDesc') },
    { value: 'system', label: t('preferences.themeSystem'), icon: <Monitor size={18} />, description: t('preferences.themeSystemDesc') },
  ]

  // Get app version on mount
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getVersion().then(setAppVersion)
    }
  }, [])

  useEffect(() => {
    if (!user) return

    const loadSessions = async () => {
      setIsLoading(true)
      try {
        // Get current machine ID
        const machineId = await getMachineId()
        setCurrentMachineId(machineId)

        // Fetch all sessions for this user (active within last 5 minutes)
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
        const client = getSupabaseClient()
        
        const { data, error } = await client
          .from('user_sessions')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .gte('last_seen', fiveMinutesAgo)
          .order('last_seen', { ascending: false })

        if (!error && data) {
          setSessions(data)
        }
      } catch (err) {
        console.error('Error loading sessions:', err)
      } finally {
        setIsLoading(false)
      }
    }

    loadSessions()
    
    // Refresh every 30 seconds
    const interval = setInterval(loadSessions, 30000)
    return () => clearInterval(interval)
  }, [user])

  const handleSignOut = async () => {
    await signOut()
    setUser(null)
    setOrganization(null)
  }

  const formatLastSeen = (lastSeen: string) => {
    const date = new Date(lastSeen)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const getPlatformIcon = (platform: string | null) => {
    if (platform === 'darwin') return <Laptop size={16} className="text-plm-fg-muted" />
    return <Monitor size={16} className="text-plm-fg-muted" />
  }

  const handleRemoteSignOut = async (sessionId: string) => {
    setSigningOutSessionId(sessionId)
    try {
      const { success, error } = await endRemoteSession(sessionId)
      if (success) {
        // Remove the session from state immediately
        setSessions(prev => prev.filter(s => s.id !== sessionId))
      } else {
        console.error('Failed to sign out session:', error)
      }
    } catch (err) {
      console.error('Error signing out session:', err)
    } finally {
      setSigningOutSessionId(null)
    }
  }

  // Handle manual update check
  const handleCheckForUpdates = async () => {
    if (!window.electronAPI || isCheckingUpdate) return
    
    setIsCheckingUpdate(true)
    setUpdateCheckResult(null)
    
    try {
      const result = await window.electronAPI.checkForUpdates()
      if (result.success && result.updateInfo) {
        setUpdateCheckResult('available')
      } else if (result.success) {
        setUpdateCheckResult('none')
      } else {
        setUpdateCheckResult('error')
      }
    } catch (err) {
      console.error('Update check error:', err)
      setUpdateCheckResult('error')
    } finally {
      setIsCheckingUpdate(false)
      setTimeout(() => setUpdateCheckResult(null), 5000)
    }
  }
  
  const handleAddIgnorePattern = () => {
    if (!newIgnorePattern.trim() || !activeVaultId) return
    addIgnorePattern(activeVaultId, newIgnorePattern.trim())
    setNewIgnorePattern('')
  }
  
  // Get ignore patterns for current vault
  const currentVaultPatterns = activeVaultId ? (ignorePatterns[activeVaultId] || []) : []

  if (!user) {
    return (
      <div className="text-center py-12 text-plm-fg-muted text-base">
        Not signed in
      </div>
    )
  }

  // Sort sessions so current device is first
  const sortedSessions = [...sessions].sort((a, b) => {
    if (a.machine_id === currentMachineId) return -1
    if (b.machine_id === currentMachineId) return 1
    return 0
  })

  return (
    <div className="space-y-8">
      {/* Sessions */}
      <section>
        <h2 className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium mb-3">
          Sessions
        </h2>
        <div className="bg-plm-bg rounded-lg border border-plm-border overflow-hidden">
          <div className="px-4 py-3 border-b border-plm-border">
            <p className="text-sm text-plm-fg-muted">
              Devices where you're currently signed in
            </p>
          </div>
          
          <div className="p-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-4 text-plm-fg-muted">
                <Loader2 size={18} className="animate-spin mr-2" />
                <span className="text-base">Loading sessions...</span>
              </div>
            ) : sortedSessions.length === 0 ? (
              <div className="text-center py-4 text-plm-fg-muted text-base">
                No active sessions
              </div>
            ) : (
              <div className="space-y-2">
                {sortedSessions.map(session => {
                  const isCurrentDevice = session.machine_id === currentMachineId
                  const isSigningOut = signingOutSessionId === session.id
                  return (
                    <div 
                      key={session.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border ${
                        isCurrentDevice 
                          ? 'bg-plm-accent/5 border-plm-accent/30' 
                          : 'bg-plm-bg-light border-plm-border'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        isCurrentDevice ? 'bg-plm-accent/20' : 'bg-plm-highlight'
                      }`}>
                        {getPlatformIcon(session.platform)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-base font-medium text-plm-fg truncate flex items-center gap-2">
                          {session.machine_name}
                          {isCurrentDevice && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-plm-accent/20 text-plm-accent font-medium">
                              This device
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-plm-fg-muted flex items-center gap-2">
                          <span className="capitalize">{session.platform || 'Unknown'}</span>
                          {session.app_version && (
                            <>
                              <span className="text-plm-border">•</span>
                              <span>v{session.app_version}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-sm text-plm-fg-muted flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full bg-plm-success ${isCurrentDevice ? 'animate-pulse' : ''}`} />
                          {formatLastSeen(session.last_seen)}
                        </div>
                        <button
                          onClick={() => isCurrentDevice ? handleSignOut() : handleRemoteSignOut(session.id)}
                          disabled={isSigningOut}
                          className="p-1.5 rounded hover:bg-plm-error/20 text-plm-fg-muted hover:text-plm-error transition-colors disabled:opacity-50"
                          title={isCurrentDevice ? "Sign out" : "Sign out this device"}
                        >
                          {isSigningOut ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <LogOut size={14} />
                          )}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Application Updates */}
      <section>
        <h2 className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium mb-3">
          {t('preferences.applicationUpdates')}
        </h2>
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-base font-medium text-plm-fg">
                BluePLM {appVersion || '...'}
              </div>
              <div className="text-sm text-plm-fg-muted mt-0.5">
                {updateCheckResult === 'none' && t('preferences.youHaveLatest')}
                {updateCheckResult === 'available' && t('preferences.updateAvailable')}
                {updateCheckResult === 'error' && t('preferences.couldNotCheck')}
                {updateCheckResult === null && !isCheckingUpdate && t('preferences.checkForNewVersions')}
              </div>
            </div>
            <button
              onClick={handleCheckForUpdates}
              disabled={isCheckingUpdate}
              className={`flex items-center gap-2 px-4 py-2 text-base font-medium rounded-lg transition-colors ${
                updateCheckResult === 'none'
                  ? 'bg-green-600/20 text-green-400 border border-green-600/30'
                  : updateCheckResult === 'available'
                  ? 'bg-plm-accent/20 text-plm-accent border border-plm-accent/30'
                  : 'bg-plm-highlight text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight/80'
              }`}
            >
              {isCheckingUpdate ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {t('preferences.checking')}
                </>
              ) : updateCheckResult === 'none' ? (
                <>
                  <CheckCircle size={14} />
                  {t('preferences.upToDate')}
                </>
              ) : updateCheckResult === 'available' ? (
                <>
                  <Download size={14} />
                  {t('preferences.available')}
                </>
              ) : (
                <>
                  <RefreshCw size={14} />
                  {t('preferences.checkForUpdates')}
                </>
              )}
            </button>
          </div>
        </div>
      </section>

      {/* Theme Selection */}
      <section>
        <h2 className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium mb-3">
          {t('preferences.appearance')}
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {themeOptions.map((option) => {
            const isSelected = theme === option.value
            return (
              <button
                key={option.value}
                onClick={() => !isSelected && setTheme(option.value)}
                className={`flex items-center gap-3 p-4 rounded-lg border-2 transition-all text-left ${
                  isSelected
                    ? 'bg-plm-accent/15 border-plm-accent cursor-default'
                    : 'bg-plm-bg border-plm-border hover:border-plm-accent/50 hover:bg-plm-highlight cursor-pointer'
                }`}
              >
                <div className={`p-2.5 rounded-lg ${
                  isSelected 
                    ? 'bg-plm-accent text-white' 
                    : 'bg-plm-bg-lighter text-plm-fg-muted'
                }`}>
                  {option.icon}
                </div>
                <div className="flex-1">
                  <div className={`text-base font-medium ${isSelected ? 'text-plm-fg' : 'text-plm-fg-dim'}`}>
                    {option.label}
                  </div>
                  <div className="text-sm text-plm-fg-muted">{option.description}</div>
                </div>
                {isSelected && (
                  <CheckCircle size={18} className="text-plm-accent flex-shrink-0" />
                )}
              </button>
            )
          })}
        </div>
        
        {/* Auto-apply seasonal themes toggle */}
        <div className="mt-4 p-4 bg-plm-bg rounded-lg border border-plm-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-plm-highlight">
                <CalendarDays size={18} className="text-plm-fg-muted" />
              </div>
              <div>
                <div className="text-base text-plm-fg">{t('preferences.autoSeasonalThemes')}</div>
                <div className="text-sm text-plm-fg-muted mt-0.5">
                  {t('preferences.autoSeasonalThemesDesc')}
                </div>
              </div>
            </div>
            <button
              onClick={() => setAutoApplySeasonalThemes(!autoApplySeasonalThemes)}
              className="text-plm-accent"
            >
              {autoApplySeasonalThemes ? (
                <ToggleRight size={28} />
              ) : (
                <ToggleLeft size={28} className="text-plm-fg-muted" />
              )}
            </button>
          </div>
        </div>
      </section>

      {/* Language Selection */}
      <section>
        <h2 className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium mb-3">
          {t('preferences.language')}
        </h2>
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-plm-accent text-white">
                <Globe size={18} />
              </div>
              <div>
                <div className="text-base font-medium text-plm-fg">
                  {t('preferences.displayLanguage')}
                </div>
                <div className="text-sm text-plm-fg-muted mt-0.5">
                  {t('preferences.chooseLanguage')}
                </div>
              </div>
            </div>
            <div className="relative">
              <button
                onClick={() => setIsLanguageDropdownOpen(!isLanguageDropdownOpen)}
                className="flex items-center gap-2 px-4 py-2.5 bg-plm-bg-secondary border border-plm-border rounded-lg hover:border-plm-accent/50 transition-colors min-w-[180px]"
              >
                <span className="flex-1 text-left">
                  <span className="text-plm-fg font-medium">
                    {languageOptions.find(l => l.value === language)?.nativeLabel || 'English'}
                  </span>
                  <span className="text-plm-fg-muted text-sm ml-2">
                    ({languageOptions.find(l => l.value === language)?.label || 'English'})
                  </span>
                </span>
                <ChevronDown size={16} className={`text-plm-fg-muted transition-transform ${isLanguageDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              
              {isLanguageDropdownOpen && (
                <>
                  {/* Backdrop */}
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setIsLanguageDropdownOpen(false)} 
                  />
                  {/* Dropdown */}
                  <div className="absolute right-0 top-full mt-1 z-50 bg-plm-bg-secondary border border-plm-border rounded-lg shadow-xl max-h-[320px] overflow-y-auto min-w-[240px]">
                    {languageOptions.map((option) => {
                      const isSelected = language === option.value
                      return (
                        <button
                          key={option.value}
                          onClick={() => {
                            setLanguage(option.value)
                            setIsLanguageDropdownOpen(false)
                          }}
                          className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors ${
                            isSelected
                              ? 'bg-plm-accent/15 text-plm-accent'
                              : 'text-plm-fg hover:bg-plm-highlight'
                          }`}
                        >
                          <div>
                            <span className="font-medium">{option.nativeLabel}</span>
                            <span className="text-plm-fg-muted text-sm ml-2">({option.label})</span>
                          </div>
                          {isSelected && <CheckCircle size={16} className="flex-shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
          <p className="text-xs text-plm-fg-dim mt-3">
            {t('preferences.translationsNote')}
          </p>
        </div>
      </section>

      {/* Sync Settings */}
      <section>
        <h2 className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium mb-3">
          {t('preferences.syncSettings')}
        </h2>
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border space-y-4">
          {/* Auto-download cloud files */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-plm-highlight">
                <CloudDownload size={18} className="text-plm-fg-muted" />
              </div>
              <div>
                <div className="text-base text-plm-fg">{t('preferences.autoDownloadCloudFiles')}</div>
                <div className="text-sm text-plm-fg-muted mt-0.5">
                  {t('preferences.autoDownloadCloudFilesDesc')}
                </div>
              </div>
            </div>
            <button
              onClick={() => setAutoDownloadCloudFiles(!autoDownloadCloudFiles)}
              className="text-plm-accent"
            >
              {autoDownloadCloudFiles ? (
                <ToggleRight size={28} />
              ) : (
                <ToggleLeft size={28} className="text-plm-fg-muted" />
              )}
            </button>
          </div>
          
          {/* Auto-download updates */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-plm-highlight">
                <Download size={18} className="text-plm-fg-muted" />
              </div>
              <div>
                <div className="text-base text-plm-fg">{t('preferences.autoDownloadUpdates')}</div>
                <div className="text-sm text-plm-fg-muted mt-0.5">
                  {t('preferences.autoDownloadUpdatesDesc')}
                </div>
              </div>
            </div>
            <button
              onClick={() => setAutoDownloadUpdates(!autoDownloadUpdates)}
              className="text-plm-accent"
            >
              {autoDownloadUpdates ? (
                <ToggleRight size={28} />
              ) : (
                <ToggleLeft size={28} className="text-plm-fg-muted" />
              )}
            </button>
          </div>
          
          {/* Excluded files from auto-download */}
          {activeVaultId && (autoDownloadExcludedFiles[activeVaultId]?.length || 0) > 0 && (
            <div className="flex items-center justify-between pt-3 border-t border-plm-border">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-plm-highlight">
                  <FileText size={18} className="text-plm-fg-muted" />
                </div>
                <div>
                  <div className="text-base text-plm-fg">{t('preferences.excludedFiles')}</div>
                  <div className="text-sm text-plm-fg-muted mt-0.5">
                    {t('preferences.excludedFilesDesc').replace('{{count}}', String(autoDownloadExcludedFiles[activeVaultId]?.length || 0))}
                  </div>
                </div>
              </div>
              <button
                onClick={() => clearAutoDownloadExclusions(activeVaultId)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-plm-highlight hover:bg-plm-border text-plm-fg-muted hover:text-plm-fg transition-colors"
                title={t('preferences.clearExcludedFiles')}
              >
                <Trash2 size={14} />
                <span className="text-sm">{t('preferences.clearExcludedFiles')}</span>
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Privacy & Usage Statistics */}
      <section>
        <h2 className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium mb-3">
          Privacy
        </h2>
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border space-y-4">
          {/* Usage Statistics Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-plm-highlight">
                <BarChart3 size={18} className="text-plm-fg-muted" />
              </div>
              <div>
                <div className="text-base text-plm-fg">Usage Statistics</div>
                <div className="text-sm text-plm-fg-muted mt-0.5">
                  Send anonymous error reports and performance data to help improve BluePLM
                </div>
              </div>
            </div>
            <button
              onClick={async () => {
                const newValue = !logSharingEnabled
                setLogSharingEnabled(newValue)
                // Notify main process of the change
                await window.electronAPI?.setAnalyticsEnabled(newValue)
                // If enabling, try to initialize analytics in renderer
                if (newValue) {
                  initAnalytics(true)
                }
              }}
              className="text-plm-accent"
            >
              {logSharingEnabled ? (
                <ToggleRight size={28} />
              ) : (
                <ToggleLeft size={28} className="text-plm-fg-muted" />
              )}
            </button>
          </div>
          
          {/* Status indicator */}
          <div className="flex items-center gap-2 px-3 py-2 bg-plm-bg-secondary rounded-lg">
            <Shield size={14} className={logSharingEnabled && isAnalyticsEnabled() ? 'text-plm-success' : 'text-plm-fg-muted'} />
            <span className="text-sm text-plm-fg-muted">
              {logSharingEnabled && isAnalyticsEnabled() 
                ? 'Analytics active — errors and performance data are being reported'
                : logSharingEnabled 
                  ? 'Analytics enabled — will activate on next app restart'
                  : 'Analytics disabled — no data is sent to our servers'}
            </span>
          </div>
          
          <p className="text-xs text-plm-fg-dim">
            We collect error reports, crash data, and basic performance metrics. No file contents, personal data, or design information is ever transmitted.
          </p>
        </div>
      </section>

      {/* File Extensions */}
      <section>
        <h2 className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium mb-3">
          {t('preferences.fileExtensions')}
        </h2>
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-base text-plm-fg">{t('preferences.lowercaseExtensions')}</div>
              <div className="text-sm text-plm-fg-muted mt-0.5">
                {t('preferences.lowercaseExtensionsDesc')}
              </div>
            </div>
            <button
              onClick={() => setLowercaseExtensions(!lowercaseExtensions)}
              className="text-plm-accent"
            >
              {lowercaseExtensions ? (
                <ToggleRight size={28} />
              ) : (
                <ToggleLeft size={28} className="text-plm-fg-muted" />
              )}
            </button>
          </div>
        </div>
      </section>

      {/* Ignore Patterns */}
      <section>
        <h2 className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium mb-3">
          {t('preferences.ignorePatterns')}
        </h2>
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border space-y-3">
          <p className="text-sm text-plm-fg-muted">
            {t('preferences.ignorePatternsDesc')}
          </p>
          
          {/* Add new pattern */}
          <div className="flex gap-2">
            <input
              type="text"
              value={newIgnorePattern}
              onChange={(e) => setNewIgnorePattern(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddIgnorePattern()
              }}
              placeholder={t('preferences.ignorePlaceholder')}
              className="flex-1 bg-plm-bg-secondary border border-plm-border rounded-lg px-3 py-2 text-base focus:border-plm-accent focus:outline-none font-mono"
              disabled={!activeVaultId}
            />
            <button
              onClick={handleAddIgnorePattern}
              disabled={!newIgnorePattern.trim() || !activeVaultId}
              className="btn btn-primary btn-sm flex items-center gap-1"
            >
              <Plus size={14} />
              {t('common.add')}
            </button>
          </div>
          
          {!activeVaultId && (
            <p className="text-sm text-plm-warning">
              {t('preferences.connectVaultForPatterns')}
            </p>
          )}
          
          {/* Pattern list */}
          {currentVaultPatterns.length > 0 ? (
            <div className="space-y-1">
              {currentVaultPatterns.map((pattern, index) => (
                <div 
                  key={index}
                  className="flex items-center gap-2 px-3 py-2 bg-plm-bg-secondary rounded-lg group"
                >
                  <FileText size={16} className="text-plm-fg-muted flex-shrink-0" />
                  <code className="flex-1 text-base font-mono text-plm-fg">{pattern}</code>
                  <button
                    onClick={() => activeVaultId && removeIgnorePattern(activeVaultId, pattern)}
                    className="p-1 text-plm-fg-muted hover:text-plm-error rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : activeVaultId ? (
            <p className="text-sm text-plm-fg-dim text-center py-2">
              {t('preferences.noIgnorePatterns')}
            </p>
          ) : null}
        </div>
      </section>

    </div>
  )
}

