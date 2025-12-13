import { Mail, LogOut } from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { signOut } from '../../lib/supabase'
import { getInitials } from '../../types/pdm'

export function AccountSettings() {
  const { user, setUser, setOrganization } = usePDMStore()

  const handleSignOut = async () => {
    await signOut()
    setUser(null)
    setOrganization(null)
  }

  if (!user) {
    return (
      <div className="text-center py-12 text-pdm-fg-muted text-sm">
        Not signed in
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* User profile card */}
      <div className="flex items-center gap-4 p-4 bg-pdm-bg rounded-lg border border-pdm-border">
        {user.avatar_url ? (
          <>
            <img 
              src={user.avatar_url} 
              alt={user.full_name || user.email}
              className="w-16 h-16 rounded-full"
              onError={(e) => {
                const target = e.target as HTMLImageElement
                target.style.display = 'none'
                target.nextElementSibling?.classList.remove('hidden')
              }}
            />
            <div className="w-16 h-16 rounded-full bg-pdm-accent flex items-center justify-center text-xl text-white font-semibold hidden">
              {getInitials(user.full_name || user.email)}
            </div>
          </>
        ) : (
          <div className="w-16 h-16 rounded-full bg-pdm-accent flex items-center justify-center text-xl text-white font-semibold">
            {getInitials(user.full_name || user.email)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-lg font-medium text-pdm-fg truncate">
            {user.full_name || 'No name'}
          </div>
          <div className="text-sm text-pdm-fg-muted truncate flex items-center gap-1.5">
            <Mail size={14} />
            {user.email}
          </div>
          <div className="text-xs text-pdm-fg-dim mt-1">
            Role: <span className="capitalize">{user.role}</span>
          </div>
        </div>
      </div>

      {/* Account actions */}
      <div className="space-y-2">
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-2 px-4 py-3 text-sm text-pdm-error bg-pdm-error/5 hover:bg-pdm-error/10 rounded-lg border border-pdm-error/20 transition-colors"
        >
          <LogOut size={18} />
          Sign Out
        </button>
      </div>
    </div>
  )
}

