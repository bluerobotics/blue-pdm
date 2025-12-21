import { useState, useEffect, useRef, useCallback } from 'react'
import { registerModule, unregisterModule } from '@/lib/telemetry'
import { LogOut, ChevronDown, Building2, Search, Database, ZoomIn, Minus, Plus, RotateCcw, Monitor, Laptop, Loader2, Settings, WifiOff, Wifi, PanelLeft, PanelBottom, PanelRight, SlidersHorizontal, Gauge, Users, Activity, User, Layers } from 'lucide-react'
import { usePDMStore } from '../stores/pdmStore'
import { CommandSearch } from './CommandSearch'
import { signInWithGoogle, signOut, isSupabaseConfigured, getActiveSessions, endRemoteSession, UserSession, supabase } from '../lib/supabase'
import { getInitials } from '../types/pdm'
import { logAuth } from '../lib/userActionLogger'
import { SystemStats } from './SystemStats'
import { OnlineUsersIndicator } from './OnlineUsersIndicator'
import { getMachineId } from '../lib/backup'

// Helper to log to both console and electron log file
const uiLog = (level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: unknown) => {
  const logMsg = `[MenuBar] ${message}`
  if (level === 'error') console.error(logMsg, data || '')
  else if (level === 'warn') console.warn(logMsg, data || '')
  else console.log(logMsg, data || '')
  window.electronAPI?.log?.(level, `[MenuBar] ${message}`, data)
}

// Get user's initials for avatar fallback (1-2 characters from name or email)
function getUserInitial(user: { full_name?: string | null; email?: string } | null): string {
  if (!user) return '?'
  return getInitials(user.full_name || user.email)
}

// Simple FPS Counter component
function FpsCounter() {
  const [fps, setFps] = useState(0)
  const frameCountRef = useRef(0)
  const lastTimeRef = useRef(performance.now())
  
  useEffect(() => {
    let rafId: number
    
    const measureFps = () => {
      frameCountRef.current++
      const now = performance.now()
      const delta = now - lastTimeRef.current
      
      if (delta >= 100) {
        setFps(Math.round((frameCountRef.current / delta) * 1000))
        frameCountRef.current = 0
        lastTimeRef.current = now
      }
      
      rafId = requestAnimationFrame(measureFps)
    }
    
    rafId = requestAnimationFrame(measureFps)
    return () => cancelAnimationFrame(rafId)
  }, [])
  
  const color = fps >= 55 ? 'text-emerald-400' : fps >= 30 ? 'text-amber-400' : 'text-rose-400'
  
  return (
    <div className={`flex items-center gap-1 px-1.5 py-0.5 ${color}`} title={`${fps} FPS`}>
      <Gauge size={12} />
      <span className="text-[10px] font-mono tabular-nums">{fps}</span>
    </div>
  )
}

interface MenuBarProps {
  onOpenVault?: () => void
  onRefresh?: () => void
  minimal?: boolean  // Hide Sign In and Settings on welcome/signin screens
}

