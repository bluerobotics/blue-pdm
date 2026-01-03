// Recent vaults section component for the explorer
import { FolderOpen } from 'lucide-react'

interface RecentVaultsSectionProps {
  recentVaults: string[]
  onOpenVault: () => void
  onOpenRecentVault: (path: string) => void
}

/**
 * Recent vaults section component
 * Shows when no vault is connected, displays recent vaults for quick access
 */
export function RecentVaultsSection({
  recentVaults,
  onOpenVault,
  onOpenRecentVault
}: RecentVaultsSectionProps) {
  return (
    <div className="p-4">
      <div className="mb-6">
        <button
          onClick={onOpenVault}
          className="btn btn-primary w-full"
        >
          <FolderOpen size={16} />
          Open Vault
        </button>
      </div>
      
      {recentVaults.length > 0 && (
        <div>
          <div className="text-xs text-plm-fg-muted uppercase tracking-wide mb-2">
            Recent Vaults
          </div>
          {recentVaults.map(vault => (
            <button
              key={vault}
              onClick={() => onOpenRecentVault(vault)}
              className="w-full text-left px-2 py-1.5 text-sm text-plm-fg-dim hover:bg-plm-highlight rounded truncate"
              title={vault}
            >
              {vault.split(/[/\\]/).pop()}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface NoVaultAccessMessageProps {
  impersonatedUser: { full_name?: string | null; email?: string } | null
  connectedVaultsCount: number
}

/**
 * Message shown when impersonating a user with no vault access
 */
export function NoVaultAccessMessage({
  impersonatedUser,
  connectedVaultsCount
}: NoVaultAccessMessageProps) {
  if (!impersonatedUser) return null
  
  return (
    <div className="py-8 px-4 text-center">
      <div className="text-4xl mb-3">🔒</div>
      <h3 className="text-base font-medium text-plm-fg mb-2">No Vault Access</h3>
      <p className="text-sm text-plm-fg-muted">
        {impersonatedUser.full_name || impersonatedUser.email} does not have access to any of your connected vaults.
      </p>
      <p className="text-xs text-plm-fg-dim mt-4">
        {connectedVaultsCount} vault{connectedVaultsCount !== 1 ? 's' : ''} connected but hidden due to access restrictions
      </p>
    </div>
  )
}
