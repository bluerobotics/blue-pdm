import { useState, useEffect, useRef } from 'react'
import { FolderPlus, Loader2, HardDrive, WifiOff, LogIn, Check, Database, Link, User, Truck, Mail, Phone, ArrowLeft, Eye, EyeOff, RotateCw, X, AlertTriangle, LogOut, Trash2 } from 'lucide-react'
import { usePDMStore, ConnectedVault } from '../stores/pdmStore'
import { signInWithGoogle, signInWithEmail, signUpWithEmail, signInWithPhone, verifyPhoneOTP, isSupabaseConfigured, supabase, getAccessibleVaults } from '../lib/supabase'
import { getInitials } from '../types/pdm'
import { logClick, logAuth } from '../lib/userActionLogger'
import { LogViewer } from './LogViewer'
import { LanguageSelector } from './LanguageSelector'
import { useTranslation } from '../lib/i18n'
import type { AccountType } from '../types/database'

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
    // macOS: ~/Documents/BluePLM/vault-name
    return `~/Documents/BluePLM/${vaultSlug}`
  } else if (platform === 'linux') {
    return `~/BluePLM/${vaultSlug}`
  } else {
    // Windows: C:\BluePLM\vault-name
    return `C:\\BluePLM\\${vaultSlug}`
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
  onChangeOrg?: () => void
}

