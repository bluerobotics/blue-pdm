import { useState, useEffect, useRef } from 'react'
import { LogOut, ChevronDown, User, Building2, Settings } from 'lucide-react'
import { usePDMStore } from '../stores/pdmStore'
import { signInWithGoogle, signOut, isSupabaseConfigured, linkUserToOrganization } from '../lib/supabase'

interface MenuBarProps {
  onOpenVault: () => void
  onRefresh: () => void
}

export function MenuBar({ onOpenVault, onRefresh }: MenuBarProps) {
  const { user, organization, setUser, setOrganization, addToast } = usePDMStore()
  const [appVersion, setAppVersion] = useState('')
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [titleBarPadding, setTitleBarPadding] = useState(140) // Default fallback
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false)
      }
    }
    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showUserMenu])

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getVersion().then(setAppVersion)
      // Get the actual titlebar overlay rect
      window.electronAPI.getTitleBarOverlayRect?.().then((rect) => {
        if (rect?.width) {
          setTitleBarPadding(rect.width + 8) // Add small margin
        }
      })
    }
  }, [])

  const handleSignIn = async () => {
    if (!isSupabaseConfigured) {
      alert('Supabase is not configured. Please add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.')
      return
    }
    
    setIsSigningIn(true)
    try {
      const { error } = await signInWithGoogle()
      if (error) {
        console.error('Sign in error:', error)
        alert(`Sign in failed: ${error.message}`)
      }
      // The auth state change will be handled by the App component
    } catch (err) {
      console.error('Sign in error:', err)
      alert('Sign in failed. Check the console for details.')
    } finally {
      setIsSigningIn(false)
    }
  }

  const handleSignOut = async () => {
    const { error } = await signOut()
    if (error) {
      console.error('Sign out error:', error)
    }
    setUser(null)
    setOrganization(null)
  }

  return (
    <div className="h-[38px] bg-pdm-activitybar flex items-center justify-between border-b border-pdm-border select-none flex-shrink-0 titlebar-drag-region">
      {/* Left side - App name */}
      <div className="flex items-center h-full">
        <div className="flex items-center gap-2 px-4 titlebar-no-drag">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-pdm-accent">
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
          <span className="text-sm font-semibold text-pdm-fg">Blue PDM</span>
          {appVersion && (
            <span className="text-xs text-pdm-fg-muted">v{appVersion}</span>
          )}
        </div>
      </div>

      {/* Center - Title (optional) */}
      <div className="flex-1" />

      {/* Right side - User info (with padding for window controls) */}
      <div 
        className="flex items-center h-full pl-4 titlebar-no-drag"
        style={{ paddingRight: titleBarPadding }}
      >
        {user ? (
          <div className="relative" ref={menuRef}>
            <button 
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-pdm-bg-lighter transition-colors"
            >
              {user.avatar_url ? (
                <img 
                  src={user.avatar_url} 
                  alt={user.full_name || user.email}
                  className="w-6 h-6 rounded-full"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-pdm-accent flex items-center justify-center text-xs text-white font-semibold">
                  {(user.full_name || user.email)[0].toUpperCase()}
                </div>
              )}
              <span className="text-xs text-pdm-fg-dim max-w-[120px] truncate">
                {user.full_name || user.email}
              </span>
              <ChevronDown size={12} className={`text-pdm-fg-muted transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Menu */}
            {showUserMenu && (
              <div className="absolute right-0 top-full mt-1 w-64 bg-pdm-bg-light border border-pdm-border rounded-lg shadow-xl overflow-hidden z-50">
                {/* User Info Header */}
                <div className="px-4 py-3 border-b border-pdm-border">
                  <div className="flex items-center gap-3">
                    {user.avatar_url ? (
                      <img 
                        src={user.avatar_url} 
                        alt={user.full_name || user.email}
                        className="w-10 h-10 rounded-full"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-pdm-accent flex items-center justify-center text-sm text-white font-semibold">
                        {(user.full_name || user.email)[0].toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-pdm-fg truncate">
                        {user.full_name || 'No name'}
                      </div>
                      <div className="text-xs text-pdm-fg-muted truncate">
                        {user.email}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Organization Info */}
                <div className="px-4 py-2 border-b border-pdm-border">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-pdm-fg-dim">
                      <Building2 size={14} />
                      {organization ? (
                        <span>{organization.name}</span>
                      ) : (
                        <span className="text-pdm-warning">No organization</span>
                      )}
                    </div>
                    {!organization && user && (
                      <button
                        onClick={async () => {
                          const { org, error } = await linkUserToOrganization(user.id, user.email)
                          if (error) {
                            addToast('error', `Could not find org for @${user.email.split('@')[1]}`)
                          } else if (org) {
                            setOrganization(org)
                            addToast('success', `Linked to ${org.name}`)
                            setShowUserMenu(false)
                          }
                        }}
                        className="text-xs text-pdm-accent hover:text-pdm-accent-hover"
                      >
                        Link
                      </button>
                    )}
                  </div>
                </div>

                {/* Menu Items */}
                <div className="py-1">
                  <button 
                    onClick={() => {
                      setShowUserMenu(false)
                      addToast('info', 'Account settings coming soon')
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-pdm-fg-dim hover:bg-pdm-highlight hover:text-pdm-fg transition-colors"
                  >
                    <User size={14} />
                    Account Settings
                  </button>
                  <button 
                    onClick={() => {
                      setShowUserMenu(false)
                      addToast('info', 'Preferences coming soon')
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-pdm-fg-dim hover:bg-pdm-highlight hover:text-pdm-fg transition-colors"
                  >
                    <Settings size={14} />
                    Preferences
                  </button>
                </div>

                {/* Sign Out */}
                <div className="border-t border-pdm-border py-1">
                  <button 
                    onClick={() => {
                      setShowUserMenu(false)
                      handleSignOut()
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-pdm-error hover:bg-red-900/20 transition-colors"
                  >
                    <LogOut size={14} />
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <button 
            onClick={handleSignIn}
            disabled={isSigningIn}
            className="text-xs text-pdm-accent hover:text-pdm-accent-hover transition-colors font-medium disabled:opacity-50"
          >
            {isSigningIn ? 'Signing in...' : 'Sign In with Google'}
          </button>
        )}
      </div>
    </div>
  )
}
