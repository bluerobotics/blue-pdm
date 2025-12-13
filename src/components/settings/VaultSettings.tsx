import { useState } from 'react'
import { usePDMStore } from '../../stores/pdmStore'

export function VaultSettings() {
  const { vaultPath, vaultName, setVaultName } = usePDMStore()
  const [editingVaultName, setEditingVaultName] = useState(false)
  const [vaultNameInput, setVaultNameInput] = useState('')

  const displayName = vaultName || vaultPath?.split(/[/\\]/).pop() || 'vault'

  const handleSaveVaultName = () => {
    if (vaultNameInput.trim()) {
      setVaultName(vaultNameInput.trim())
    }
    setEditingVaultName(false)
  }

  if (!vaultPath) {
    return (
      <div className="text-center py-12 text-pdm-fg-muted text-sm">
        No vault connected
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Vault name */}
      <div className="space-y-2">
        <label className="text-xs text-pdm-fg-muted uppercase tracking-wide font-medium">
          Vault Name
        </label>
        {editingVaultName ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={vaultNameInput}
              onChange={(e) => setVaultNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveVaultName()
                if (e.key === 'Escape') setEditingVaultName(false)
              }}
              className="flex-1 bg-pdm-bg border border-pdm-border rounded-lg px-3 py-2 text-sm focus:border-pdm-accent focus:outline-none"
              autoFocus
            />
            <button onClick={handleSaveVaultName} className="btn btn-primary btn-sm">
              Save
            </button>
            <button 
              onClick={() => setEditingVaultName(false)} 
              className="btn btn-ghost btn-sm"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div 
            className="p-3 bg-pdm-bg rounded-lg border border-pdm-border cursor-pointer hover:border-pdm-accent transition-colors"
            onClick={() => {
              setVaultNameInput(displayName)
              setEditingVaultName(true)
            }}
          >
            <span className="text-sm text-pdm-fg">{displayName}</span>
            <span className="text-xs text-pdm-fg-dim ml-2">(click to edit)</span>
          </div>
        )}
      </div>

      {/* Vault path */}
      <div className="space-y-2">
        <label className="text-xs text-pdm-fg-muted uppercase tracking-wide font-medium">
          Local Path
        </label>
        <div className="p-3 bg-pdm-bg rounded-lg border border-pdm-border">
          <span className="text-sm text-pdm-fg-dim font-mono break-all">
            {vaultPath}
          </span>
        </div>
      </div>
    </div>
  )
}

