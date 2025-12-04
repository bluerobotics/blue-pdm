import { useState, useEffect } from 'react'
import { Cloud, Shield, Zap, Clock, Users, FolderPlus, Loader2, HardDrive, RefreshCw, WifiOff, LogIn, Check, Settings } from 'lucide-react'
import { usePDMStore } from '../stores/pdmStore'
import { getFiles, signInWithGoogle, isSupabaseConfigured } from '../lib/supabase'

interface WelcomeScreenProps {
  onOpenVault: () => void
  onOpenRecentVault: (path: string) => void
}

export function WelcomeScreen({ onOpenVault, onOpenRecentVault }: WelcomeScreenProps) {
  const { recentVaults, user, organization, setStatusMessage, isOfflineMode, setOfflineMode, autoConnect, setAutoConnect } = usePDMStore()
  const [isConnecting, setIsConnecting] = useState(false)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [cloudFileCount, setCloudFileCount] = useState(0)
  const [loadingCloud, setLoadingCloud] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Auto-connect on mount if enabled and we have a recent vault
  useEffect(() => {
    if (autoConnect && recentVaults.length > 0 && (user || isOfflineMode)) {
      handleConnect()
    }
  }, [user, isOfflineMode])

  // Load cloud vault file count when user/org is available
  useEffect(() => {
    const loadCloudFiles = async () => {
      if (!organization?.id) return
      
      setLoadingCloud(true)
      try {
        const { files, error } = await getFiles(organization.id)
        if (!error && files) {
          setCloudFileCount(files.length)
        }
      } catch (err) {
        console.error('Error loading cloud files:', err)
      } finally {
        setLoadingCloud(false)
      }
    }
    
    loadCloudFiles()
  }, [organization?.id])

  const handleSignIn = async () => {
    if (!isSupabaseConfigured) {
      setStatusMessage('Supabase not configured')
      return
    }
    
    setIsSigningIn(true)
    try {
      const { error } = await signInWithGoogle()
      if (error) {
        console.error('Sign in error:', error)
        setStatusMessage(`Sign in failed: ${error.message}`)
      }
    } catch (err) {
      console.error('Sign in error:', err)
      setStatusMessage('Sign in failed')
    } finally {
      setIsSigningIn(false)
    }
  }

  const handleOfflineMode = () => {
    setOfflineMode(true)
  }

  const handleConnect = async () => {
    if (!window.electronAPI) return
    
    setIsConnecting(true)
    try {
      // Determine vault path
      let vaultPath: string
      
      if (recentVaults.length > 0) {
        // Use most recent vault
        vaultPath = recentVaults[0]
      } else if (organization) {
        // Create new vault with org slug
        vaultPath = `C:\\${organization.slug}-vault`
      } else {
        // Offline mode - generic name
        vaultPath = `C:\\pdm-vault`
      }
      
      // Create folder if it doesn't exist, then connect
      const result = await window.electronAPI.createWorkingDir(vaultPath)
      if (result.success && result.path) {
        setStatusMessage(`Connected to vault: ${result.path}`)
        onOpenRecentVault(result.path)
      } else {
        setStatusMessage(result.error || 'Failed to connect to vault')
      }
    } catch (err) {
      console.error('Error connecting to vault:', err)
      setStatusMessage('Failed to connect to vault')
    } finally {
      setIsConnecting(false)
    }
  }

  // ============================================
  // SIGN IN SCREEN (shown when not authenticated)
  // ============================================
  if (!user && !isOfflineMode) {
    return (
      <div className="flex-1 flex items-center justify-center bg-pdm-bg overflow-auto">
        <div className="max-w-md w-full p-8">
          {/* Logo and Title */}
          <div className="text-center mb-10">
            <div className="flex justify-center mb-4">
              <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-pdm-accent to-pdm-accent-dim flex items-center justify-center shadow-lg shadow-pdm-accent/20">
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" className="text-white">
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
            </div>
            <h1 className="text-3xl font-bold text-pdm-fg mb-2">Blue PDM</h1>
            <p className="text-pdm-fg-dim">
              Product Data Management for engineering teams
            </p>
          </div>

          {/* Sign In Options */}
          <div className="space-y-4">
            <button
              onClick={handleSignIn}
              disabled={isSigningIn || !isSupabaseConfigured}
              className="w-full btn btn-primary btn-lg gap-3 justify-center py-4"
            >
              {isSigningIn ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <LogIn size={20} />
              )}
              Sign In with Google
            </button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-pdm-border"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-2 bg-pdm-bg text-pdm-fg-muted">or</span>
              </div>
            </div>

            <button
              onClick={handleOfflineMode}
              className="w-full btn btn-secondary gap-3 justify-center py-3"
            >
              <WifiOff size={18} />
              Work Offline
            </button>
          </div>

          {/* Info */}
          <div className="mt-8 text-center">
            <p className="text-xs text-pdm-fg-muted">
              Sign in to sync with your team's vault.<br />
              Offline mode allows local-only file management.
            </p>
          </div>

          {/* Footer */}
          <div className="text-center mt-12 text-xs text-pdm-fg-muted">
            Open source PDM • SolidWorks & CAD files
          </div>
        </div>
      </div>
    )
  }

  // ============================================
  // VAULT CONNECTION SCREEN (shown when authenticated or offline)
  // ============================================
  const vaultName = recentVaults.length > 0 
    ? recentVaults[0].split(/[/\\]/).pop() 
    : organization 
      ? `${organization.slug}-vault`
      : 'pdm-vault'
  
  const vaultPath = recentVaults.length > 0 
    ? recentVaults[0]
    : organization 
      ? `C:\\${organization.slug}-vault`
      : 'C:\\pdm-vault'

  const features = [
    { icon: <RefreshCw size={18} />, title: 'Folder Sync', description: 'Folders sync instantly' },
    { icon: <Shield size={18} />, title: 'Check In/Out', description: 'Lock files while editing' },
    { icon: <Users size={18} />, title: 'Team Status', description: 'Real-time lock status' },
    { icon: <Zap size={18} />, title: 'CAD Optimized', description: 'Built for large files' },
    { icon: <Clock size={18} />, title: 'History', description: 'Full version tracking' },
    { icon: <Cloud size={18} />, title: 'Cloud Sync', description: 'Access anywhere' }
  ]

  return (
    <div className="flex-1 flex items-center justify-center bg-pdm-bg overflow-auto">
      <div className="max-w-lg w-full p-8">
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-pdm-accent to-pdm-accent-dim flex items-center justify-center">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-white">
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
          </div>
          
          {/* User & Org Info or Offline Badge */}
          {isOfflineMode ? (
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-pdm-warning/10 border border-pdm-warning/30 rounded-full">
              <WifiOff size={14} className="text-pdm-warning" />
              <span className="text-sm text-pdm-warning font-medium">Offline Mode</span>
            </div>
          ) : user && (
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-pdm-bg-light border border-pdm-border rounded-full">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" className="w-5 h-5 rounded-full" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-pdm-accent flex items-center justify-center text-[10px] text-white font-semibold">
                  {(user.full_name || user.email)[0].toUpperCase()}
                </div>
              )}
              <span className="text-sm text-pdm-fg-dim">
                {user.full_name || user.email}
              </span>
              {organization && (
                <>
                  <span className="text-pdm-fg-muted">•</span>
                  <span className="text-sm text-pdm-accent font-medium">
                    {organization.name}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Vault Card */}
        <div className="bg-pdm-bg-light border border-pdm-border rounded-xl p-6 mb-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-xl bg-pdm-accent/20 flex items-center justify-center flex-shrink-0">
              <HardDrive size={24} className="text-pdm-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold text-pdm-fg truncate">
                {vaultName}
              </h2>
              <p className="text-xs text-pdm-fg-muted truncate">
                {vaultPath}
              </p>
            </div>
          </div>

          {/* Cloud status */}
          {!isOfflineMode && organization && (
            <div className="flex items-center gap-2 text-xs text-pdm-fg-dim mb-4 px-1">
              <Cloud size={14} className="text-pdm-accent" />
              {loadingCloud ? (
                <span>Loading...</span>
              ) : (
                <span>
                  {cloudFileCount > 0 
                    ? `${cloudFileCount} file${cloudFileCount !== 1 ? 's' : ''} in cloud`
                    : 'Empty vault'}
                </span>
              )}
            </div>
          )}

          {/* Connect Button */}
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="w-full btn btn-primary btn-lg gap-2 justify-center"
          >
            {isConnecting ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <FolderPlus size={20} />
            )}
            Connect
          </button>

          {/* Auto-connect toggle */}
          <label className="flex items-center gap-2 mt-4 cursor-pointer justify-center">
            <div 
              onClick={() => setAutoConnect(!autoConnect)}
              className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                autoConnect 
                  ? 'bg-pdm-accent border-pdm-accent' 
                  : 'border-pdm-border hover:border-pdm-fg-muted'
              }`}
            >
              {autoConnect && <Check size={12} className="text-white" />}
            </div>
            <span className="text-xs text-pdm-fg-muted">
              Auto-connect on startup
            </span>
          </label>
        </div>

        {/* Advanced Options */}
        <div className="mb-6">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-xs text-pdm-fg-muted hover:text-pdm-fg transition-colors mx-auto"
          >
            <Settings size={14} />
            {showAdvanced ? 'Hide options' : 'More options'}
          </button>
          
          {showAdvanced && (
            <div className="mt-4 space-y-2">
              <button
                onClick={onOpenVault}
                className="w-full btn btn-secondary btn-sm justify-center"
              >
                Choose Different Location...
              </button>
              
              {recentVaults.length > 1 && (
                <div className="pt-2">
                  <div className="text-xs text-pdm-fg-muted mb-2">Other recent vaults:</div>
                  {recentVaults.slice(1, 4).map(vault => (
                    <button
                      key={vault}
                      onClick={() => onOpenRecentVault(vault)}
                      className="w-full text-left px-3 py-2 text-xs bg-pdm-bg border border-pdm-border rounded hover:border-pdm-accent hover:bg-pdm-highlight transition-all truncate text-pdm-fg-dim hover:text-pdm-fg mb-1"
                    >
                      {vault}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Features Grid */}
        {!isOfflineMode && (
          <div className="grid grid-cols-3 gap-2">
            {features.map((feature, i) => (
              <div 
                key={i}
                className="p-2 bg-pdm-bg-light border border-pdm-border rounded-lg text-center"
              >
                <div className="text-pdm-accent mb-1 flex justify-center">
                  {feature.icon}
                </div>
                <div className="font-medium text-pdm-fg text-[10px]">
                  {feature.title}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-6 text-xs text-pdm-fg-muted">
          Open source PDM
        </div>
      </div>
    </div>
  )
}
