import { useState, useEffect, useRef } from 'react'
import { Users, Monitor, Laptop } from 'lucide-react'
import { usePDMStore } from '../stores/pdmStore'
import { getOrgOnlineUsers, subscribeToOrgOnlineUsers, OnlineUser } from '../lib/supabase'
import { getInitials } from '../types/pdm'
import { UserProfileModal } from './settings/UserProfileModal'

interface OnlineUsersIndicatorProps {
  orgLogoUrl: string | null
}

export function OnlineUsersIndicator({ orgLogoUrl }: OnlineUsersIndicatorProps) {
  const { organization, user } = usePDMStore()
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [viewingUserId, setViewingUserId] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Load online users
  useEffect(() => {
    if (!organization?.id) {
      setOnlineUsers([])
      return
    }

    const loadOnlineUsers = async () => {
      const { users } = await getOrgOnlineUsers(organization.id)
      setOnlineUsers(users)
    }

    // Initial load
    loadOnlineUsers()

    // Subscribe to realtime updates
    const unsubscribe = subscribeToOrgOnlineUsers(organization.id, (users) => {
      setOnlineUsers(users)
    })

    // Also refresh periodically to catch stale sessions
    const interval = setInterval(loadOnlineUsers, 60 * 1000) // Every 60 seconds

    return () => {
      unsubscribe()
      clearInterval(interval)
    }
  }, [organization?.id])

  // Refresh when dropdown is opened
  useEffect(() => {
    if (showDropdown && organization?.id) {
      getOrgOnlineUsers(organization.id).then(({ users }) => {
        setOnlineUsers(users)
      })
    }
  }, [showDropdown, organization?.id])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showDropdown])

  // Handle clicking on a user to view their profile
  const handleUserClick = (userId: string) => {
    setShowDropdown(false)
    setViewingUserId(userId)
  }

  // Get platform icon
  const getPlatformIcon = (platform: string | null) => {
    if (platform === 'darwin') return <Laptop size={10} />
    return <Monitor size={10} />
  }

  // Format time since last seen
  const formatLastSeen = (lastSeen: string) => {
    const diff = Math.floor((Date.now() - new Date(lastSeen).getTime()) / 1000)
    if (diff < 60) return 'now'
    if (diff < 120) return '1m ago'
    return `${Math.floor(diff / 60)}m ago`
  }

  // Sort users: current user first, then by last_seen
  const sortedUsers = [...onlineUsers].sort((a, b) => {
    if (a.user_id === user?.id) return -1
    if (b.user_id === user?.id) return 1
    return new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime()
  })

  // Don't render if no organization
  if (!organization) return null

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-plm-bg-lighter transition-colors group"
          title={`${onlineUsers.length} user${onlineUsers.length !== 1 ? 's' : ''} online`}
        >
          {/* Company logo or Users icon */}
          <div className="relative">
            {orgLogoUrl ? (
              <img 
                src={orgLogoUrl} 
                alt={organization.name} 
                className="h-5 w-5 object-contain rounded"
              />
            ) : (
              <Users size={16} className="text-plm-fg-muted group-hover:text-plm-fg transition-colors" />
            )}
            
            {/* Online count badge */}
            {onlineUsers.length > 0 && (
              <div className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center bg-plm-success rounded-full">
                <span className="text-[9px] font-bold text-white px-0.5">
                  {onlineUsers.length > 99 ? '99+' : onlineUsers.length}
                </span>
              </div>
            )}
          </div>
        </button>

        {/* Dropdown */}
        {showDropdown && (
          <div className="absolute right-0 top-full mt-1 w-72 bg-plm-bg-light border border-plm-border rounded-lg shadow-xl overflow-hidden z-50">
            {/* Header */}
            <div className="px-4 py-3 border-b border-plm-border bg-plm-bg">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-plm-success animate-pulse" />
                <span className="text-sm font-medium text-plm-fg">
                  {onlineUsers.length} Online
                </span>
                <span className="text-xs text-plm-fg-muted">
                  in {organization.name}
                </span>
              </div>
            </div>

            {/* Users list */}
            <div className="max-h-80 overflow-y-auto py-1">
              {sortedUsers.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-plm-fg-muted">
                  No one else is online
                </div>
              ) : (
                sortedUsers.map((onlineUser) => {
                  const isCurrentUser = onlineUser.user_id === user?.id
                  
                  return (
                    <button
                      key={`${onlineUser.user_id}-${onlineUser.machine_name}`}
                      onClick={() => handleUserClick(onlineUser.user_id)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-plm-bg-lighter transition-colors text-left ${
                        isCurrentUser ? 'bg-plm-accent/5' : ''
                      }`}
                    >
                      {/* Avatar with online indicator */}
                      <div className="relative flex-shrink-0">
                        {onlineUser.avatar_url ? (
                          <img 
                            src={onlineUser.avatar_url} 
                            alt={onlineUser.full_name || onlineUser.email}
                            className="w-8 h-8 rounded-full"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement
                              target.style.display = 'none'
                              target.nextElementSibling?.classList.remove('hidden')
                            }}
                          />
                        ) : null}
                        <div className={`w-8 h-8 rounded-full bg-plm-accent flex items-center justify-center text-xs text-white font-semibold ${onlineUser.avatar_url ? 'hidden' : ''}`}>
                          {getInitials(onlineUser.full_name || onlineUser.email)}
                        </div>
                        
                        {/* Online dot */}
                        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-plm-bg-light rounded-full flex items-center justify-center">
                          <div className="w-2 h-2 rounded-full bg-plm-success" />
                        </div>
                      </div>

                      {/* User info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-sm font-medium truncate ${isCurrentUser ? 'text-plm-accent' : 'text-plm-fg'}`}>
                            {onlineUser.full_name || onlineUser.email.split('@')[0]}
                          </span>
                          {isCurrentUser && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-plm-accent/20 text-plm-accent font-medium">
                              you
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-plm-fg-muted">
                          <span className="flex items-center gap-1">
                            {getPlatformIcon(onlineUser.platform)}
                            <span className="truncate max-w-[120px]">{onlineUser.machine_name}</span>
                          </span>
                          <span className="text-plm-fg-dim">•</span>
                          <span>{formatLastSeen(onlineUser.last_seen)}</span>
                        </div>
                      </div>
                    </button>
                  )
                })
              )}
            </div>

            {/* Footer hint */}
            <div className="px-4 py-2 border-t border-plm-border bg-plm-bg">
              <p className="text-[10px] text-plm-fg-dim text-center">
                Click on a user to view their profile
              </p>
            </div>
          </div>
        )}
      </div>

      {/* User Profile Modal */}
      {viewingUserId && (
        <UserProfileModal
          userId={viewingUserId}
          onClose={() => setViewingUserId(null)}
        />
      )}
    </>
  )
}