// Format bytes to human-readable size
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export function WelcomeScreen({ onOpenRecentVault, onChangeOrg }: WelcomeScreenProps) {
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
    isConnecting: isAuthConnecting,  // Global auth connecting state
    getEffectiveRole
  } = usePDMStore()
  const { t } = useTranslation()
  const isAdmin = getEffectiveRole() === 'admin'
  
  const [isConnectingVault, setIsConnectingVault] = useState(false)  // Local vault connection state
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [showLogsModal, setShowLogsModal] = useState(false)
  const signInTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const signInAbortControllerRef = useRef<AbortController | null>(null)
  
  // Account type selection state
  const [accountType, setAccountType] = useState<AccountType | null>(null)
  
  // Auth state (shared between supplier and team member email/phone auth)
  const [authMethod, setAuthMethod] = useState<'google' | 'email' | 'phone'>('google')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState('')
  const [authPhone, setAuthPhone] = useState('')
  const [phoneOtp, setPhoneOtp] = useState('')
  const [isOtpSent, setIsOtpSent] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false)
  const [isNewAccount, setIsNewAccount] = useState(false)
  const [authName, setAuthName] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
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
  // Also re-run when vault ID changes (e.g., after stale vault cleanup and reconnection)
  const firstVaultId = connectedVaults[0]?.id
  useEffect(() => {
    if (connectedVaults.length > 0 && (user || isOfflineMode)) {
      uiLog('info', 'Auto-connecting to vault', { vaultName: connectedVaults[0].name, vaultId: connectedVaults[0].id })
      // Auto-connect to first connected vault
      const vault = connectedVaults[0]
      onOpenRecentVault(vault.localPath)
    }
  }, [user, isOfflineMode, connectedVaults.length, firstVaultId])

  // Load organization vaults with stats
  useEffect(() => {
    const loadOrgVaults = async () => {
      if (!organization?.id || !user?.id) {
        uiLog('debug', 'No organization ID or user ID, skipping vault load')
        return
      }
      
      uiLog('info', 'Loading accessible vaults for user', { orgId: organization.id, orgName: organization.name, userId: user.id, role: user.role })
      setIsLoadingVaults(true)
      try {
        // Load vaults filtered by user's access permissions
        const { vaults: vaultsData, error: vaultsError } = await getAccessibleVaults(
          user.id,
          organization.id,
          getEffectiveRole()
        )
        
        uiLog('info', 'Accessible vaults query result', { 
          count: vaultsData?.length || 0, 
          error: vaultsError
        })
        
        if (vaultsError || !vaultsData) {
          uiLog('error', 'Error loading accessible vaults', { error: vaultsError })
          return
        }
        
        // Load stats for each vault (with pagination to handle >1000 files)
        const vaultsWithStats = await Promise.all(
          (vaultsData as any[]).map(async (vault: any) => {
            // Fetch file count and total size using pagination (Supabase default limit is 1000)
            const PAGE_SIZE = 1000
            let allFileSizes: number[] = []
            let offset = 0
            let hasMore = true
            
            while (hasMore) {
              const { data: statsData } = await supabase
                .from('files')
                .select('file_size')
                .eq('vault_id', vault.id)
                .is('deleted_at', null)  // Exclude soft-deleted files
                .range(offset, offset + PAGE_SIZE - 1)
              
              if (statsData && statsData.length > 0) {
                allFileSizes.push(...statsData.map((f: any) => f.file_size || 0))
                offset += statsData.length
                hasMore = statsData.length === PAGE_SIZE
              } else {
                hasMore = false
              }
            }
            
            const stats: VaultStats = {
              fileCount: allFileSizes.length,
              totalSize: allFileSizes.reduce((acc, size) => acc + size, 0)
            }
            
            return { ...vault, stats } as Vault
          })
        )
        
        setOrgVaults(vaultsWithStats)
        
        // Clean up stale connected vaults that no longer exist on server
        const serverVaultIds = new Set(vaultsData.map((v: any) => v.id))
        const staleVaults = connectedVaults.filter(cv => !serverVaultIds.has(cv.id))
        const staleVaultIds = new Set(staleVaults.map(v => v.id))
        const staleVaultPaths = new Set(staleVaults.map(v => v.localPath.toLowerCase().replace(/\\/g, '/')))
        
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
        
        // Detect orphaned vault folders: folders that exist on disk but aren't in connectedVaults
        // This handles the case where user reinstalls the app and already has vault folders
        // NOTE: We exclude stale vault paths since those are being removed (state update is async)
        if (window.electronAPI) {
          const connectedPaths = new Set(
            connectedVaults
              .filter(cv => !staleVaultIds.has(cv.id)) // Exclude stale vaults being removed
              .map(cv => cv.localPath.toLowerCase().replace(/\\/g, '/'))
          )
          
          for (const serverVault of vaultsData as any[]) {
            // Check if this server vault is already connected (with correct ID)
            const isConnected = connectedVaults.some(cv => cv.id === serverVault.id)
            if (isConnected) continue
            
            // Check if the expected folder path already exists on disk
            const expectedPath = buildVaultPath(platform, serverVault.slug)
            try {
              const result = await window.electronAPI.setWorkingDir(expectedPath)
              if (result.success && result.path) {
                const normalizedPath = result.path.toLowerCase().replace(/\\/g, '/')
                
                // Check if this path isn't already connected under a different valid vault ID
                // Note: stale vault paths are excluded from connectedPaths, so we can reconnect
                // folders that were connected with an old/stale vault ID
                if (!connectedPaths.has(normalizedPath)) {
                  // Check if this was a stale vault path - if so, this is a reconnection after upgrade
                  const wasStale = staleVaultPaths.has(normalizedPath)
                  uiLog('info', wasStale ? 'Reconnecting vault after upgrade' : 'Found orphaned vault folder, auto-reconnecting', { 
                    vaultName: serverVault.name, 
                    vaultId: serverVault.id,
                    path: result.path,
                    wasStaleConnection: wasStale
                  })
                  
                  // Auto-reconnect the vault with correct server ID
                  const connectedVault: ConnectedVault = {
                    id: serverVault.id,
                    name: serverVault.name,
                    localPath: result.path,
                    isExpanded: true
                  }
                  addConnectedVault(connectedVault)
                  addToast('info', wasStale 
                    ? `Reconnected vault "${serverVault.name}" after upgrade`
                    : `Reconnected existing vault folder "${serverVault.name}"`)
                }
              }
            } catch {
              // Folder doesn't exist, that's fine
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
  }, [organization?.id, user?.id, vaultsRefreshKey, platform]) // Refresh when vaultsRefreshKey changes or user changes

  const cancelSignIn = () => {
    uiLog('info', 'Sign in canceled by user')
    if (signInTimeoutRef.current) {
      clearTimeout(signInTimeoutRef.current)
      signInTimeoutRef.current = null
    }
    if (signInAbortControllerRef.current) {
      signInAbortControllerRef.current.abort()
      signInAbortControllerRef.current = null
    }
    setIsSigningIn(false)
    setAuthError('Sign in was canceled')
  }

  const handleSignIn = async () => {
    logAuth('Sign in with Google clicked')
    uiLog('info', 'Sign in button clicked')
    
    if (!isSupabaseConfigured()) {
      uiLog('warn', 'Supabase not configured')
      setStatusMessage('Supabase not configured')
      return
    }
    
    // Clear any previous errors
    setAuthError(null)
    setIsSigningIn(true)
    uiLog('info', 'Starting Google sign-in flow')
    
    // Create abort controller for cancellation
    signInAbortControllerRef.current = new AbortController()
    
    // Set timeout to prevent infinite hanging (30 seconds)
    signInTimeoutRef.current = setTimeout(() => {
      uiLog('warn', 'Sign in timeout after 30 seconds')
      if (signInAbortControllerRef.current) {
        signInAbortControllerRef.current.abort()
      }
      setIsSigningIn(false)
      setAuthError('Sign in timed out. Please check your internet connection and try again.')
      signInTimeoutRef.current = null
    }, 30000)
    
    try {
      const { data, error } = await signInWithGoogle()
      
      // Clear timeout if sign-in completes
      if (signInTimeoutRef.current) {
        clearTimeout(signInTimeoutRef.current)
        signInTimeoutRef.current = null
      }
      
      uiLog('info', 'signInWithGoogle returned', { 
        hasData: !!data, 
        hasError: !!error,
        errorMessage: error?.message 
      })
      
      if (error) {
        uiLog('error', 'Sign in failed', { error: error.message })
        const errorMsg = error.message || 'Sign in failed'
        setAuthError(errorMsg)
        setStatusMessage(`Sign in failed: ${errorMsg}`)
      } else {
        uiLog('info', 'Sign in completed successfully')
      }
    } catch (err) {
      // Clear timeout on error
      if (signInTimeoutRef.current) {
        clearTimeout(signInTimeoutRef.current)
        signInTimeoutRef.current = null
      }
      
      uiLog('error', 'Sign in exception', { error: String(err) })
      const errorMsg = err instanceof Error ? err.message : 'Sign in failed'
      setAuthError(errorMsg)
      setStatusMessage('Sign in failed')
    } finally {
      uiLog('info', 'Sign in flow finished, resetting state')
      setIsSigningIn(false)
      signInAbortControllerRef.current = null
    }
  }

  // Email/password sign-in (for both suppliers and team members)
  const handleEmailAuth = async () => {
    if (!authEmail || !authPassword) {
      setAuthError('Please enter email and password')
      return
    }
    
    // Validate password confirmation for new accounts
    if (isNewAccount && authPassword !== authPasswordConfirm) {
      setAuthError(t('welcome.passwordMismatch'))
      return
    }
    
    setIsSigningIn(true)
    setAuthError(null)
    
    try {
      if (isNewAccount) {
        // Sign up
        uiLog('info', 'Starting email sign-up', { accountType })
        const { data, error } = await signUpWithEmail(authEmail, authPassword, authName || undefined)
        
        if (error) {
          setAuthError(error.message)
          return
        }
        
        if (!data?.session) {
          // Email confirmation needed
          setAuthError('Please check your email to confirm your account')
          setIsNewAccount(false)  // Switch back to login view
          return
        }
        
        uiLog('info', 'Email sign-up successful')
      } else {
        // Sign in
        uiLog('info', 'Starting email sign-in', { accountType })
        const { error } = await signInWithEmail(authEmail, authPassword)
        
        if (error) {
          setAuthError(error.message)
          return
        }
        
        uiLog('info', 'Email sign-in successful')
      }
    } catch (err) {
      setAuthError('Authentication failed. Please try again.')
    } finally {
      setIsSigningIn(false)
    }
  }

  // Phone OTP sign-in (for both suppliers and team members)
  const handleSendPhoneOTP = async () => {
    if (!authPhone) {
      setAuthError('Please enter your phone number')
      return
    }
    
    setIsSigningIn(true)
    setAuthError(null)
    
    try {
      uiLog('info', 'Sending phone OTP', { accountType })
      const { error } = await signInWithPhone(authPhone)
      
      if (error) {
        setAuthError(error.message)
        return
      }
      
      setIsOtpSent(true)
      uiLog('info', 'Phone OTP sent successfully')
    } catch (err) {
      setAuthError('Failed to send verification code. Please try again.')
    } finally {
      setIsSigningIn(false)
    }
  }

  const handleVerifyPhoneOTP = async () => {
    if (!phoneOtp) {
      setAuthError('Please enter the verification code')
      return
    }
    
    setIsSigningIn(true)
    setAuthError(null)
    
    try {
      uiLog('info', 'Verifying phone OTP', { accountType })
      const { error } = await verifyPhoneOTP(authPhone, phoneOtp)
      
      if (error) {
        setAuthError(error.message)
        return
      }
      
      uiLog('info', 'Phone verification successful')
    } catch (err) {
      setAuthError('Verification failed. Please try again.')
    } finally {
      setIsSigningIn(false)
    }
  }

  // Reset auth state
  const resetAuth = () => {
    setAuthMethod('google')
    setAuthEmail('')
    setAuthPassword('')
    setAuthPasswordConfirm('')
    setAuthPhone('')
    setPhoneOtp('')
    setIsOtpSent(false)
    setIsNewAccount(false)
    setAuthName('')
    setAuthError(null)
  }

  // Clear all saved data and start fresh
  const handleStartFresh = async () => {
    uiLog('info', 'Clearing all saved data for fresh start')
    
    // Sign out if there's any session
    try {
      const { signOut: supabaseSignOut } = await import('../lib/supabase')
      await supabaseSignOut()
    } catch (err) {
      uiLog('warn', 'Error signing out during fresh start', { error: String(err) })
    }
    
    // Clear connected vaults
    setConnectedVaults([])
    
    // Reset local auth state
    resetAuth()
    setAccountType(null)
    
    addToast('info', t('welcome.dataCleared', 'Saved data cleared'))
  }

  const handleOfflineMode = () => {
    setOfflineMode(true)
  }

  const handleConnectVault = async (vault: Vault) => {
    logClick('Connect vault button', { vaultName: vault.name, vaultId: vault.id })
    uiLog('info', 'Connect vault clicked', { vaultName: vault.name, vaultId: vault.id })
    
    if (!window.electronAPI) {
      uiLog('error', 'electronAPI not available')
      return
    }
    
    setConnectingVaultId(vault.id)
    
    try {
      // Build expected vault folder path based on platform
      const vaultPath = buildVaultPath(platform, vault.slug)
      uiLog('info', 'Checking vault path', { vaultPath, platform })
      
      // Check if this vault ID is already connected (by ID)
      const existingById = connectedVaults.find(v => v.id === vault.id)
      if (existingById) {
        uiLog('info', 'Vault already connected by ID, opening', { vaultName: vault.name, path: existingById.localPath })
        onOpenRecentVault(existingById.localPath)
        return
      }
      
      // Check if a vault is already connected with the same local path
      // (handles case where vault ID changed but folder is the same)
      const result = await window.electronAPI.createWorkingDir(vaultPath)
      if (result.success && result.path) {
        const normalizedNewPath = result.path.toLowerCase().replace(/\\/g, '/')
        const existingByPath = connectedVaults.find(v => 
          v.localPath.toLowerCase().replace(/\\/g, '/') === normalizedNewPath
        )
        
        if (existingByPath) {
          uiLog('info', 'Vault already connected by path, updating ID and opening', { 
            vaultName: vault.name, 
            oldId: existingByPath.id, 
            newId: vault.id 
          })
          // Update the existing vault entry with the correct ID from server
          removeConnectedVault(existingByPath.id)
          const updatedVault: ConnectedVault = {
            id: vault.id,
            name: vault.name,
            localPath: result.path,
            isExpanded: true
          }
          addConnectedVault(updatedVault)
          onOpenRecentVault(result.path)
          addToast('success', `Reconnected to "${vault.name}"`)
          return
        }
        
        // No existing connection - add new one
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
    logClick('Connect legacy vault button')
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
    const handleCancelConnecting = async () => {
      uiLog('info', 'User cancelled connecting - signing out')
      const { signOut: supabaseSignOut } = await import('../lib/supabase')
      await supabaseSignOut()
    }
    
    return (
      <div className="flex-1 flex items-center justify-center bg-plm-bg overflow-auto">
        <div className="max-w-md w-full p-8 text-center">
          <div className="flex justify-center items-center gap-3 mb-8">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-plm-accent">
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
            <h1 className="text-3xl font-bold text-plm-fg">{t('welcome.title')}</h1>
          </div>
          
          <Loader2 size={40} className="animate-spin text-plm-accent mx-auto mb-4" />
          <p className="text-plm-fg-muted">{t('welcome.connectingToOrg')}</p>
          
          {/* Cancel button - allows users to escape if connection hangs */}
          <button
            onClick={handleCancelConnecting}
            className="mt-6 text-sm text-plm-fg-muted hover:text-plm-fg transition-colors underline"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    )
  }

  // ============================================
  // SIGN IN SCREEN (shown when not authenticated)
  // ============================================
  if (!user && !isOfflineMode) {
    return (
      <div className="flex-1 flex items-center justify-center bg-plm-bg overflow-auto relative">
        {/* Language selector in corner */}
        <div className="absolute top-4 right-4">
          <LanguageSelector compact dropdownPosition="bottom-right" />
        </div>
        
        <div className="max-w-md w-full p-8">
          {/* Logo and Title */}
          <div className="text-center mb-10">
            <div className="flex justify-center items-center gap-3 mb-4">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-plm-accent">
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
              <h1 className="text-3xl font-bold text-plm-fg">{t('welcome.title')}</h1>
            </div>
            <p className="text-plm-fg-dim">
              {t('welcome.tagline')}
            </p>
          </div>

          {/* ============================================ */}
          {/* STEP 1: Account Type Selection */}
          {/* ============================================ */}
          {!accountType && (
            <div className="space-y-4">
              <p className="text-center text-sm text-plm-fg-muted mb-6">
                {t('welcome.selectAccountType')}
              </p>
              
              <button
                onClick={() => { 
                  logClick('Account type: User selected')
                  setAccountType('user')
                  setAuthMethod('google') 
                }}
                className="w-full bg-plm-bg-light border-2 border-plm-border hover:border-plm-accent rounded-xl p-6 transition-colors group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-plm-accent/20 flex items-center justify-center group-hover:bg-plm-accent/30 transition-colors">
                    <User size={28} className="text-plm-accent" />
                  </div>
                  <div className="text-left flex-1">
                    <h3 className="font-semibold text-plm-fg text-lg">{t('welcome.teamMember')}</h3>
                    <p className="text-sm text-plm-fg-muted">
                      {t('welcome.teamMemberDesc')}
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => { 
                  logClick('Account type: Supplier selected')
                  setAccountType('supplier')
                  setAuthMethod('email') 
                }}
                className="w-full bg-plm-bg-light border-2 border-plm-border hover:border-amber-500 rounded-xl p-6 transition-colors group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-amber-500/20 flex items-center justify-center group-hover:bg-amber-500/30 transition-colors">
                    <Truck size={28} className="text-amber-500" />
                  </div>
                  <div className="text-left flex-1">
                    <h3 className="font-semibold text-plm-fg text-lg">{t('welcome.supplier')}</h3>
                    <p className="text-sm text-plm-fg-muted">
                      {t('welcome.supplierDesc')}
                    </p>
                  </div>
                </div>
              </button>

              {/* Start Fresh option - clears saved session/org data */}
              {connectedVaults.length > 0 && (
                <div className="pt-4 border-t border-plm-border mt-4">
                  <button
                    onClick={handleStartFresh}
                    className="w-full flex items-center justify-center gap-2 text-sm text-plm-fg-muted hover:text-plm-fg transition-colors py-2"
                  >
                    <Trash2 size={14} />
                    {t('welcome.startFresh', 'Clear saved data & start fresh')}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ============================================ */}
          {/* STEP 2a: User Sign In (Google OAuth or Email/Phone) */}
          {/* ============================================ */}
          {accountType === 'user' && (
            <div className="space-y-4">
              <button
                onClick={() => { setAccountType(null); resetAuth() }}
                className="flex items-center gap-2 text-sm text-plm-fg-muted hover:text-plm-fg transition-colors mb-4"
              >
                <ArrowLeft size={16} />
                {t('common.back')}
              </button>

              <div className="text-center mb-6">
                <div className="w-12 h-12 rounded-xl bg-plm-accent/20 flex items-center justify-center mx-auto mb-3">
                  <User size={24} className="text-plm-accent" />
                </div>
                <h2 className="text-xl font-semibold text-plm-fg">{t('welcome.teamSignIn')}</h2>
                <p className="text-sm text-plm-fg-muted mt-1">
                  {isNewAccount ? t('welcome.createAccount') : t('welcome.signInWithOrg')}
                </p>
              </div>

              {/* Google OAuth (default) */}
              {authMethod === 'google' && (
                <>
                  {/* Error message for Google sign-in */}
                  {authError && !isSigningIn && (
                    <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                      <div className="flex items-start gap-2">
                        <X size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm text-red-400">{authError}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={handleSignIn}
                      disabled={isSigningIn || !isSupabaseConfigured()}
                      className="flex-1 btn btn-primary btn-lg gap-3 justify-center py-4"
                    >
                      {isSigningIn ? (
                        <Loader2 size={20} className="animate-spin" />
                      ) : authError ? (
                        <RotateCw size={20} />
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                      )}
                      {isSigningIn ? t('welcome.connecting') : authError ? t('welcome.tryAgain') : t('welcome.signInWithGoogle')}
                    </button>
                    
                    {/* Cancel button when signing in */}
                    {isSigningIn && (
                      <button
                        onClick={cancelSignIn}
                        className="px-4 btn btn-secondary"
                        title={t('common.cancel')}
                      >
                        <X size={20} />
                      </button>
                    )}
                  </div>

                  <div className="relative my-4">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-plm-border"></div>
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className="px-2 bg-plm-bg text-plm-fg-muted">{t('common.or')}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => setAuthMethod('email')}
                    className="w-full btn btn-secondary gap-3 justify-center py-3"
                  >
                    <Mail size={18} />
                    {t('welcome.useEmailPassword')}
                  </button>
                </>
              )}

              {/* Email/Phone Auth */}
              {authMethod !== 'google' && (
                <>
                  {/* Auth Method Tabs */}
                  <div className="flex rounded-lg bg-plm-bg-light p-1 mb-4">
                    <button
                      onClick={() => { setAuthMethod('email'); setIsOtpSent(false) }}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                        authMethod === 'email' 
                          ? 'bg-plm-bg text-plm-fg shadow-sm' 
                          : 'text-plm-fg-muted hover:text-plm-fg'
                      }`}
                    >
                      <Mail size={16} />
                      {t('welcome.email')}
                    </button>
                    <button
                      onClick={() => { setAuthMethod('phone'); setIsNewAccount(false) }}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                        authMethod === 'phone' 
                          ? 'bg-plm-bg text-plm-fg shadow-sm' 
                          : 'text-plm-fg-muted hover:text-plm-fg'
                      }`}
                    >
                      <Phone size={16} />
                      {t('welcome.phone')}
                    </button>
                  </div>

                  {/* Error Message */}
                  {authError && (
                    <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                      <p className="text-sm text-red-400">{authError}</p>
                    </div>
                  )}

                  {/* Email Auth Form */}
                  {authMethod === 'email' && (
                    <div className="space-y-4">
                      {isNewAccount && (
                        <div>
                          <label className="block text-sm font-medium text-plm-fg-muted mb-1.5">
                            {t('welcome.fullName')}
                          </label>
                          <input
                            type="text"
                            value={authName}
                            onChange={(e) => setAuthName(e.target.value)}
                            placeholder="Your name"
                            className="w-full px-4 py-3 bg-plm-bg-light border border-plm-border rounded-lg text-plm-fg placeholder-plm-fg-muted focus:outline-none focus:border-plm-accent transition-colors"
                          />
                        </div>
                      )}
                      
                      <div>
                        <label className="block text-sm font-medium text-plm-fg-muted mb-1.5">
                          {t('welcome.email')}
                        </label>
                        <input
                          type="email"
                          value={authEmail}
                          onChange={(e) => setAuthEmail(e.target.value)}
                          placeholder="you@company.com"
                          className="w-full px-4 py-3 bg-plm-bg-light border border-plm-border rounded-lg text-plm-fg placeholder-plm-fg-muted focus:outline-none focus:border-plm-accent transition-colors"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-plm-fg-muted mb-1.5">
                          {t('welcome.password')}
                        </label>
                        <div className="relative">
                          <input
                            type={showPassword ? 'text' : 'password'}
                            value={authPassword}
                            onChange={(e) => setAuthPassword(e.target.value)}
                            placeholder="••••••••"
                            className="w-full px-4 py-3 pr-12 bg-plm-bg-light border border-plm-border rounded-lg text-plm-fg placeholder-plm-fg-muted focus:outline-none focus:border-plm-accent transition-colors"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg transition-colors"
                          >
                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                          </button>
                        </div>
                      </div>

                      {/* Password Confirmation for new accounts */}
                      {isNewAccount && (
                        <div>
                          <label className="block text-sm font-medium text-plm-fg-muted mb-1.5">
                            {t('welcome.confirmPassword')}
                          </label>
                          <div className="relative">
                            <input
                              type={showPasswordConfirm ? 'text' : 'password'}
                              value={authPasswordConfirm}
                              onChange={(e) => setAuthPasswordConfirm(e.target.value)}
                              placeholder="••••••••"
                              className={`w-full px-4 py-3 pr-12 bg-plm-bg-light border rounded-lg text-plm-fg placeholder-plm-fg-muted focus:outline-none transition-colors ${
                                authPasswordConfirm && authPassword !== authPasswordConfirm 
                                  ? 'border-red-500 focus:border-red-500' 
                                  : 'border-plm-border focus:border-plm-accent'
                              }`}
                            />
                            <button
                              type="button"
                              onClick={() => setShowPasswordConfirm(!showPasswordConfirm)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg transition-colors"
                            >
                              {showPasswordConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                          </div>
                          {authPasswordConfirm && authPassword !== authPasswordConfirm && (
                            <p className="text-xs text-red-400 mt-1">{t('welcome.passwordMismatch')}</p>
                          )}
                        </div>
                      )}

                      <button
                        onClick={handleEmailAuth}
                        disabled={isSigningIn || (isNewAccount && authPassword !== authPasswordConfirm)}
                        className="w-full py-3 bg-plm-accent hover:bg-plm-accent-hover disabled:bg-plm-accent/50 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                      >
                        {isSigningIn ? (
                          <Loader2 size={20} className="animate-spin" />
                        ) : (
                          <LogIn size={20} />
                        )}
                        {isNewAccount ? t('welcome.createAccountBtn') : t('welcome.signIn')}
                      </button>

                      <div className="text-center">
                        <button
                          onClick={() => { setIsNewAccount(!isNewAccount); setAuthError(null); setAuthPasswordConfirm('') }}
                          className="text-sm text-plm-fg-muted hover:text-plm-fg transition-colors"
                        >
                          {isNewAccount 
                            ? t('welcome.alreadyHaveAccount') 
                            : t('welcome.noAccount')}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Phone Auth Form */}
                  {authMethod === 'phone' && (
                    <div className="space-y-4">
                      {!isOtpSent ? (
                        <>
                          <div>
                            <label className="block text-sm font-medium text-plm-fg-muted mb-1.5">
                              {t('welcome.phoneNumber')}
                            </label>
                            <input
                              type="tel"
                              value={authPhone}
                              onChange={(e) => setAuthPhone(e.target.value)}
                              placeholder="+1 555 000 0000"
                              className="w-full px-4 py-3 bg-plm-bg-light border border-plm-border rounded-lg text-plm-fg placeholder-plm-fg-muted focus:outline-none focus:border-plm-accent transition-colors"
                            />
                            <p className="text-xs text-plm-fg-muted mt-1.5">
                              {t('welcome.includeCountryCode')}
                            </p>
                          </div>

                          <button
                            onClick={handleSendPhoneOTP}
                            disabled={isSigningIn}
                            className="w-full py-3 bg-plm-accent hover:bg-plm-accent-hover disabled:bg-plm-accent/50 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                          >
                            {isSigningIn ? (
                              <Loader2 size={20} className="animate-spin" />
                            ) : (
                              <Phone size={20} />
                            )}
                            {t('welcome.sendVerificationCode')}
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="text-center text-sm text-plm-fg-muted mb-4">
                            {t('welcome.verificationSent')} <span className="text-plm-fg font-medium">{authPhone}</span>
                          </div>
                          
                          <div>
                            <label className="block text-sm font-medium text-plm-fg-muted mb-1.5">
                              {t('welcome.verificationCode')}
                            </label>
                            <input
                              type="text"
                              value={phoneOtp}
                              onChange={(e) => setPhoneOtp(e.target.value)}
                              placeholder="123456"
                              maxLength={6}
                              className="w-full px-4 py-3 bg-plm-bg-light border border-plm-border rounded-lg text-plm-fg placeholder-plm-fg-muted focus:outline-none focus:border-plm-accent transition-colors text-center text-2xl tracking-widest"
                            />
                          </div>

                          <button
                            onClick={handleVerifyPhoneOTP}
                            disabled={isSigningIn}
                            className="w-full py-3 bg-plm-accent hover:bg-plm-accent-hover disabled:bg-plm-accent/50 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                          >
                            {isSigningIn ? (
                              <Loader2 size={20} className="animate-spin" />
                            ) : (
                              <Check size={20} />
                            )}
                            {t('welcome.verifyAndSignIn')}
                          </button>

                          <button
                            onClick={() => { setIsOtpSent(false); setPhoneOtp('') }}
                            className="w-full text-sm text-plm-fg-muted hover:text-plm-fg transition-colors"
                          >
                            {t('welcome.useDifferentNumber')}
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {/* Back to Google option */}
                  <div className="text-center pt-2">
                    <button
                      onClick={() => { setAuthMethod('google'); setAuthError(null) }}
                      className="text-sm text-plm-fg-muted hover:text-plm-fg transition-colors"
                    >
                      {t('welcome.useGoogleInstead')}
                    </button>
                  </div>
                </>
              )}

              <div className="text-center text-xs text-plm-fg-muted mt-4">
                {t('welcome.roleSetByOrg')}
              </div>

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-plm-border"></div>
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-2 bg-plm-bg text-plm-fg-muted">{t('common.or')}</span>
                </div>
              </div>

              <button
                onClick={handleOfflineMode}
                className="w-full btn btn-secondary gap-3 justify-center py-3"
              >
                <WifiOff size={18} />
                {t('welcome.workOffline')}
              </button>

              {/* Start Fresh option - clears saved session/org data */}
              {connectedVaults.length > 0 && (
                <button
                  onClick={handleStartFresh}
                  className="w-full flex items-center justify-center gap-2 text-sm text-plm-fg-muted hover:text-plm-fg transition-colors py-2 mt-2"
                >
                  <Trash2 size={14} />
                  {t('welcome.startFresh', 'Clear saved data & start fresh')}
                </button>
              )}
            </div>
          )}

          {/* ============================================ */}
          {/* STEP 2b: Supplier Sign In */}
          {/* ============================================ */}
          {accountType === 'supplier' && (
            <div className="space-y-4">
              <button
                onClick={() => { setAccountType(null); resetAuth() }}
                className="flex items-center gap-2 text-sm text-plm-fg-muted hover:text-plm-fg transition-colors mb-4"
              >
                <ArrowLeft size={16} />
                {t('common.back')}
              </button>

              <div className="text-center mb-6">
                <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center mx-auto mb-3">
                  <Truck size={24} className="text-amber-500" />
                </div>
                <h2 className="text-xl font-semibold text-plm-fg">{t('welcome.supplierPortal')}</h2>
                <p className="text-sm text-plm-fg-muted mt-1">
                  {isNewAccount ? t('welcome.createAccount') : t('welcome.signInToAccount')}
                </p>
              </div>

              {/* Auth Method Tabs */}
              <div className="flex rounded-lg bg-plm-bg-light p-1 mb-4">
                <button
                  onClick={() => { setAuthMethod('email'); setIsOtpSent(false) }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                    authMethod === 'email' 
                      ? 'bg-plm-bg text-plm-fg shadow-sm' 
                      : 'text-plm-fg-muted hover:text-plm-fg'
                  }`}
                >
                  <Mail size={16} />
                  {t('welcome.email')}
                </button>
                <button
                  onClick={() => { setAuthMethod('phone'); setIsNewAccount(false) }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                    authMethod === 'phone' 
                      ? 'bg-plm-bg text-plm-fg shadow-sm' 
                      : 'text-plm-fg-muted hover:text-plm-fg'
                  }`}
                >
                  <Phone size={16} />
                  {t('welcome.phone')}
                </button>
              </div>

              {/* Error Message */}
              {authError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <p className="text-sm text-red-400">{authError}</p>
                </div>
              )}

              {/* Email Auth Form */}
              {authMethod === 'email' && (
                <div className="space-y-4">
                  {isNewAccount && (
                    <div>
                      <label className="block text-sm font-medium text-plm-fg-muted mb-1.5">
                        {t('welcome.fullName')}
                      </label>
                      <input
                        type="text"
                        value={authName}
                        onChange={(e) => setAuthName(e.target.value)}
                        placeholder="Your name"
                        className="w-full px-4 py-3 bg-plm-bg-light border border-plm-border rounded-lg text-plm-fg placeholder-plm-fg-muted focus:outline-none focus:border-amber-500 transition-colors"
                      />
                    </div>
                  )}
                  
                  <div>
                    <label className="block text-sm font-medium text-plm-fg-muted mb-1.5">
                      {t('welcome.email')}
                    </label>
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      placeholder="you@company.com"
                      className="w-full px-4 py-3 bg-plm-bg-light border border-plm-border rounded-lg text-plm-fg placeholder-plm-fg-muted focus:outline-none focus:border-amber-500 transition-colors"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-plm-fg-muted mb-1.5">
                      {t('welcome.password')}
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={authPassword}
                        onChange={(e) => setAuthPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full px-4 py-3 pr-12 bg-plm-bg-light border border-plm-border rounded-lg text-plm-fg placeholder-plm-fg-muted focus:outline-none focus:border-amber-500 transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg transition-colors"
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  {/* Password Confirmation for new accounts */}
                  {isNewAccount && (
                    <div>
                      <label className="block text-sm font-medium text-plm-fg-muted mb-1.5">
                        {t('welcome.confirmPassword')}
                      </label>
                      <div className="relative">
                        <input
                          type={showPasswordConfirm ? 'text' : 'password'}
                          value={authPasswordConfirm}
                          onChange={(e) => setAuthPasswordConfirm(e.target.value)}
                          placeholder="••••••••"
                          className={`w-full px-4 py-3 pr-12 bg-plm-bg-light border rounded-lg text-plm-fg placeholder-plm-fg-muted focus:outline-none transition-colors ${
                            authPasswordConfirm && authPassword !== authPasswordConfirm 
                              ? 'border-red-500 focus:border-red-500' 
                              : 'border-plm-border focus:border-amber-500'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPasswordConfirm(!showPasswordConfirm)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg transition-colors"
                        >
                          {showPasswordConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                      {authPasswordConfirm && authPassword !== authPasswordConfirm && (
                        <p className="text-xs text-red-400 mt-1">{t('welcome.passwordMismatch')}</p>
                      )}
                    </div>
                  )}

                  <button
                    onClick={handleEmailAuth}
                    disabled={isSigningIn || (isNewAccount && authPassword !== authPasswordConfirm)}
                    className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/50 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    {isSigningIn ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : (
                      <LogIn size={20} />
                    )}
                    {isNewAccount ? t('welcome.createAccountBtn') : t('welcome.signIn')}
                  </button>

                  <div className="text-center">
                    <button
                      onClick={() => { setIsNewAccount(!isNewAccount); setAuthError(null); setAuthPasswordConfirm('') }}
                      className="text-sm text-plm-fg-muted hover:text-plm-fg transition-colors"
                    >
                      {isNewAccount 
                        ? t('welcome.alreadyHaveAccount') 
                        : t('welcome.noAccount')}
                    </button>
                  </div>
                </div>
              )}

              {/* Phone Auth Form */}
              {authMethod === 'phone' && (
                <div className="space-y-4">
                  {!isOtpSent ? (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-plm-fg-muted mb-1.5">
                          {t('welcome.phoneNumber')}
                        </label>
                        <input
                          type="tel"
                          value={authPhone}
                          onChange={(e) => setAuthPhone(e.target.value)}
                          placeholder="+86 138 0000 0000"
                          className="w-full px-4 py-3 bg-plm-bg-light border border-plm-border rounded-lg text-plm-fg placeholder-plm-fg-muted focus:outline-none focus:border-amber-500 transition-colors"
                        />
                        <p className="text-xs text-plm-fg-muted mt-1.5">
                          {t('welcome.includeCountryCode')}
                        </p>
                      </div>

                      <button
                        onClick={handleSendPhoneOTP}
                        disabled={isSigningIn}
                        className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/50 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                      >
                        {isSigningIn ? (
                          <Loader2 size={20} className="animate-spin" />
                        ) : (
                          <Phone size={20} />
                        )}
                        {t('welcome.sendVerificationCode')}
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="text-center text-sm text-plm-fg-muted mb-4">
                        {t('welcome.verificationSent')} <span className="text-plm-fg font-medium">{authPhone}</span>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-plm-fg-muted mb-1.5">
                          {t('welcome.verificationCode')}
                        </label>
                        <input
                          type="text"
                          value={phoneOtp}
                          onChange={(e) => setPhoneOtp(e.target.value)}
                          placeholder="123456"
                          maxLength={6}
                          className="w-full px-4 py-3 bg-plm-bg-light border border-plm-border rounded-lg text-plm-fg placeholder-plm-fg-muted focus:outline-none focus:border-amber-500 transition-colors text-center text-2xl tracking-widest"
                        />
                      </div>

                      <button
                        onClick={handleVerifyPhoneOTP}
                        disabled={isSigningIn}
                        className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/50 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                      >
                        {isSigningIn ? (
                          <Loader2 size={20} className="animate-spin" />
                        ) : (
                          <Check size={20} />
                        )}
                        {t('welcome.verifyAndSignIn')}
                      </button>

                      <button
                        onClick={() => { setIsOtpSent(false); setPhoneOtp('') }}
                        className="w-full text-sm text-plm-fg-muted hover:text-plm-fg transition-colors"
                      >
                        {t('welcome.useDifferentNumber')}
                      </button>
                    </>
                  )}
                </div>
              )}

              <div className="text-center text-xs text-plm-fg-muted mt-4 pt-4 border-t border-plm-border">
                {t('welcome.supplierInviteNote')}
              </div>

              {/* Start Fresh option - clears saved session/org data */}
              {connectedVaults.length > 0 && (
                <button
                  onClick={handleStartFresh}
                  className="w-full flex items-center justify-center gap-2 text-sm text-plm-fg-muted hover:text-plm-fg transition-colors py-2 mt-2"
                >
                  <Trash2 size={14} />
                  {t('welcome.startFresh', 'Clear saved data & start fresh')}
                </button>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="text-center mt-12 text-xs text-plm-fg-muted">
            {t('welcome.madeWith')}
          </div>
          
          {/* Change Organization link */}
          {onChangeOrg && (
            <div className="text-center mt-4">
              <button
                onClick={onChangeOrg}
                className="text-xs text-plm-fg-muted hover:text-plm-fg transition-colors underline"
              >
                {t('welcome.changeOrganization', 'Change Organization')}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ============================================
  // NO ORGANIZATION SCREEN (signed in but not linked to any org)
  // ============================================
  if (user && !organization && !isOfflineMode) {
    const handleSignOutAndRetry = async () => {
      uiLog('info', 'User signing out to retry with different account')
      const { signOut: supabaseSignOut } = await import('../lib/supabase')
      await supabaseSignOut()
    }

    return (
      <div className="flex-1 flex items-center justify-center bg-plm-bg overflow-auto">
        <div className="max-w-md w-full p-8">
          {/* Logo and Title */}
          <div className="text-center mb-8">
            <div className="flex justify-center items-center gap-3 mb-4">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-plm-warning">
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
              <h1 className="text-2xl font-bold text-plm-fg">{t('welcome.title')}</h1>
            </div>
          </div>

          {/* User Info */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-plm-bg-light border border-plm-border rounded-full mb-4">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" className="w-5 h-5 rounded-full" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-plm-accent flex items-center justify-center text-[10px] text-white font-semibold">
                  {getInitials(user.full_name || user.email)}
                </div>
              )}
              <span className="text-sm text-plm-fg-dim">
                {user.full_name || user.email}
              </span>
            </div>
          </div>

          {/* Warning Card */}
          <div className="bg-plm-warning/10 border border-plm-warning/30 rounded-xl p-6 mb-6">
            <div className="flex gap-4">
              <div className="flex-shrink-0">
                <AlertTriangle className="w-6 h-6 text-plm-warning" />
              </div>
              <div>
                <h3 className="text-plm-fg font-semibold mb-2">{t('welcome.noOrgTitle', 'No Organization Found')}</h3>
                <p className="text-sm text-plm-fg-muted">
                  {t('welcome.noOrgDesc', 'Your account isn\'t linked to any organization. This can happen if:')}
                </p>
                <ul className="text-sm text-plm-fg-muted mt-2 space-y-1 list-disc list-inside">
                  <li>{t('welcome.noOrgReason1', 'You haven\'t been invited yet')}</li>
                  <li>{t('welcome.noOrgReason2', 'You signed in with a different email than the invite')}</li>
                  <li>{t('welcome.noOrgReason3', 'The invite hasn\'t been processed yet')}</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-3">
            <button
              onClick={handleSignOutAndRetry}
              className="w-full py-3 bg-plm-accent hover:bg-plm-accent-hover text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <LogOut size={18} />
              {t('welcome.signOutAndRetry', 'Sign Out & Try Different Account')}
            </button>
            
            <button
              onClick={handleOfflineMode}
              className="w-full py-3 bg-plm-bg-light border border-plm-border hover:bg-plm-bg-light/80 text-plm-fg font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <WifiOff size={18} />
              {t('welcome.workOffline')}
            </button>
          </div>

          {/* Help Text */}
          <div className="mt-6 p-4 bg-plm-bg-light border border-plm-border rounded-lg">
            <p className="text-xs text-plm-fg-muted text-center">
              {t('welcome.noOrgHelp', 'If you were invited, please check your email for the invite link and make sure to sign in with the same email address that received the invitation. Contact your administrator if you need help.')}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ============================================
  // VAULT CONNECTION SCREEN (shown when authenticated or offline)
  // ============================================
  return (
    <div className="flex-1 flex items-center justify-center bg-plm-bg overflow-auto">
      <div className="max-w-lg w-full p-8">
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <div className="flex justify-center items-center gap-3 mb-4">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-plm-accent">
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
            <h1 className="text-2xl font-bold text-plm-fg">{t('welcome.title')}</h1>
          </div>
          
          {/* User & Org Info or Offline Badge */}
          {isOfflineMode ? (
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-plm-warning/10 border border-plm-warning/30 rounded-full">
              <WifiOff size={14} className="text-plm-warning" />
              <span className="text-sm text-plm-warning font-medium">{t('welcome.offlineMode')}</span>
            </div>
          ) : user && (
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-plm-bg-light border border-plm-border rounded-full">
              {user.avatar_url ? (
                <>
                  <img 
                    src={user.avatar_url} 
                    alt="" 
                    className="w-5 h-5 rounded-full"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.style.display = 'none'
                      target.nextElementSibling?.classList.remove('hidden')
                    }}
                  />
                  <div className="w-5 h-5 rounded-full bg-plm-accent flex items-center justify-center text-[10px] text-white font-semibold hidden">
                    {getInitials(user.full_name || user.email)}
                  </div>
                </>
              ) : (
                <div className="w-5 h-5 rounded-full bg-plm-accent flex items-center justify-center text-[10px] text-white font-semibold">
                  {getInitials(user.full_name || user.email)}
                </div>
              )}
              <span className="text-sm text-plm-fg-dim">
                {user.full_name || user.email}
              </span>
              {organization && (
                <>
                  <span className="text-plm-fg-muted">•</span>
                  <span className="text-sm text-plm-accent font-medium">
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
            <div className="text-xs text-plm-fg-muted uppercase tracking-wide mb-3 flex items-center gap-2">
              <Database size={14} />
              {t('welcome.organizationVaults')}
            </div>
            
            <div className="space-y-2">
              {orgVaults.map(vault => {
                const connected = isVaultConnected(vault.id)
                const isConnectingThis = connectingVaultId === vault.id
                
                return (
                  <div 
                    key={vault.id}
                    className={`bg-plm-bg-light border rounded-xl p-4 transition-colors ${
                      connected ? 'border-plm-accent' : 'border-plm-border hover:border-plm-border-light'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        connected ? 'bg-plm-accent/20' : 'bg-plm-bg'
                      }`}>
                        <HardDrive size={20} className={connected ? 'text-plm-accent' : 'text-plm-fg-muted'} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-plm-fg truncate">
                            {vault.name}
                          </h3>
                          {vault.is_default && (
                            <span className="px-1.5 py-0.5 bg-plm-accent/20 text-plm-accent text-[10px] rounded">
                              {t('common.default')}
                            </span>
                          )}
                          {connected && (
                            <Check size={14} className="text-plm-success" />
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-plm-fg-muted">
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
                          {t('common.open')}
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
                          {t('common.connect')}
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
          <div className="mb-6 p-6 bg-plm-bg-light border border-plm-border rounded-xl text-center">
            <Database size={32} className="text-plm-fg-muted mx-auto mb-3" />
            <h3 className="font-medium text-plm-fg mb-1">{t('welcome.noVaultsCreated')}</h3>
            <p className="text-sm text-plm-fg-muted mb-4">
              {isAdmin 
                ? t('welcome.noVaultsAdminMsg')
                : t('welcome.noVaultsUserMsg')}
            </p>
            {isAdmin && (
              <p className="text-xs text-plm-fg-dim">
                {t('welcome.advancedOptions')}
              </p>
            )}
          </div>
        )}
        
        {/* Loading vaults */}
        {isLoadingVaults && (
          <div className="mb-6 p-6 bg-plm-bg-light border border-plm-border rounded-xl flex items-center justify-center">
            <Loader2 size={24} className="animate-spin text-plm-fg-muted" />
          </div>
        )}

        {/* Offline mode - legacy vault connection */}
        {isOfflineMode && (
          <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 mb-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-xl bg-plm-warning/20 flex items-center justify-center flex-shrink-0">
                <HardDrive size={24} className="text-plm-warning" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold text-plm-fg truncate">
                  {t('welcome.localVault')}
                </h2>
                <p className="text-xs text-plm-fg-muted truncate">
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
              {t('common.connect')}
            </button>
          </div>
        )}

        {/* Logs/Troubleshoot Button */}
        <div className="mb-6">
          <button
            onClick={() => setShowLogsModal(true)}
            className="w-full btn btn-ghost gap-2 justify-center py-2 text-sm text-plm-fg-muted hover:text-plm-fg"
          >
            View Logs
          </button>
        </div>

        {/* Footer */}
        <div className="text-center mt-6 text-xs text-plm-fg-muted">
          {t('welcome.madeWith')}
        </div>
      </div>
      
      {/* Logs Modal */}
      {showLogsModal && (
        <LogViewer onClose={() => setShowLogsModal(false)} />
      )}
    </div>
  )
}