export function MenuBar({ minimal = false }: MenuBarProps) {
  const { 
    user, 
    organization, 
    setUser, 
    setOrganization, 
    addToast, 
    connectedVaults,
    activeVaultId,
    switchVault,
    setActiveView,
    isOfflineMode,
    setOfflineMode,
    sidebarVisible,
    toggleSidebar,
    detailsPanelVisible,
    toggleDetailsPanel,
    rightPanelVisible,
    toggleRightPanel,
    topbarConfig,
    setTopbarConfig,
    tabsEnabled,
    setTabsEnabled
  } = usePDMStore()
  
  // Register module for telemetry tracking
  useEffect(() => {
    registerModule('MenuBar')
    return () => unregisterModule('MenuBar')
  }, [])
  // appVersion may be used in future UI updates
  const [, setAppVersion] = useState('')
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showVaultDropdown, setShowVaultDropdown] = useState(false)
  const [showZoomDropdown, setShowZoomDropdown] = useState(false)
  const [showTopbarConfigDropdown, setShowTopbarConfigDropdown] = useState(false)
  const [orgLogoUrl, setOrgLogoUrl] = useState<string | null>(null)
  const [zoomFactor, setZoomFactor] = useState(1)
  const [sessions, setSessions] = useState<UserSession[]>([])
  const [currentMachineId, setCurrentMachineId] = useState<string | null>(null)
  const [signingOutSessionId, setSigningOutSessionId] = useState<string | null>(null)
  const vaultDropdownRef = useRef<HTMLDivElement>(null)
  const zoomDropdownRef = useRef<HTMLDivElement>(null)
  const topbarConfigRef = useRef<HTMLDivElement>(null)
  const [titleBarPadding, setTitleBarPadding] = useState(140) // Default fallback
  const [platform, setPlatform] = useState<string>('win32') // Default to Windows
  const [menuBarWidth, setMenuBarWidth] = useState(1200)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuBarRef = useRef<HTMLDivElement>(null)
  
  // Responsive breakpoints for progressive collapse (in order of priority)
  // Elements condense before hiding to maximize space efficiency
  const cpuCondensed = menuBarWidth < 1100  // CPU: full -> single dot
  const zoomCondensed = menuBarWidth < 1000  // Zoom: percentage -> icon only
  const showUserNameByWidth = menuBarWidth > 800
  const showUserNameFinal = showUserNameByWidth && topbarConfig.showUserName  // Both width and config must allow it
  const showVaultName = menuBarWidth > 700
  const showOrgName = menuBarWidth > 600
  const searchMaxWidth = menuBarWidth > 850 ? 'max-w-lg' : menuBarWidth > 700 ? 'max-w-sm' : menuBarWidth > 550 ? 'max-w-[200px]' : 'max-w-[140px]'

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false)
      }
      if (vaultDropdownRef.current && !vaultDropdownRef.current.contains(e.target as Node)) {
        setShowVaultDropdown(false)
      }
      if (zoomDropdownRef.current && !zoomDropdownRef.current.contains(e.target as Node)) {
        setShowZoomDropdown(false)
      }
      if (topbarConfigRef.current && !topbarConfigRef.current.contains(e.target as Node)) {
        setShowTopbarConfigDropdown(false)
      }
    }
    if (showUserMenu || showVaultDropdown || showZoomDropdown || showTopbarConfigDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showUserMenu, showVaultDropdown, showZoomDropdown, showTopbarConfigDropdown])

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getVersion().then(setAppVersion)
      window.electronAPI.getPlatform().then(setPlatform)
      window.electronAPI.getZoomFactor?.().then(z => setZoomFactor(z || 1))
      // Get the actual titlebar overlay rect
      window.electronAPI.getTitleBarOverlayRect?.().then((rect) => {
        if (rect?.width) {
          setTitleBarPadding(rect.width + 8) // Add small margin
        }
      })
      
      // Listen for zoom changes from keyboard shortcuts
      const unsubscribe = window.electronAPI.onZoomChanged?.((factor) => {
        setZoomFactor(factor)
      })
      return () => unsubscribe?.()
    }
  }, [])

  // Load sessions on mount and refresh when menu is opened
  useEffect(() => {
    if (!user?.id) {
      setSessions([])
      return
    }
    
    const loadSessions = async () => {
      const machineId = await getMachineId()
      setCurrentMachineId(machineId)
      const { sessions: activeSessions } = await getActiveSessions(user.id)
      setSessions(activeSessions)
    }
    
    // Load sessions immediately on mount
    loadSessions()
    
    // Refresh when menu is opened
    if (showUserMenu) {
      loadSessions()
    }
  }, [user?.id, showUserMenu])

  // Load organization logo (with signed URL refresh)
  useEffect(() => {
    if (!organization?.id) {
      setOrgLogoUrl(null)
      return
    }

    const loadOrgLogo = async () => {
      // If there's a storage path, generate a fresh signed URL
      if (organization.logo_storage_path) {
        const { data: signedData } = await supabase.storage
          .from('vault')
          .createSignedUrl(organization.logo_storage_path, 60 * 60 * 24) // 24 hours
        
        if (signedData?.signedUrl) {
          setOrgLogoUrl(signedData.signedUrl)
          return
        }
      }
      
      // Fall back to stored logo_url if no storage path or signing failed
      if (organization.logo_url) {
        setOrgLogoUrl(organization.logo_url)
      } else {
        setOrgLogoUrl(null)
      }
    }

    loadOrgLogo()
  }, [organization?.id, organization?.logo_storage_path, organization?.logo_url])

  const handleRemoteSignOut = async (sessionId: string) => {
    setSigningOutSessionId(sessionId)
    try {
      const { success } = await endRemoteSession(sessionId)
      if (success) {
        setSessions(prev => prev.filter(s => s.id !== sessionId))
      }
    } finally {
      setSigningOutSessionId(null)
    }
  }

  const getPlatformIcon = (p: string | null, size: number = 12) => {
    if (p === 'darwin') return <Laptop size={size} />
    return <Monitor size={size} />
  }
  
  // Zoom handlers
  const handleZoomIn = useCallback(async () => {
    const newZoom = Math.min(2.0, zoomFactor + 0.1)
    const result = await window.electronAPI?.setZoomFactor?.(newZoom)
    if (result?.success && result.factor) {
      setZoomFactor(result.factor)
    }
  }, [zoomFactor])
  
  const handleZoomOut = useCallback(async () => {
    const newZoom = Math.max(0.5, zoomFactor - 0.1)
    const result = await window.electronAPI?.setZoomFactor?.(newZoom)
    if (result?.success && result.factor) {
      setZoomFactor(result.factor)
    }
  }, [zoomFactor])
  
  const handleResetZoom = useCallback(async () => {
    const result = await window.electronAPI?.setZoomFactor?.(1)
    if (result?.success && result.factor) {
      setZoomFactor(result.factor)
    }
  }, [])
  
  const handleSliderChange = useCallback(async (value: number) => {
    const result = await window.electronAPI?.setZoomFactor?.(value)
    if (result?.success && result.factor) {
      setZoomFactor(result.factor)
    }
  }, [])

  // Monitor menubar width for responsive collapse
  useEffect(() => {
    if (!menuBarRef.current) return

    const updateWidth = () => {
      if (menuBarRef.current) {
        const rect = menuBarRef.current.getBoundingClientRect()
        setMenuBarWidth(rect.width)
      }
    }

    // Initial calculation
    updateWidth()
    
    // Use ResizeObserver for accurate measurements
    const resizeObserver = new ResizeObserver(updateWidth)
    resizeObserver.observe(menuBarRef.current)
    
    // Also listen to window resize as fallback
    window.addEventListener('resize', updateWidth)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateWidth)
    }
  }, [])

  const handleSignIn = async () => {
    logAuth('Sign in button clicked')
    uiLog('info', 'Sign in button clicked from MenuBar')
    
    if (!isSupabaseConfigured()) {
      uiLog('warn', 'Supabase not configured')
      alert('Supabase is not configured. Please add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.')
      return
    }
    
    setIsSigningIn(true)
    uiLog('info', 'Starting Google sign-in flow from MenuBar')
    
    try {
      const { data, error } = await signInWithGoogle()
      uiLog('info', 'signInWithGoogle returned', { 
        hasData: !!data, 
        hasError: !!error,
        errorMessage: error?.message 
      })
      
      if (error) {
        uiLog('error', 'Sign in failed', { error: error.message })
        alert(`Sign in failed: ${error.message}`)
      } else {
        uiLog('info', 'Sign in completed successfully, auth state change will be handled by App')
      }
    } catch (err) {
      uiLog('error', 'Sign in exception', { error: String(err) })
      alert('Sign in failed. Check the console for details.')
    } finally {
      uiLog('info', 'Sign in flow finished, resetting state')
      setIsSigningIn(false)
    }
  }

  const handleSignOut = async () => {
    logAuth('Sign out clicked')
    uiLog('info', 'Sign out clicked')
    const { error } = await signOut()
    if (error) {
      uiLog('error', 'Sign out error', { error: error.message })
    } else {
      logAuth('Sign out successful')
      uiLog('info', 'Sign out successful')
    }
    setUser(null)
    setOrganization(null)
  }

  return (
    <div ref={menuBarRef} className="h-[38px] bg-plm-activitybar border-b border-plm-border select-none flex-shrink-0 titlebar-drag-region flex items-center">
      {/* Left side - Logo, Organization, and Vault (add padding on macOS for window buttons) */}
      <div 
        className="flex-shrink-0 flex items-center h-full"
        style={{ paddingLeft: platform === 'darwin' ? 72 : 0 }}
      >
        <div className="flex items-center gap-1 px-3 titlebar-no-drag">
          {/* BluePLM Logo */}
          <div className="flex items-center justify-center w-7 h-7 rounded hover:bg-plm-bg-lighter transition-colors" title="BluePLM">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-plm-accent">
              <path 
                d="M12 2L2 7L12 12L22 7L12 2Z" 
                stroke="currentColor" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
              />
              <path 
                d="M2 17L12 22L22 17" 
                stroke="currentColor" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
              />
              <path 
                d="M2 12L12 17L22 12" 
                stroke="currentColor" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
              />
            </svg>
          </div>
          
          {/* Separator */}
          {!minimal && organization && topbarConfig.showOrg && <div className="w-px h-4 bg-plm-border mx-1" />}
          
          {/* Organization (no dropdown for now - single org per user) */}
          {!minimal && organization && topbarConfig.showOrg && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded text-sm text-plm-fg-dim" title={organization.name}>
              {orgLogoUrl ? (
                <img 
                  src={orgLogoUrl} 
                  alt={organization.name} 
                  className="h-5 max-w-[80px] object-contain rounded-sm"
                />
              ) : (
                <Building2 size={16} className="text-plm-fg-muted" />
              )}
              {showOrgName && <span className="max-w-[120px] truncate">{organization.name}</span>}
            </div>
          )}
          
          {/* Separator */}
          {!minimal && connectedVaults.length > 0 && <div className="w-px h-4 bg-plm-border mx-1" />}
          
          {/* Vault Dropdown */}
          {!minimal && connectedVaults.length > 0 && (
            <div className="relative" ref={vaultDropdownRef}>
              <button
                onClick={() => setShowVaultDropdown(!showVaultDropdown)}
                className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-plm-bg-lighter transition-colors text-sm"
                title={connectedVaults.find(v => v.id === activeVaultId)?.name || 'Select Vault'}
              >
                <Database size={14} className="text-plm-fg-muted" />
                {showVaultName && (
                  <span className="text-plm-fg max-w-[140px] truncate">
                    {connectedVaults.find(v => v.id === activeVaultId)?.name || 'Select Vault'}
                  </span>
                )}
                {connectedVaults.length > 1 && (
                  <ChevronDown size={12} className={`text-plm-fg-muted transition-transform ${showVaultDropdown ? 'rotate-180' : ''}`} />
                )}
              </button>
              
              {/* Vault Dropdown Menu */}
              {showVaultDropdown && connectedVaults.length > 1 && (
                <div className="absolute left-0 top-full mt-1 w-56 bg-plm-bg-light border border-plm-border rounded-lg shadow-xl overflow-hidden z-50">
                  <div className="py-1">
                    {connectedVaults.map(vault => (
                      <button
                        key={vault.id}
                        onClick={() => {
                          switchVault(vault.id, vault.localPath)
                          setShowVaultDropdown(false)
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                          vault.id === activeVaultId 
                            ? 'bg-plm-accent/10 text-plm-accent' 
                            : 'text-plm-fg hover:bg-plm-bg-lighter'
                        }`}
                      >
                        <Database size={14} className={`vault-icon ${vault.id === activeVaultId ? 'text-plm-accent' : 'text-plm-fg-muted'}`} />
                        <div className="flex-1 text-left truncate">{vault.name}</div>
                        {vault.id === activeVaultId && (
                          <div className="w-1.5 h-1.5 rounded-full bg-plm-accent" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Center - Search bar (flexible, gets squeezed between left and right) */}
      <div className={`flex-1 min-w-0 flex items-center justify-center px-2`}>
        {!minimal && topbarConfig.showSearch && (
          <div className={`w-full ${searchMaxWidth} titlebar-no-drag`}>
            <CommandSearch maxWidth={searchMaxWidth} />
          </div>
        )}
      </div>

      {/* Right side - Settings and User (with padding for window controls on Windows) */}
      <div 
        className="flex-shrink-0 h-full flex items-center gap-1 pl-2 titlebar-no-drag"
        style={{ paddingRight: platform === 'darwin' ? 16 : titleBarPadding }}
      >
        {/* FPS Counter - independent from System Stats */}
        {!minimal && topbarConfig.showFps && (
          <FpsCounter />
        )}
        
        {/* System Stats - condenses based on user preference or screen width */}
        {!minimal && topbarConfig.showSystemStats && (
          <>
            <SystemStats 
              condensed={cpuCondensed} 
              forceExpanded={topbarConfig.systemStatsExpanded}
            />
            {!cpuCondensed && <div className="w-px h-4 bg-plm-border" />}
          </>
        )}
        
        {/* Zoom dropdown - condenses to icon only when narrow */}
        {!minimal && topbarConfig.showZoom && (
          <div className="relative" ref={zoomDropdownRef}>
            <button
              onClick={() => setShowZoomDropdown(!showZoomDropdown)}
              className={`flex items-center justify-center rounded hover:bg-plm-bg-lighter transition-colors text-plm-fg-muted hover:text-plm-fg ${
                zoomCondensed ? 'w-6 h-6' : 'gap-1 px-1.5 py-1'
              }`}
              title={`Zoom: ${Math.round(zoomFactor * 100)}%`}
            >
              <ZoomIn size={zoomCondensed ? 14 : 16} />
              {!zoomCondensed && <span className="text-[10px] min-w-[28px] text-center">{Math.round(zoomFactor * 100)}%</span>}
            </button>
            
            {/* Zoom Dropdown */}
            {showZoomDropdown && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-plm-bg-light border border-plm-border rounded-lg shadow-xl overflow-hidden z-50">
                <div className="p-3">
                  {/* Zoom label and reset */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-plm-fg-dim">Zoom</span>
                    <button
                      onClick={handleResetZoom}
                      className="flex items-center gap-1 text-[10px] text-plm-fg-muted hover:text-plm-accent transition-colors"
                      title="Reset to 100%"
                    >
                      <RotateCcw size={10} />
                      Reset
                    </button>
                  </div>
                  
                  {/* Slider with +/- buttons */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={handleZoomOut}
                      className="p-1 rounded hover:bg-plm-bg-lighter text-plm-fg-muted hover:text-plm-fg transition-colors flex-shrink-0"
                      title="Zoom Out"
                    >
                      <Minus size={14} />
                    </button>
                    
                    <input
                      type="range"
                      min="0.5"
                      max="2"
                      step="0.1"
                      value={zoomFactor}
                      onChange={(e) => handleSliderChange(parseFloat(e.target.value))}
                      className="flex-1 min-w-0 h-1.5 bg-plm-border rounded-full appearance-none cursor-pointer accent-plm-accent [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-plm-accent [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-sm"
                    />
                    
                    <button
                      onClick={handleZoomIn}
                      className="p-1 rounded hover:bg-plm-bg-lighter text-plm-fg-muted hover:text-plm-fg transition-colors flex-shrink-0"
                      title="Zoom In"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  
                  {/* Current percentage */}
                  <div className="text-center mt-2">
                    <span className="text-sm font-medium text-plm-fg">{Math.round(zoomFactor * 100)}%</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Online Users Indicator */}
        {!minimal && organization && !isOfflineMode && topbarConfig.showOnlineUsers && (
          <>
            <div className="w-px h-4 bg-plm-border mx-1" />
            <OnlineUsersIndicator orgLogoUrl={orgLogoUrl} />
          </>
        )}
        
        {/* Offline Mode Indicator - click to toggle back online */}
        {isOfflineMode && !minimal && (
          <>
            <div className="w-px h-4 bg-plm-border mx-1" />
            <button
              onClick={() => {
                // Require sign-in before going online
                if (!user) {
                  handleSignIn()
                  return
                }
                
                setOfflineMode(false)
                addToast('success', 'Back online - syncing with cloud')
              }}
              className="flex items-center gap-1.5 px-2 py-1 rounded bg-plm-warning/10 hover:bg-plm-warning/20 transition-colors"
              title={!user ? 'Sign in to go back online' : 'Click to go back online'}
            >
              <WifiOff size={14} className="text-plm-warning" />
              <span className="text-xs text-plm-warning font-medium">Offline</span>
            </button>
          </>
        )}
        
        {/* Panel Toggle Buttons - VS Code style */}
        {!minimal && topbarConfig.showPanelToggles && (
          <>
            <div className="w-px h-4 bg-plm-border mx-1" />
            <div className="flex items-center gap-0.5">
              <button
                onClick={toggleSidebar}
                className={`p-1.5 rounded transition-colors ${
                  sidebarVisible 
                    ? 'text-plm-fg hover:bg-plm-bg-lighter' 
                    : 'text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-lighter'
                }`}
                title={`${sidebarVisible ? 'Hide' : 'Show'} Left Sidebar (Ctrl+B)`}
              >
                <PanelLeft size={16} />
              </button>
              <button
                onClick={toggleDetailsPanel}
                className={`p-1.5 rounded transition-colors ${
                  detailsPanelVisible 
                    ? 'text-plm-fg hover:bg-plm-bg-lighter' 
                    : 'text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-lighter'
                }`}
                title={`${detailsPanelVisible ? 'Hide' : 'Show'} Bottom Panel (Ctrl+P)`}
              >
                <PanelBottom size={16} />
              </button>
              <button
                onClick={toggleRightPanel}
                className={`p-1.5 rounded transition-colors ${
                  rightPanelVisible 
                    ? 'text-plm-fg hover:bg-plm-bg-lighter' 
                    : 'text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-lighter'
                }`}
                title={`${rightPanelVisible ? 'Hide' : 'Show'} Right Sidebar`}
              >
                <PanelRight size={16} />
              </button>
            </div>
          </>
        )}
        
        {/* Topbar Configuration Dropdown */}
        {!minimal && (
          <div className="relative" ref={topbarConfigRef}>
            <button
              onClick={() => setShowTopbarConfigDropdown(!showTopbarConfigDropdown)}
              className="p-1.5 rounded text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-lighter transition-colors"
              title="Configure Topbar"
            >
              <SlidersHorizontal size={14} />
            </button>
            
            {showTopbarConfigDropdown && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-plm-bg-light border border-plm-border rounded-lg shadow-xl overflow-hidden z-50">
                <div className="py-1">
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-plm-fg-dim">Show in Topbar</div>
                  
                  {/* FPS Counter */}
                  <button
                    onClick={() => setTopbarConfig({ showFps: !topbarConfig.showFps })}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-plm-fg hover:bg-plm-bg-lighter transition-colors"
                  >
                    <span className="text-plm-fg-muted"><Gauge size={14} /></span>
                    <span className="flex-1 text-left">FPS Counter</span>
                    <div className={`w-8 h-4 rounded-full transition-colors relative ${topbarConfig.showFps ? 'bg-plm-accent' : 'bg-plm-border'}`}>
                      <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${topbarConfig.showFps ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                  </button>
                  
                  {/* System Stats */}
                  <button
                    onClick={() => setTopbarConfig({ showSystemStats: !topbarConfig.showSystemStats })}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-plm-fg hover:bg-plm-bg-lighter transition-colors"
                  >
                    <span className="text-plm-fg-muted"><Activity size={14} /></span>
                    <span className="flex-1 text-left">System Stats</span>
                    <div className={`w-8 h-4 rounded-full transition-colors relative ${topbarConfig.showSystemStats ? 'bg-plm-accent' : 'bg-plm-border'}`}>
                      <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${topbarConfig.showSystemStats ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                  </button>
                  {/* Sub-option: Expanded Stats */}
                  <button
                    onClick={() => topbarConfig.showSystemStats && setTopbarConfig({ systemStatsExpanded: !topbarConfig.systemStatsExpanded })}
                    className={`w-full flex items-center gap-2.5 pl-8 pr-3 py-1 text-xs transition-colors ${
                      topbarConfig.showSystemStats 
                        ? 'text-plm-fg hover:bg-plm-bg-lighter' 
                        : 'text-plm-fg-muted/40 cursor-not-allowed'
                    }`}
                    title="Toggle between minimal (dots) and expanded (full stats) view"
                  >
                    <span className="flex-1 text-left">Expanded</span>
                    <div className={`w-7 h-3.5 rounded-full transition-colors relative ${
                      !topbarConfig.showSystemStats ? 'bg-plm-border/30' :
                      topbarConfig.systemStatsExpanded ? 'bg-plm-accent' : 'bg-plm-border'
                    }`}>
                      <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full shadow-sm transition-transform ${
                        topbarConfig.showSystemStats ? 'bg-white' : 'bg-white/50'
                      } ${topbarConfig.systemStatsExpanded ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                    </div>
                  </button>
                  
                  {/* Zoom Controls */}
                  <button
                    onClick={() => setTopbarConfig({ showZoom: !topbarConfig.showZoom })}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-plm-fg hover:bg-plm-bg-lighter transition-colors"
                  >
                    <span className="text-plm-fg-muted"><ZoomIn size={14} /></span>
                    <span className="flex-1 text-left">Zoom Controls</span>
                    <div className={`w-8 h-4 rounded-full transition-colors relative ${topbarConfig.showZoom ? 'bg-plm-accent' : 'bg-plm-border'}`}>
                      <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${topbarConfig.showZoom ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                  </button>
                  
                  {/* Organization */}
                  <button
                    onClick={() => setTopbarConfig({ showOrg: !topbarConfig.showOrg })}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-plm-fg hover:bg-plm-bg-lighter transition-colors"
                  >
                    <span className="text-plm-fg-muted"><Building2 size={14} /></span>
                    <span className="flex-1 text-left">Organization</span>
                    <div className={`w-8 h-4 rounded-full transition-colors relative ${topbarConfig.showOrg ? 'bg-plm-accent' : 'bg-plm-border'}`}>
                      <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${topbarConfig.showOrg ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                  </button>
                  
                  {/* Search Bar */}
                  <button
                    onClick={() => setTopbarConfig({ showSearch: !topbarConfig.showSearch })}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-plm-fg hover:bg-plm-bg-lighter transition-colors"
                  >
                    <span className="text-plm-fg-muted"><Search size={14} /></span>
                    <span className="flex-1 text-left">Search Bar</span>
                    <div className={`w-8 h-4 rounded-full transition-colors relative ${topbarConfig.showSearch ? 'bg-plm-accent' : 'bg-plm-border'}`}>
                      <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${topbarConfig.showSearch ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                  </button>
                  
                  {/* Online Users */}
                  <button
                    onClick={() => setTopbarConfig({ showOnlineUsers: !topbarConfig.showOnlineUsers })}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-plm-fg hover:bg-plm-bg-lighter transition-colors"
                  >
                    <span className="text-plm-fg-muted"><Users size={14} /></span>
                    <span className="flex-1 text-left">Online Users</span>
                    <div className={`w-8 h-4 rounded-full transition-colors relative ${topbarConfig.showOnlineUsers ? 'bg-plm-accent' : 'bg-plm-border'}`}>
                      <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${topbarConfig.showOnlineUsers ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                  </button>
                  
                  {/* Panel Toggles */}
                  <button
                    onClick={() => setTopbarConfig({ showPanelToggles: !topbarConfig.showPanelToggles })}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-plm-fg hover:bg-plm-bg-lighter transition-colors"
                  >
                    <span className="text-plm-fg-muted"><PanelLeft size={14} /></span>
                    <span className="flex-1 text-left">Panel Toggles</span>
                    <div className={`w-8 h-4 rounded-full transition-colors relative ${topbarConfig.showPanelToggles ? 'bg-plm-accent' : 'bg-plm-border'}`}>
                      <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${topbarConfig.showPanelToggles ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                  </button>
                  
                  {/* Tab Bar */}
                  <button
                    onClick={() => setTabsEnabled(!tabsEnabled)}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-plm-fg hover:bg-plm-bg-lighter transition-colors"
                  >
                    <span className="text-plm-fg-muted"><Layers size={14} /></span>
                    <span className="flex-1 text-left">Tab Bar</span>
                    <div className={`w-8 h-4 rounded-full transition-colors relative ${tabsEnabled ? 'bg-plm-accent' : 'bg-plm-border'}`}>
                      <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${tabsEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                  </button>
                  
                  {/* User Avatar */}
                  <button
                    onClick={() => setTopbarConfig({ showUserName: !topbarConfig.showUserName })}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-plm-fg hover:bg-plm-bg-lighter transition-colors"
                    title="Toggle between avatar only and avatar with name"
                  >
                    <span className="text-plm-fg-muted"><User size={14} /></span>
                    <span className="flex-1 text-left">User Name</span>
                    <div className={`w-8 h-4 rounded-full transition-colors relative ${topbarConfig.showUserName ? 'bg-plm-accent' : 'bg-plm-border'}`}>
                      <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${topbarConfig.showUserName ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        
        {user && !minimal ? (
          <div className="relative" ref={menuRef}>
            <button 
              onClick={() => setShowUserMenu(!showUserMenu)}
              className={`flex items-center rounded hover:bg-plm-bg-lighter transition-colors ${
                showUserNameFinal ? 'gap-2 px-2 py-1' : 'justify-center w-7 h-7'
              }`}
              title={user.full_name || user.email}
            >
              {user.avatar_url ? (
                <>
                  <img 
                    src={user.avatar_url} 
                    alt={user.full_name || user.email}
                    className={showUserNameFinal ? 'w-7 h-7 rounded-full' : 'w-6 h-6 rounded-full'}
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.style.display = 'none'
                      target.nextElementSibling?.classList.remove('hidden')
                    }}
                  />
                  <div className={`rounded-full bg-plm-accent flex items-center justify-center text-white font-semibold hidden ${
                    showUserNameFinal ? 'w-7 h-7 text-xs' : 'w-6 h-6 text-[10px]'
                  }`}>
                    {getUserInitial(user)}
                  </div>
                </>
              ) : (
                <div className={`rounded-full bg-plm-accent flex items-center justify-center text-white font-semibold ${
                  showUserNameFinal ? 'w-7 h-7 text-xs' : 'w-6 h-6 text-[10px]'
                }`}>
                  {getUserInitial(user)}
                </div>
              )}
              {showUserNameFinal && (
                <>
                  <span className="text-xs text-plm-fg-dim max-w-[120px] truncate">
                    {user.full_name || user.email}
                  </span>
                  <ChevronDown size={12} className={`text-plm-fg-muted transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
                </>
              )}
            </button>

            {/* Simplified Dropdown Menu */}
            {showUserMenu && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-plm-bg-light border border-plm-border rounded-lg shadow-xl overflow-hidden z-50">
                {/* User Info Header */}
                <div className="px-4 py-3 border-b border-plm-border">
                  <div className="flex items-center gap-3">
                    {user.avatar_url ? (
                      <>
                        <img 
                          src={user.avatar_url} 
                          alt={user.full_name || user.email}
                          className="w-10 h-10 rounded-full"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement
                            target.style.display = 'none'
                            target.nextElementSibling?.classList.remove('hidden')
                          }}
                        />
                        <div className="w-10 h-10 rounded-full bg-plm-accent flex items-center justify-center text-sm text-white font-semibold hidden">
                          {getUserInitial(user)}
                        </div>
                      </>
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-plm-accent flex items-center justify-center text-sm text-white font-semibold">
                        {getUserInitial(user)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-plm-fg truncate">
                        {user.full_name || 'No name'}
                      </div>
                      <div className="text-xs text-plm-fg-muted truncate">
                        {user.email}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Settings */}
                <div className="py-1 border-b border-plm-border">
                  <button 
                    onClick={() => {
                      setShowUserMenu(false)
                      setActiveView('settings')
                      setTimeout(() => {
                        window.dispatchEvent(new CustomEvent('navigate-settings-tab', { detail: 'profile' }))
                      }, 0)
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-plm-fg hover:bg-plm-bg-lighter transition-colors"
                  >
                    <Settings size={14} />
                    Settings
                  </button>
                  
                  {/* Offline mode toggle */}
                  <button 
                    onClick={() => {
                      setShowUserMenu(false)
                      if (isOfflineMode) {
                        setOfflineMode(false)
                        addToast('success', 'Back online - syncing with cloud')
                      } else {
                        setOfflineMode(true)
                        addToast('info', 'Switched to offline mode')
                      }
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                      isOfflineMode 
                        ? 'text-plm-success hover:bg-plm-success/10' 
                        : 'text-plm-fg-muted hover:bg-plm-bg-lighter'
                    }`}
                  >
                    {isOfflineMode ? <Wifi size={14} /> : <WifiOff size={14} />}
                    {isOfflineMode ? 'Go Online' : 'Go Offline'}
                  </button>
                </div>

                {/* Sessions */}
                <div className="px-4 py-2 border-b border-plm-border">
                  <div className="text-[10px] uppercase tracking-wide text-plm-fg-dim mb-1.5">Sessions</div>
                  <div className="space-y-1">
                    {sessions.map(session => {
                      const isCurrentDevice = session.machine_id === currentMachineId
                      const isSigningOut = signingOutSessionId === session.id
                      // Format last seen for other devices
                      const formatLastSeen = (lastSeen: string) => {
                        const diff = Math.floor((Date.now() - new Date(lastSeen).getTime()) / 1000)
                        if (diff < 60) return 'now'
                        if (diff < 120) return '1m ago'
                        return `${Math.floor(diff / 60)}m ago`
                      }
                      return (
                        <div 
                          key={session.id}
                          className={`flex items-center gap-2 py-1 px-1.5 rounded text-xs ${
                            isCurrentDevice ? 'bg-plm-accent/10' : ''
                          }`}
                        >
                          <span className="w-2 h-2 rounded-full bg-plm-success flex-shrink-0" />
                          <span className={isCurrentDevice ? 'text-plm-accent' : 'text-plm-fg-muted'}>
                            {getPlatformIcon(session.platform)}
                          </span>
                          <span className={`flex-1 truncate ${isCurrentDevice ? 'text-plm-fg' : 'text-plm-fg-muted'}`}>
                            {session.machine_name}
                          </span>
                          {isCurrentDevice ? (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-plm-accent/20 text-plm-accent">
                              now
                            </span>
                          ) : (
                            <>
                              <span className="text-[9px] text-plm-fg-dim">
                                {formatLastSeen(session.last_seen)}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleRemoteSignOut(session.id)
                                }}
                                disabled={isSigningOut}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-plm-bg-lighter hover:bg-plm-error/20 text-plm-fg-dim hover:text-plm-error transition-colors disabled:opacity-50"
                              >
                                {isSigningOut ? (
                                  <Loader2 size={10} className="animate-spin" />
                                ) : (
                                  <LogOut size={10} />
                                )}
                                <span>Sign out</span>
                              </button>
                            </>
                          )}
                        </div>
                      )
                    })}
                    {sessions.length === 0 && (
                      <div className="text-xs text-plm-fg-dim py-1">No active sessions</div>
                    )}
                  </div>
                </div>

                {/* Sign Out */}
                <div className="py-1">
                  <button 
                    onClick={() => {
                      setShowUserMenu(false)
                      handleSignOut()
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-plm-error hover:bg-red-900/20 transition-colors"
                  >
                    <LogOut size={14} />
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : !minimal ? (
          <button 
            onClick={handleSignIn}
            disabled={isSigningIn}
            className="text-xs text-plm-accent hover:text-plm-accent-hover transition-colors font-medium disabled:opacity-50"
          >
            {isSigningIn ? 'Signing in...' : 'Sign In with Google'}
          </button>
        ) : null}
      </div>
    </div>
  )
}
