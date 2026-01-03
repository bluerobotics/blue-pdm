// src/components/context-menu/items/AdminItems.tsx
import { Unlock } from 'lucide-react'
import type { LocalFile } from '../../../stores/pdmStore'
import { executeCommand } from '../../../lib/commands'

interface AdminItemsProps {
  contextFiles: LocalFile[]
  isAdmin: boolean
  checkedOutByOthersCount: number
  onClose: () => void
  onRefresh: (silent?: boolean) => void
}

export function AdminItems({
  contextFiles,
  isAdmin,
  checkedOutByOthersCount,
  onClose,
  onRefresh
}: AdminItemsProps) {
  if (!isAdmin || checkedOutByOthersCount === 0) return null

  const handleForceRelease = () => {
    onClose()
    executeCommand('force-release', { files: contextFiles }, { onRefresh })
  }

  return (
    <div 
      className="context-menu-item text-plm-error"
      onClick={handleForceRelease}
      title="Admin: Immediately release checkout. User's unsaved changes will be orphaned."
    >
      <Unlock size={14} />
      Force Release {checkedOutByOthersCount > 1 ? `(${checkedOutByOthersCount})` : ''}
    </div>
  )
}
