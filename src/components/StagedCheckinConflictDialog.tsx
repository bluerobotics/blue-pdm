/**
 * StagedCheckinConflictDialog
 * 
 * Shows when files staged for check-in have conflicts with server versions.
 * This happens when the server has a newer version than when the file was staged offline.
 * 
 * Options:
 * - Keep Local: Force upload local changes, overwriting server version
 * - Keep Server: Discard local changes and get latest from server
 * - Save Backup: Save local as backup, then get server version
 */

import { useState } from 'react'
import { 
  X, 
  Upload, 
  Download, 
  Copy, 
  AlertTriangle,
  File,
  Loader2,
  ChevronDown,
  ChevronRight
} from 'lucide-react'
import { usePDMStore, StagedCheckin } from '../stores/pdmStore'
import { executeCommand } from '../lib/commands'

type ActionType = 'keep-local' | 'keep-server' | 'backup'

interface ActionConfig {
  key: ActionType
  label: string
  description: string
  icon: typeof Upload
  variant: 'default' | 'warning' | 'danger'
}

const ACTIONS: ActionConfig[] = [
  {
    key: 'keep-local',
    label: 'Keep My Changes',
    description: 'Upload your local changes, replacing the server version',
    icon: Upload,
    variant: 'warning'
  },
  {
    key: 'keep-server',
    label: 'Keep Server Version',
    description: 'Discard your local changes and download the latest from server',
    icon: Download,
    variant: 'danger'
  },
  {
    key: 'backup',
    label: 'Save Backup & Get Server',
    description: 'Save your local file as a backup copy, then get the server version',
    icon: Copy,
    variant: 'default'
  }
]

interface ConflictDialogProps {
  conflicts: Array<{
    staged: StagedCheckin
    serverVersion: number
    localPath: string
  }>
  onClose: () => void
  onRefresh?: () => void
}

export function StagedCheckinConflictDialog({ conflicts, onClose, onRefresh }: ConflictDialogProps) {
  const { unstageCheckin, addToast, vaultPath } = usePDMStore()
  const [processing, setProcessing] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleExpanded = (path: string) => {
    const next = new Set(expanded)
    if (next.has(path)) {
      next.delete(path)
    } else {
      next.add(path)
    }
    setExpanded(next)
  }

  const handleAction = async (conflict: typeof conflicts[0], action: ActionType) => {
    const { staged, localPath } = conflict
    setProcessing(staged.relativePath)

    try {
      const { files } = usePDMStore.getState()
      const file = files.find(f => f.relativePath === staged.relativePath)
      
      if (!file) {
        addToast('error', `File not found: ${staged.fileName}`)
        setProcessing(null)
        return
      }

      switch (action) {
        case 'keep-local': {
          // Force checkout and checkin with local changes
          await executeCommand('checkout', { files: [file] }, { silent: true })
          await executeCommand('checkin', { 
            files: [file], 
            comment: staged.comment || 'Offline changes (resolved conflict)' 
          }, { silent: true })
          addToast('success', `Uploaded your changes for "${staged.fileName}"`)
          break
        }

        case 'keep-server': {
          // Download server version, discarding local changes
          await executeCommand('get-latest', { files: [file] }, { silent: true })
          addToast('info', `Downloaded server version of "${staged.fileName}"`)
          break
        }

        case 'backup': {
          // Save backup then get server version
          if (vaultPath) {
            const backupName = staged.fileName.replace(/(\.[^.]+)$/, '_backup$1')
            const backupPath = localPath.replace(staged.fileName, backupName)
            
            await window.electronAPI?.copyFile(localPath, backupPath)
            await executeCommand('get-latest', { files: [file] }, { silent: true })
            addToast('success', `Saved backup and downloaded server version of "${staged.fileName}"`)
          }
          break
        }
      }

      // Remove from staged
      unstageCheckin(staged.relativePath)
      
    } catch (err) {
      console.error('[ConflictResolution] Error:', err)
      addToast('error', `Failed to resolve conflict: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setProcessing(null)
      
      // If this was the last conflict, close dialog and refresh
      if (conflicts.length === 1) {
        onRefresh?.()
        onClose()
      }
    }
  }

  if (conflicts.length === 0) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-plm-bg border border-plm-border rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-plm-border">
          <div className="p-2 rounded-lg bg-amber-500/20">
            <AlertTriangle size={20} className="text-amber-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-plm-fg">Conflict Detected</h2>
            <p className="text-sm text-plm-fg-muted">
              {conflicts.length === 1 
                ? 'This file was modified on the server while you were offline.'
                : `${conflicts.length} files were modified on the server while you were offline.`
              }
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-plm-highlight text-plm-fg-muted hover:text-plm-fg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Conflict List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {conflicts.map((conflict) => {
            const isExpanded = expanded.has(conflict.staged.relativePath)
            const isProcessing = processing === conflict.staged.relativePath

            return (
              <div 
                key={conflict.staged.relativePath}
                className="border border-plm-border rounded-lg overflow-hidden"
              >
                {/* File Header */}
                <button
                  onClick={() => toggleExpanded(conflict.staged.relativePath)}
                  className="w-full flex items-center gap-3 p-3 hover:bg-plm-highlight/50 transition-colors text-left"
                  disabled={isProcessing}
                >
                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <File size={16} className="text-plm-fg-muted flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-plm-fg truncate">
                      {conflict.staged.fileName}
                    </p>
                    <p className="text-xs text-plm-fg-muted">
                      Your version: v{conflict.staged.serverVersion || '?'} → Server: v{conflict.serverVersion}
                    </p>
                  </div>
                  {isProcessing && <Loader2 size={16} className="animate-spin text-plm-accent" />}
                </button>

                {/* Actions */}
                {isExpanded && !isProcessing && (
                  <div className="border-t border-plm-border bg-plm-bg-light p-3 space-y-2">
                    {ACTIONS.map((action) => (
                      <button
                        key={action.key}
                        onClick={() => handleAction(conflict, action.key)}
                        className={`w-full flex items-center gap-3 p-2.5 rounded-md text-left transition-colors ${
                          action.variant === 'warning' 
                            ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400' 
                            : action.variant === 'danger'
                            ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400'
                            : 'bg-plm-highlight hover:bg-plm-highlight/80 text-plm-fg'
                        }`}
                      >
                        <action.icon size={16} />
                        <div className="flex-1">
                          <p className="text-sm font-medium">{action.label}</p>
                          <p className="text-xs opacity-75">{action.description}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-plm-border">
          <p className="text-xs text-plm-fg-muted text-center">
            Click each file to see resolution options
          </p>
        </div>
      </div>
    </div>
  )
}

// Container component that connects to store
export function StagedCheckinConflictContainer({ onRefresh }: { onRefresh?: () => void }) {
  const [showDialog, setShowDialog] = useState(false)
  const [conflicts, setConflicts] = useState<Array<{
    staged: StagedCheckin
    serverVersion: number
    localPath: string
  }>>([])

  // This component is meant to be controlled externally
  // The conflicts should be passed in when detected during online transition
  
  if (!showDialog || conflicts.length === 0) return null

  return (
    <StagedCheckinConflictDialog
      conflicts={conflicts}
      onClose={() => {
        setShowDialog(false)
        setConflicts([])
      }}
      onRefresh={onRefresh}
    />
  )
}

