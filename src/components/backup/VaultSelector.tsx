import { Folder } from 'lucide-react'
import type { ConnectedVault } from './types'

interface VaultSelectorProps {
  connectedVaults: ConnectedVault[]
  selectedVaultIds: string[]
  onVaultToggle: (vaultId: string, checked: boolean) => void
}

/**
 * Checkbox list to select which vaults to include in backup.
 * Only shown when this machine is the designated backup source.
 */
export function VaultSelector({ connectedVaults, selectedVaultIds, onVaultToggle }: VaultSelectorProps) {
  return (
    <div className="p-2 rounded bg-plm-bg-tertiary space-y-2">
      <div className="text-xs text-plm-fg-muted flex items-center gap-2">
        <Folder className="w-4 h-4" />
        Vaults to backup
      </div>
      {connectedVaults.length > 0 ? (
        <div className="space-y-1">
          {connectedVaults.map(vault => (
            <label key={vault.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-plm-bg-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={selectedVaultIds.includes(vault.id)}
                onChange={e => onVaultToggle(vault.id, e.target.checked)}
                className="w-4 h-4 rounded border-plm-border bg-plm-bg-primary"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{vault.name}</div>
                <div className="text-xs text-plm-fg-muted truncate">{vault.localPath}</div>
              </div>
            </label>
          ))}
        </div>
      ) : (
        <div className="text-sm text-amber-400">No vaults connected</div>
      )}
    </div>
  )
}
