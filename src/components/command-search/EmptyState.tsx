import { Search } from 'lucide-react'
import type { EmptyStateProps } from './types'

/**
 * Empty state component for no results or empty query
 */
export function EmptyState({ type, isGdriveConnected }: EmptyStateProps) {
  if (type === 'no-results') {
    return (
      <div className="p-6 text-center">
        <Search size={24} className="mx-auto text-plm-fg-muted mb-2 opacity-50" />
        <div className="text-sm text-plm-fg-muted">No results found</div>
        <div className="text-xs text-plm-fg-muted mt-1">
          Try a different filter or search term
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 text-center">
      <Search size={24} className="mx-auto text-plm-fg-muted mb-2 opacity-50" />
      <div className="text-sm text-plm-fg-muted">Start typing to search</div>
      <div className="text-xs text-plm-fg-muted mt-2 space-y-1">
        <p>Use filters like <code className="px-1 bg-plm-bg-light rounded">pn:123</code> for part numbers</p>
        <p>or <code className="px-1 bg-plm-bg-light rounded">eco:ECO-001</code> for ECO files</p>
        {isGdriveConnected && (
          <p>or <code className="px-1 bg-plm-bg-light rounded">drive:file</code> for Google Drive</p>
        )}
      </div>
    </div>
  )
}
