import { useEffect, useState } from 'react'
import { GitCommit, User, Clock } from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { formatDistanceToNow } from 'date-fns'

interface CommitEntry {
  hash: string
  date: string
  message: string
  author_name: string
  author_email: string
}

export function HistoryView() {
  const { selectedFiles, isVaultConnected } = usePDMStore()
  const [commits, setCommits] = useState<CommitEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // Load git history
  useEffect(() => {
    const loadHistory = async () => {
      if (!window.electronAPI || !isVaultConnected) return
      
      setIsLoading(true)
      try {
        // If a single file is selected, show its history
        const filePath = selectedFiles.length === 1 ? selectedFiles[0] : undefined
        const result = await window.electronAPI.gitLog(filePath)
        
        if (result.success && result.log) {
          setCommits(result.log.all || [])
        }
      } catch (err) {
        console.error('Failed to load history:', err)
      } finally {
        setIsLoading(false)
      }
    }

    loadHistory()
  }, [isVaultConnected, selectedFiles])

  if (!isVaultConnected) {
    return (
      <div className="p-4 text-sm text-pdm-fg-muted text-center">
        Open a vault to view history
      </div>
    )
  }

  return (
    <div className="p-4">
      <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-3">
        {selectedFiles.length === 1 ? 'File History' : 'Vault History'}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="spinner" />
        </div>
      ) : commits.length === 0 ? (
        <div className="text-sm text-pdm-fg-muted py-4 text-center">
          No commits yet
        </div>
      ) : (
        <div className="space-y-3">
          {commits.map(commit => (
            <div
              key={commit.hash}
              className="p-3 bg-pdm-bg-light rounded-lg border border-pdm-border hover:border-pdm-border-light transition-colors"
            >
              <div className="flex items-start gap-2 mb-2">
                <GitCommit size={14} className="text-pdm-accent mt-0.5 flex-shrink-0" />
                <span className="text-sm font-medium line-clamp-2">
                  {commit.message}
                </span>
              </div>
              
              <div className="flex items-center gap-4 text-xs text-pdm-fg-muted">
                <div className="flex items-center gap-1">
                  <User size={12} />
                  <span>{commit.author_name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock size={12} />
                  <span>
                    {formatDistanceToNow(new Date(commit.date), { addSuffix: true })}
                  </span>
                </div>
              </div>
              
              <div className="mt-2 font-mono text-xs text-pdm-fg-muted">
                {commit.hash.substring(0, 7)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

