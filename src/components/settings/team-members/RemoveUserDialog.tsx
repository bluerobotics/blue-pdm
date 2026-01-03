import { useState } from 'react'
import { AlertTriangle, Loader2, UserMinus } from 'lucide-react'
import type { OrgUser } from './types'

interface RemoveUserDialogProps {
  user: OrgUser
  onClose: () => void
  onConfirm: () => void
  isRemoving: boolean
  isSelf?: boolean
}

export function RemoveUserDialog({
  user,
  onClose,
  onConfirm,
  isRemoving,
  isSelf = false
}: RemoveUserDialogProps) {
  const [confirmText, setConfirmText] = useState('')
  
  const displayName = user.full_name || user.email
  const confirmPhrase = isSelf ? 'confirm' : displayName
  const isConfirmed = confirmText === confirmPhrase
  
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 rounded-full bg-plm-error/20">
            <AlertTriangle className="w-5 h-5 text-plm-error" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-plm-fg">
              {isSelf ? 'Leave Organization' : 'Remove User from Organization'}
            </h3>
            <p className="text-sm text-plm-fg-muted mt-1">This action cannot be undone</p>
          </div>
        </div>
        
        <div className="space-y-4 mb-6">
          <div className="p-3 bg-plm-error/10 border border-plm-error/30 rounded-lg">
            <p className="text-sm text-plm-fg">
              {isSelf ? (
                <>You are about to <strong>leave this organization</strong>. You will:</>
              ) : (
                <>You are about to remove <strong>{displayName}</strong> from this organization. They will:</>
              )}
            </p>
            <ul className="text-sm text-plm-fg-muted list-disc list-inside mt-2 space-y-1">
              <li>Lose access to all vaults and files</li>
              <li>Be removed from all teams</li>
              <li>Need to be re-invited to rejoin</li>
            </ul>
          </div>
          
          <div>
            <p className="text-sm text-plm-fg-muted mb-2">
              To confirm, type <strong className="text-plm-fg">{confirmPhrase}</strong> below:
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder={confirmPhrase}
              className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-error"
              autoFocus
            />
          </div>
        </div>
        
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!isConfirmed || isRemoving}
            className={`btn flex items-center gap-2 ${
              isConfirmed
                ? 'bg-plm-error hover:bg-plm-error/90 text-white'
                : 'bg-plm-fg-muted/20 text-plm-fg-muted cursor-not-allowed'
            }`}
          >
            {isRemoving ? <Loader2 size={16} className="animate-spin" /> : <UserMinus size={16} />}
            {isRemoving ? 'Removing...' : isSelf ? 'Leave Organization' : 'Remove User'}
          </button>
        </div>
      </div>
    </div>
  )
}
