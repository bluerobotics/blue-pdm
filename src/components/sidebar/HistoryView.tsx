import { useEffect, useState } from 'react'
import { FileText, User, Clock, ArrowUp, ArrowDown, Trash2, Edit, RefreshCw, FolderPlus, MoveRight, X, FolderOpen } from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { getRecentActivity } from '../../lib/supabase'
import { formatDistanceToNow } from 'date-fns'

interface ActivityEntry {
  id: string
  action: 'checkout' | 'checkin' | 'create' | 'delete' | 'state_change' | 'revision_change' | 'rename' | 'move'
  user_email: string
  details: Record<string, unknown>
  created_at: string
  file?: {
    file_name: string
    file_path: string
  } | null
}

const ACTION_INFO: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  checkout: { icon: <ArrowDown size={14} />, label: 'Checked out', color: 'text-pdm-error' },
  checkin: { icon: <ArrowUp size={14} />, label: 'Checked in', color: 'text-pdm-success' },
  create: { icon: <FolderPlus size={14} />, label: 'Created', color: 'text-pdm-accent' },
  delete: { icon: <Trash2 size={14} />, label: 'Deleted', color: 'text-pdm-error' },
  state_change: { icon: <RefreshCw size={14} />, label: 'State changed', color: 'text-pdm-warning' },
  revision_change: { icon: <Edit size={14} />, label: 'Revision changed', color: 'text-pdm-info' },
  rename: { icon: <Edit size={14} />, label: 'Renamed', color: 'text-pdm-fg-dim' },
  move: { icon: <MoveRight size={14} />, label: 'Moved', color: 'text-pdm-fg-dim' },
}

export function HistoryView() {
  const { organization, isVaultConnected, historyFolderFilter, setHistoryFolderFilter } = usePDMStore()
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // Load vault-wide activity
  useEffect(() => {
    const loadActivity = async () => {
      if (!isVaultConnected || !organization) {
        setActivity([])
        return
      }
      
      setIsLoading(true)
      
      try {
        const { activity: recentActivity, error } = await getRecentActivity(organization.id, 100)
        if (!error && recentActivity) {
          setActivity(recentActivity as ActivityEntry[])
        }
      } catch (err) {
        console.error('Failed to load activity:', err)
      } finally {
        setIsLoading(false)
      }
    }

    loadActivity()
    
    // Refresh every 30 seconds
    const interval = setInterval(loadActivity, 30000)
    return () => clearInterval(interval)
  }, [isVaultConnected, organization])
  
  // Filter activity by folder if filter is set
  const filteredActivity = historyFolderFilter
    ? activity.filter(entry => {
        if (!entry.file?.file_path) return false
        // Check if file path starts with the filter path
        return entry.file.file_path.startsWith(historyFolderFilter + '/') || 
               entry.file.file_path === historyFolderFilter
      })
    : activity

  if (!isVaultConnected) {
    return (
      <div className="p-4 text-sm text-pdm-fg-muted text-center">
        Open a vault to view activity
      </div>
    )
  }

  if (!organization) {
    return (
      <div className="p-4 text-sm text-pdm-fg-muted text-center">
        Sign in to view vault activity
      </div>
    )
  }

  return (
    <div className="p-4">
      <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-3">
        {historyFolderFilter ? 'Folder History' : 'Vault Activity'}
      </div>
      
      {/* Folder filter indicator */}
      {historyFolderFilter && (
        <div className="flex items-center gap-2 mb-3 p-2 bg-pdm-bg-light rounded border border-pdm-border">
          <FolderOpen size={14} className="text-pdm-accent flex-shrink-0" />
          <span className="text-sm truncate flex-1" title={historyFolderFilter}>
            {historyFolderFilter.split('/').pop() || historyFolderFilter}
          </span>
          <button
            onClick={() => setHistoryFolderFilter(null)}
            className="p-0.5 hover:bg-pdm-bg rounded text-pdm-fg-muted hover:text-pdm-fg"
            title="Clear filter"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {isLoading && filteredActivity.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <div className="spinner" />
        </div>
      ) : filteredActivity.length === 0 ? (
        <div className="text-sm text-pdm-fg-muted py-4 text-center">
          {historyFolderFilter ? 'No activity in this folder' : 'No recent activity'}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredActivity.map((entry) => {
            const actionInfo = ACTION_INFO[entry.action] || { 
              icon: <FileText size={14} />, 
              label: entry.action, 
              color: 'text-pdm-fg-muted' 
            }
            
            return (
              <div
                key={entry.id}
                className="p-2 bg-pdm-bg-light rounded border border-pdm-border hover:border-pdm-border-light transition-colors"
              >
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 ${actionInfo.color}`}>
                    {actionInfo.icon}
                  </span>
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="text-sm flex items-center gap-1">
                      <span className={`${actionInfo.color} whitespace-nowrap flex-shrink-0`}>{actionInfo.label}</span>
                      {entry.file && (
                        <span className="text-pdm-fg truncate">
                          {entry.file.file_name}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-pdm-fg-muted mt-1">
                      <span className="flex items-center gap-1">
                        <User size={10} />
                        {entry.user_email.split('@')[0]}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={10} />
                        {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
