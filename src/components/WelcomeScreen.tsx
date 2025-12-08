import { useState, useEffect } from 'react'
import { FolderPlus, Loader2, HardDrive, WifiOff, LogIn, Check, Settings, Database, Link } from 'lucide-react'
import { usePDMStore, ConnectedVault } from '../stores/pdmStore'
import { signInWithGoogle, isSupabaseConfigured, supabase } from '../lib/supabase'
import { SettingsModal } from './SettingsModal'

// Helper to log to both console and electron log file
const uiLog = (level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: unknown) => {
  const logMsg = `[WelcomeScreen] ${message}`
  if (level === 'error') console.error(logMsg, data || '')
  else if (level === 'warn') console.warn(logMsg, data || '')
  else console.log(logMsg, data || '')
  window.electronAPI?.log?.(level, `[WelcomeScreen] ${message}`, data)
}

// Build vault path based on platform
function buildVaultPath(platform: string, vaultSlug: string): string {
  if (platform === 'darwin') {
    // macOS: ~/Documents/BluePDM/vault-name
    return `~/Documents/BluePDM/${vaultSlug}`
  } else if (platform === 'linux') {
    return `~/BluePDM/${vaultSlug}`
  } else {
    // Windows: C:\BluePDM\vault-name
    return `C:\\BluePDM\\${vaultSlug}`
  }
}

interface VaultStats {
  fileCount: number
  totalSize: number
}

interface Vault {
  id: string
  name: string
  slug: string
  description: string | null
  is_default: boolean
  stats?: VaultStats
}

interface WelcomeScreenProps {
  onOpenRecentVault: (path: string) => void
}

