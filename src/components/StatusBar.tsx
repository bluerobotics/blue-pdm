import { usePDMStore } from '../stores/pdmStore'
import { GitBranch, Cloud, CloudOff, Wifi, WifiOff } from 'lucide-react'

export function StatusBar() {
  const { 
    vaultPath, 
    isVaultConnected, 
    files, 
    selectedFiles,
    statusMessage,
    isLoading,
    user,
    organization
  } = usePDMStore()

  const fileCount = files.filter(f => !f.isDirectory).length
  const folderCount = files.filter(f => f.isDirectory).length
  const modifiedCount = files.filter(f => f.gitStatus === 'modified').length

  return (
    <div className="h-6 bg-pdm-activitybar border-t border-pdm-border flex items-center justify-between px-3 text-xs text-pdm-fg-dim select-none flex-shrink-0">
      <div className="flex items-center gap-4">
        {/* Vault status */}
        <div className="flex items-center gap-1.5">
          {isVaultConnected ? (
            <>
              <Wifi size={12} className="text-pdm-success" />
              <span className="text-pdm-fg-dim">
                {vaultPath?.split(/[/\\]/).pop()}
              </span>
            </>
          ) : (
            <>
              <WifiOff size={12} className="text-pdm-fg-muted" />
              <span>No vault</span>
            </>
          )}
        </div>

        {/* Git status */}
        {isVaultConnected && (
          <div className="flex items-center gap-1.5">
            <GitBranch size={12} />
            <span>main</span>
            {modifiedCount > 0 && (
              <span className="text-pdm-warning">
                ({modifiedCount} modified)
              </span>
            )}
          </div>
        )}

        {/* Status message */}
        {statusMessage && (
          <span className={isLoading ? 'animate-pulse' : ''}>
            {statusMessage}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* File count */}
        {isVaultConnected && (
          <span>
            {fileCount} files, {folderCount} folders
            {selectedFiles.length > 0 && ` • ${selectedFiles.length} selected`}
          </span>
        )}

        {/* Cloud status */}
        <div className="flex items-center gap-1.5">
          {user ? (
            <>
              <Cloud size={12} className="text-pdm-success" />
              <span>{organization?.name || user.email}</span>
            </>
          ) : (
            <>
              <CloudOff size={12} className="text-pdm-fg-muted" />
              <span>Offline</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