// Format bytes to human-readable size
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export function WelcomeScreen({ onOpenRecentVault }: WelcomeScreenProps) {
  const { 
    recentVaults, 
    user, 
    organization, 
    setStatusMessage, 
    isOfflineMode, 
    setOfflineMode,
    connectedVaults,
    addConnectedVault,
    removeConnectedVault,
    setConnectedVaults,
    addToast,
    vaultsRefreshKey,
    isConnecting: isAuthConnecting  // Global auth connecting state
  } = usePDMStore()
  
  const [isConnectingVault, setIsConnectingVault] = useState(false)  // Local vault connection state
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [orgVaults, setOrgVaults] = useState<Vault[]>([])
  const [isLoadingVaults, setIsLoadingVaults] = useState(false)
  const [connectingVaultId, setConnectingVaultId] = useState<string | null>(null)
  const [platform, setPlatform] = useState<string>('win32')

  // Get platform on mount
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getPlatform().then(setPlatform)
    }
  }, [])

  // Log user/org state changes for debugging
  useEffect(() => {
    uiLog('info', 'User state changed', { 
      hasUser: !!user, 
      email: user?.email,
      hasOrg: !!organization,
      orgName: organization?.name,
      isConnecting: isAuthConnecting
    })
  }, [user, organization, isAuthConnecting])

  // Track if we've seen a user sign in this session (to distinguish "signed out" from "not loaded yet")
  const [hasSeenUser, setHasSeenUser] = useState(false)
  
  useEffect(() => {
    if (user) {
      setHasSeenUser(true)
    }
  }, [user])
  
  // Clear connected vaults when user explicitly signs out (not just on initial load)
  // Only runs after we've seen a user sign in, then they sign out
  useEffect(() => {
    if (hasSeenUser && !user && !isOfflineMode && connectedVaults.length > 0) {
      uiLog('info', 'Clearing connected vaults - user signed out', { count: connectedVaults.length })
      setConnectedVaults([])
    }
  }, [user, isOfflineMode, hasSeenUser])

  // Auto-connect on mount if we have connected vaults
  useEffect(() => {
    if (connectedVaults.length > 0 && (user || isOfflineMode)) {
      uiLog('info', 'Auto-connecting to vault', { vaultName: connectedVaults[0].name })
      // Auto-connect to first connected vault
      const vault = connectedVaults[0]
      onOpenRecentVault(vault.localPath)
    }
  }, [user, isOfflineMode, connectedVaults.length])

  // Load organization vaults with stats
  useEffect(() => {
    const loadOrgVaults = async () => {
      if (!organization?.id) {
        uiLog('debug', 'No organization ID, skipping vault load')
        return
      }
      
      uiLog('info', 'Loading vaults for organization', { orgId: organization.id, orgName: organization.name })
      setIsLoadingVaults(true)
      try {
        // Load vaults
        const { data: vaultsData, error: vaultsError } = await supabase
          .from('vaults')
          .select('id, name, slug, description, is_default')
          .eq('org_id', organization.id)
          .order('is_default', { ascending: false })
          .order('name')
        
        uiLog('info', 'Vaults query result', { 
          count: vaultsData?.length || 0, 
          error: vaultsError?.message,
          errorCode: vaultsError?.code 
        })
        
        if (vaultsError || !vaultsData) {
          uiLog('error', 'Error loading vaults', { error: vaultsError })
          return
        }
        
        // Load stats for each vault
        const vaultsWithStats = await Promise.all(
          (vaultsData as any[]).map(async (vault: any) => {
            const { data: statsData } = await supabase
              .from('files')
              .select('file_size')
              .eq('vault_id', vault.id)
            
            const stats: VaultStats = {
              fileCount: statsData?.length || 0,
              totalSize: statsData?.reduce((acc: number, f: any) => acc + (f.file_size || 0), 0) || 0
            }
            
            return { ...vault, stats } as Vault
          })
        )
        
        setOrgVaults(vaultsWithStats)
        
        // Clean up stale connected vaults that no longer exist on server
        const serverVaultIds = new Set(vaultsData.map((v: any) => v.id))
        const staleVaults = connectedVaults.filter(cv => !serverVaultIds.has(cv.id))
        if (staleVaults.length > 0) {
          uiLog('info', 'Removing stale connected vaults (not on server)', { count: staleVaults.length, ids: staleVaults.map(v => v.id) })
          staleVaults.forEach(v => removeConnectedVault(v.id))
        }
        
        // Also clean up connected vaults where local folder no longer exists
        if (window.electronAPI) {
          const validVaults = connectedVaults.filter(cv => serverVaultIds.has(cv.id))
          for (const cv of validVaults) {
            try {
              const exists = await window.electronAPI.fileExists(cv.localPath)
              if (!exists) {
                uiLog('info', 'Removing connected vault (local folder missing)', { vaultName: cv.name, path: cv.localPath })
                removeConnectedVault(cv.id)
              }
            } catch {
              // If we can't check, leave it alone
            }
          }
        }
      } catch (err) {
        console.error('Error loading vaults:', err)
      } finally {
        setIsLoadingVaults(false)
      }
    }
    
    loadOrgVaults()
  }, [organization?.id, vaultsRefreshKey]) // Refresh when vaultsRefreshKey changes

  const handleSignIn = async () => {
    uiLog('info', 'Sign in button clicked')
    
    if (!isSupabaseConfigured()) {
      uiLog('warn', 'Supabase not configured')
      setStatusMessage('Supabase not configured')
      return
    }
    
    setIsSigningIn(true)
    uiLog('info', 'Starting Google sign-in flow')
    
    try {
      const { data, error } = await signInWithGoogle()
      uiLog('info', 'signInWithGoogle returned', { 
        hasData: !!data, 
        hasError: !!error,
        errorMessage: error?.message 
      })
      
      if (error) {
        uiLog('error', 'Sign in failed', { error: error.message })
        setStatusMessage(`Sign in failed: ${error.message}`)
      } else {
        uiLog('info', 'Sign in completed successfully')
      }
    } catch (err) {
      uiLog('error', 'Sign in exception', { error: String(err) })
      setStatusMessage('Sign in failed')
    } finally {
      uiLog('info', 'Sign in flow finished, resetting state')
      setIsSigningIn(false)
    }
  }

  const handleOfflineMode = () => {
    setOfflineMode(true)
  }

  const handleConnectVault = async (vault: Vault) => {
    uiLog('info', 'Connect vault clicked', { vaultName: vault.name, vaultId: vault.id })
    
    if (!window.electronAPI) {
      uiLog('error', 'electronAPI not available')
      return
    }
    
    setConnectingVaultId(vault.id)
    
    try {
      // Create vault folder based on platform
      const vaultPath = buildVaultPath(platform, vault.slug)
      uiLog('info', 'Creating working directory', { vaultPath, platform })
      
      const result = await window.electronAPI.createWorkingDir(vaultPath)
      uiLog('info', 'createWorkingDir result', { success: result.success, path: result.path, error: result.error })
      
      if (result.success && result.path) {
        // Add to connected vaults
        const connectedVault: ConnectedVault = {
          id: vault.id,
          name: vault.name,
          localPath: result.path,
          isExpanded: true
        }
        addConnectedVault(connectedVault)
        uiLog('info', 'Vault connected, opening', { vaultName: vault.name })
        
        // Open the vault
        onOpenRecentVault(result.path)
        addToast('success', `Connected to "${vault.name}"`)
      } else {
        uiLog('error', 'Failed to create vault folder', { error: result.error })
        addToast('error', result.error || 'Failed to create vault folder')
      }
    } catch (err) {
      uiLog('error', 'Exception connecting to vault', { error: String(err) })
      addToast('error', 'Failed to connect to vault')
    } finally {
      setConnectingVaultId(null)
    }
  }

  const handleConnectLegacy = async () => {
    if (!window.electronAPI) return
    
    setIsConnectingVault(true)
    try {
      // Determine vault path
      let vaultPath: string
      
      if (recentVaults.length > 0) {
        vaultPath = recentVaults[0]
      } else if (organization) {
        vaultPath = buildVaultPath(platform, organization.slug)
      } else {
        vaultPath = buildVaultPath(platform, 'local-vault')
      }
      
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
      setIsConnectingVault(false)
    }
  }

  const isVaultConnected = (vaultId: string) => {
    return connectedVaults.some(v => v.id === vaultId)
  }

  // ============================================
  // CONNECTING SCREEN (shown after sign-in while loading organization)
  // ============================================
  if (isAuthConnecting) {
    return (
      <div className="flex-1 flex items-center justify-center bg-pdm-bg overflow-auto">
        <div className="max-w-md w-full p-8 text-center">
          <div className="flex justify-center items-center gap-3 mb-8">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-pdm-accent">
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
            <h1 className="text-3xl font-bold text-pdm-fg">BluePDM</h1>
          </div>
          
          <Loader2 size={40} className="animate-spin text-pdm-accent mx-auto mb-4" />
          <p className="text-pdm-fg-muted">Connecting to your organization...</p>
        </div>
      </div>
    )
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
            <div className="flex justify-center items-center gap-3 mb-4">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-pdm-accent">
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
              <h1 className="text-3xl font-bold text-pdm-fg">BluePDM</h1>
            </div>
            <p className="text-pdm-fg-dim">
              Open source Product Data Management for engineering teams
            </p>
          </div>

          {/* Sign In Options */}
          <div className="space-y-4">
            <button
              onClick={handleSignIn}
              disabled={isSigningIn || !isSupabaseConfigured()}
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

          {/* Footer */}
          <div className="text-center mt-12 text-xs text-pdm-fg-muted">
            Made with 💙 by Blue Robotics
          </div>
        </div>
      </div>
    )
  }

  // ============================================
  // VAULT CONNECTION SCREEN (shown when authenticated or offline)
  // ============================================
  return (
    <div className="flex-1 flex items-center justify-center bg-pdm-bg overflow-auto">
      <div className="max-w-lg w-full p-8">
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <div className="flex justify-center items-center gap-3 mb-4">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-pdm-accent">
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
            <h1 className="text-2xl font-bold text-pdm-fg">BluePDM</h1>
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

        {/* Organization Vaults */}
        {!isOfflineMode && organization && orgVaults.length > 0 && (
          <div className="mb-6">
            <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-3 flex items-center gap-2">
              <Database size={14} />
              Organization Vaults
            </div>
            
            <div className="space-y-2">
              {orgVaults.map(vault => {
                const connected = isVaultConnected(vault.id)
                const isConnectingThis = connectingVaultId === vault.id
                
                return (
                  <div 
                    key={vault.id}
                    className={`bg-pdm-bg-light border rounded-xl p-4 transition-colors ${
                      connected ? 'border-pdm-accent' : 'border-pdm-border hover:border-pdm-border-light'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        connected ? 'bg-pdm-accent/20' : 'bg-pdm-bg'
                      }`}>
                        <HardDrive size={20} className={connected ? 'text-pdm-accent' : 'text-pdm-fg-muted'} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-pdm-fg truncate">
                            {vault.name}
                          </h3>
                          {vault.is_default && (
                            <span className="px-1.5 py-0.5 bg-pdm-accent/20 text-pdm-accent text-[10px] rounded">
                              Default
                            </span>
                          )}
                          {connected && (
                            <Check size={14} className="text-pdm-success" />
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-pdm-fg-muted">
                          {vault.stats && (
                            <>
                              <span>{vault.stats.fileCount} file{vault.stats.fileCount !== 1 ? 's' : ''}</span>
                              <span>•</span>
                              <span>{formatSize(vault.stats.totalSize)}</span>
                            </>
                          )}
                          {vault.description && (
                            <>
                              {vault.stats && <span>•</span>}
                              <span className="truncate">{vault.description}</span>
                            </>
                          )}
                        </div>
                      </div>
                      
                      {connected ? (
                        <button
                          onClick={() => {
                            const cv = connectedVaults.find(v => v.id === vault.id)
                            if (cv) onOpenRecentVault(cv.localPath)
                          }}
                          className="btn btn-primary btn-sm gap-1"
                        >
                          <FolderPlus size={14} />
                          Open
                        </button>
                      ) : (
                        <button
                          onClick={() => handleConnectVault(vault)}
                          disabled={isConnectingThis}
                          className="btn btn-secondary btn-sm gap-1"
                        >
                          {isConnectingThis ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Link size={14} />
                          )}
                          Connect
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        
        {/* No vaults message */}
        {!isOfflineMode && organization && orgVaults.length === 0 && !isLoadingVaults && (
          <div className="mb-6 p-6 bg-pdm-bg-light border border-pdm-border rounded-xl text-center">
            <Database size={32} className="text-pdm-fg-muted mx-auto mb-3" />
            <h3 className="font-medium text-pdm-fg mb-1">No Vaults Created</h3>
            <p className="text-sm text-pdm-fg-muted mb-4">
              {user?.role === 'admin' 
                ? 'Create a vault in Settings → Organization to get started.'
                : 'Ask an organization admin to create a vault.'}
            </p>
            {user?.role === 'admin' && (
              <p className="text-xs text-pdm-fg-dim">
                Or use the advanced options below to connect manually.
              </p>
            )}
          </div>
        )}
        
        {/* Loading vaults */}
        {isLoadingVaults && (
          <div className="mb-6 p-6 bg-pdm-bg-light border border-pdm-border rounded-xl flex items-center justify-center">
            <Loader2 size={24} className="animate-spin text-pdm-fg-muted" />
          </div>
        )}

        {/* Offline mode - legacy vault connection */}
        {isOfflineMode && (
          <div className="bg-pdm-bg-light border border-pdm-border rounded-xl p-6 mb-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-xl bg-pdm-warning/20 flex items-center justify-center flex-shrink-0">
                <HardDrive size={24} className="text-pdm-warning" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold text-pdm-fg truncate">
                  Local Vault
                </h2>
                <p className="text-xs text-pdm-fg-muted truncate">
                  {recentVaults[0] || buildVaultPath(platform, 'local-vault')}
                </p>
              </div>
            </div>

            <button
              onClick={handleConnectLegacy}
              disabled={isConnectingVault}
              className="w-full btn btn-primary btn-lg gap-2 justify-center"
            >
              {isConnectingVault ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <FolderPlus size={20} />
              )}
              Connect
            </button>
          </div>
        )}

        {/* Settings Button */}
        <div className="mb-6">
          <button
            onClick={() => setShowSettingsModal(true)}
            className="w-full btn btn-secondary gap-2 justify-center py-3"
          >
            <Settings size={18} />
            Settings
          </button>
        </div>

        {/* Footer */}
        <div className="text-center mt-6 text-xs text-pdm-fg-muted">
          Made with 💙 by Blue Robotics
        </div>
      </div>
      
      {/* Settings Modal */}
      {showSettingsModal && (
        <SettingsModal onClose={() => setShowSettingsModal(false)} />
      )}
    </div>
  )
}
